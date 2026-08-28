"""起動時の軽量マイグレーション（マイグレーションツール無し構成のため手書き）。

マルチテナント化（user_id 列の追加）に伴う既存DBの更新を行う:

1. user_id 列が無いテーブルに ALTER TABLE で追加し、インデックスを張る。
2. Postgres のみ: user_id を含まない旧ユニーク制約を、user_id 込みの新しい制約に
   張り替える（ユーザーごとに一意にするため）。SQLite は制約の変更ができないが、
   ローカル開発＝認証無効＝全行 user_id NULL の単一テナントなので旧制約のままで問題ない。
3. 環境変数 LEGACY_DATA_USER_ID が設定されていれば、user_id が NULL の既存データを
   そのユーザーに割り当てる（マルチテナント化以前のデータの引き継ぎ）。
   値は Supabase ダッシュボード → Authentication → Users で確認できるユーザーUUID。
   ※ セキュリティ上「最初にログインした人に自動で割り当てる」ことはしない。

すべて冪等（何度実行しても安全）。失敗してもアプリ起動は止めない。
"""
import logging
import os

from sqlalchemy import inspect, text

logger = logging.getLogger("migrations")

# user_id を持つ全テーブルと、user_id 込みユニーク制約の定義
# {テーブル名: [(制約名, (user_id を除く列...)), ...]}
_USER_SCOPED_TABLES = {
    "rpp_weekly": [],
    "monthly_analysis": [],
    "targets": [("uq_target_user_month", ("year_month",))],
    "action_checks": [("uq_action_check", ("product_url", "week_key", "action_key"))],
    "inventory_status": [("uq_inventory_user_product", ("product_url",))],
    "monthly_item_sales": [("uq_monthly_item", ("management_no", "year_month"))],
    "rpp_sales": [("uq_rpp_sales", ("period_type", "date_from", "date_to", "item_code"))],
    # ── マスタテーブル（参照レイヤー） ──────────────────────────────
    # create_all で新規作成される際は user_id 列・user_id 込みユニーク制約つきで作られるが、
    # 既存DBへの後付けや制約張替え・インデックス付与を冪等に担保するため登録しておく。
    "shops": [],
    "product_categories": [("uq_category", ("genre_u1", "genre_u2", "genre_u3"))],
    "products": [("uq_product", ("shop_id", "management_no"))],
    "product_costs": [("uq_product_cost", ("management_no",))],
    # 課金（ユニーク制約なし。user_id 列・インデックスの冪等付与とRLS対象化のため登録）
    "subscriptions": [],
    # コンサル問い合わせ（同上）
    "consulting_inquiries": [],
    # フィードバック（不具合報告・要望。同上）
    "feedbacks": [],
    # ジャンル別ベンチマーク手入力値（アクション提案ロジック 3-B/3-B'）
    "genre_benchmarks": [("uq_genre_benchmark", ("genre_u1", "genre_u2", "genre_u3", "metric"))],
    # アイテム別目標（アクション提案ロジック 3-B''。第3段階）
    "item_targets": [("uq_item_target", ("management_no", "year_month"))],
    # 管理者閲覧セッション（監査ログ。ユニーク制約なし。user_id 列・インデックスの
    # 冪等付与とRLS対象化のため登録。session_token_hash のunique制約は
    # モデル定義のColumn(unique=True)がcreate_all時に作るので別途ここでは扱わない）
    "admin_view_sessions": [],
    # 無償提供（comp）の付与・解除ログ（監査ログ。ユニーク制約なし。admin_view_sessions と
    # 同じ理由でユニーク制約を設けない＝同一メールへの複数回の付与・解除サイクルを許すため）
    "comp_grants": [],
}


# user_id 以外で、後から追加した通常カラム（既存DBへ冪等にALTERで足す）。
# {テーブル名: [(列名, 型DDL), ...]}
_EXTRA_COLUMNS = {
    "shops": [
        ("restock_lead_days", "INTEGER DEFAULT 14"),
        # 売上予算プラン（第4段階v2）: 年間売上予算と予算年度の起点月
        ("annual_sales_budget", "FLOAT"),
        ("budget_year_start_month", "INTEGER DEFAULT 1"),
    ],
    # 月次売上予算の手動補正（追加指示書2026-08-02 2章。null=自動按分）
    "targets": [("target_sales_budget", "FLOAT")],
    # アクション提案ロジックのゲート用状態（設計ドキュメント2026-08-01 2-A / 3-A）
    "products": [
        ("launch_month", "VARCHAR"),
        ("phase_override", "VARCHAR"),
        ("page_ready", "BOOLEAN"),
        ("investment_intent", "BOOLEAN"),
    ],
}

# マスタCRUD規約（2026-08-22）: ソフトデリート用 archived_at 列。
# is_sample と同じパターンで、対象3マスタに冪等追加する。
_ARCHIVABLE_TABLES = ("products", "product_categories", "targets")
for _t in _ARCHIVABLE_TABLES:
    _EXTRA_COLUMNS.setdefault(_t, []).append(("archived_at", "TIMESTAMP"))

# サンプルデータ識別フラグ（2026-08-20）。サンプル生成・削除がこの列だけを対象にし、
# 実データを巻き込まないようにする。既存行は DEFAULT FALSE（=実データ扱い）で埋まる。
_IS_SAMPLE_TABLES = (
    "rpp_weekly", "rpp_sales", "monthly_analysis", "monthly_item_sales",
    "targets", "products", "product_categories", "product_costs",
    "item_targets", "genre_benchmarks",
)
for _t in _IS_SAMPLE_TABLES:
    _EXTRA_COLUMNS.setdefault(_t, []).append(("is_sample", "BOOLEAN DEFAULT FALSE"))


def _add_extra_columns(conn, inspector):
    """モデルに後から追加した通常カラムを、無ければ ALTER TABLE で足す（冪等）。"""
    for table, cols in _EXTRA_COLUMNS.items():
        if table not in inspector.get_table_names():
            continue
        existing = {c["name"] for c in inspector.get_columns(table)}
        for name, ddl in cols:
            if name not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
                logger.info("migrations: %s に %s 列を追加", table, name)


def _add_user_id_columns(conn, inspector, dialect: str):
    """user_id 列とインデックスを追加する（無い場合のみ）。"""
    for table in _USER_SCOPED_TABLES:
        if table not in inspector.get_table_names():
            continue
        columns = {c["name"] for c in inspector.get_columns(table)}
        if "user_id" not in columns:
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN user_id VARCHAR"))
            logger.info("migrations: %s に user_id 列を追加", table)
        # インデックス（SQLite/Postgres とも IF NOT EXISTS 対応）
        conn.execute(
            text(f"CREATE INDEX IF NOT EXISTS ix_{table}_user_id ON {table} (user_id)")
        )


def _rebuild_unique_constraints_pg(conn, inspector):
    """Postgres: user_id を含まない旧ユニーク制約を user_id 込みに張り替える。"""
    for table, constraints in _USER_SCOPED_TABLES.items():
        if not constraints or table not in inspector.get_table_names():
            continue
        try:
            existing = inspector.get_unique_constraints(table)
        except Exception:
            existing = []

        for new_name, base_cols in constraints:
            want = set(base_cols) | {"user_id"}
            have_new = False
            for uc in existing:
                cols = set(uc.get("column_names") or [])
                name = uc.get("name")
                if cols == want:
                    have_new = True
                elif cols == set(base_cols) and name:
                    # user_id を含まない旧制約 → 削除
                    conn.execute(text(f'ALTER TABLE {table} DROP CONSTRAINT "{name}"'))
                    logger.info("migrations: %s の旧ユニーク制約 %s を削除", table, name)
            if not have_new:
                col_list = ", ".join(("user_id",) + base_cols)
                conn.execute(
                    text(
                        f'ALTER TABLE {table} ADD CONSTRAINT "{new_name}" UNIQUE ({col_list})'
                    )
                )
                logger.info("migrations: %s にユニーク制約 %s を作成", table, new_name)


def _assign_legacy_data(conn):
    """LEGACY_DATA_USER_ID が設定されていれば、user_id NULL の既存行を割り当てる。"""
    uid = os.environ.get("LEGACY_DATA_USER_ID", "").strip()
    if not uid:
        return
    total = 0
    for table in _USER_SCOPED_TABLES:
        result = conn.execute(
            text(f"UPDATE {table} SET user_id = :uid WHERE user_id IS NULL"),
            {"uid": uid},
        )
        total += result.rowcount or 0
    if total:
        logger.info("migrations: 既存データ %d 行をユーザー %s に割り当て", total, uid)


def _enforce_rls_pg(conn):
    """【重要・セキュリティ】public スキーマの全テーブルに RLS を強制する。

    背景（2026-07 に実際に発生した重大インシデント）:
      models.Base.metadata.create_all() で作ったテーブルは RLS が無効のまま
      public スキーマに置かれる。Supabase は public スキーマを Data API
      (PostgREST) 経由で公開するため、フロントに埋め込まれた anon キー
      （公開が前提の値）だけで、誰でも全社の売上データを読み書きできる
      状態になっていた。Supabase の Security Advisor から
      「rls_disabled_in_public」として9テーブル分の Critical 警告が出ていた。

    なぜコードで自動化するか:
      手動で ALTER TABLE すると「新しいモデルを追加したときに付け忘れる」。
      顧客のデータベースが漏れる事故は一度でも起きてはならないので、
      ドキュメントではなく起動時の強制で担保する。

    安全性:
      - バックエンドはテーブル所有者(postgres)として接続しており、所有者は
        RLS をバイパスするため、この設定でアプリの動作は一切変わらない。
      - ポリシーを作らないので anon / authenticated からは全拒否になる。
      - 冪等。既に有効なテーブルを再実行しても無害。
    """
    rows = conn.execute(text(
        "SELECT tablename FROM pg_tables "
        "WHERE schemaname = 'public' AND rowsecurity = false"
    )).fetchall()

    for (table,) in rows:
        # テーブル名は pg_tables 由来なので任意入力ではない。念のため引用符で囲む。
        conn.execute(text(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY'))
        logger.warning(
            "migrations: RLSが無効だったテーブル %s を保護しました"
            "（Data API経由の情報漏洩を防止）", table
        )

    if rows:
        logger.warning(
            "migrations: 合計 %d テーブルのRLSを有効化しました。"
            "新しいモデルを追加した場合はこれが正常な動作です。", len(rows)
        )


def _mark_legacy_sample_rows(conn):
    """is_sample 列の導入（2026-08-20）より前に生成された旧サンプルデータへ、
    フラグを遡って付与する（冪等）。

    これが無いと、既存環境（demoアカウント等）の旧サンプルは「実データ扱い」のまま残り、
    ①「サンプルだけ削除」で消えない ②商品マスタに残った旧サンプル商品が管理番号の
    衝突判定に当たり、サンプル再生成が全件スキップされる（PR #21 検証で実際に再現）。

    誤認定を避けるための判定基準（**緩めないこと**）:
    - 商品名を持つテーブル … 管理番号がサンプルカタログと一致し、**かつ**商品名または
      商品URLがカタログの値と完全一致する行だけ。実店舗が偶然同じ管理番号を使っていても、
      架空の商品名・URLまで一致することは実質ない
    - product_costs / item_targets（名前を持たない）… **同一ユーザーの products で
      サンプル認定済み**の管理番号に紐づく行だけ
    - genre_benchmarks … デモ行の memo「RMS表示値（デモデータ）」と階層・指標の完全一致のみ
    - **targets と product_categories は対象外**。目標値（500万等）は実データと区別できず、
      カテゴリは実データ商品が使っている可能性があるため。旧サンプル由来のこれらは
      無害な残置とし、必要なら画面から個別に消してもらう
    """
    from sample_data import PRODUCTS  # 循環import回避のため関数内で読む

    catalog = [(p["management_no"], p["product_name"], p["product_url"]) for p in PRODUCTS]
    catalog.append(("NEW-001", "新商品サンプル（実績データなし）", None))
    not_sample = "(is_sample IS NULL OR is_sample = FALSE)"
    total = 0

    # 商品名（＋URL）を持つテーブル
    name_tables = [
        ("products", "management_no", "product_name", "product_url"),
        ("rpp_weekly", "management_no", "product_name", "product_url"),
        ("monthly_analysis", "management_no", "product_name", "product_url"),
        ("monthly_item_sales", "management_no", "product_name", "product_url"),
        ("rpp_sales", "item_code", "product_name", "item_url"),
    ]
    for table, mno_col, name_col, url_col in name_tables:
        for mno, name, url in catalog:
            cond = f"{name_col} = :name"
            params = {"mno": mno, "name": name}
            if url:
                cond = f"({cond} OR {url_col} = :url)"
                params["url"] = url
            res = conn.execute(text(
                f"UPDATE {table} SET is_sample = TRUE "
                f"WHERE {not_sample} AND {mno_col} = :mno AND {cond}"
            ), params)
            total += res.rowcount or 0

    # 名前を持たないテーブル: 同一ユーザーのサンプル認定済み products に紐づく行だけ
    for table in ("product_costs", "item_targets"):
        res = conn.execute(text(
            f"UPDATE {table} SET is_sample = TRUE "
            f"WHERE {not_sample} AND EXISTS ("
            f"  SELECT 1 FROM products p WHERE p.is_sample = TRUE"
            f"  AND p.management_no = {table}.management_no"
            f"  AND (p.user_id = {table}.user_id OR (p.user_id IS NULL AND {table}.user_id IS NULL))"
            f")"
        ))
        total += res.rowcount or 0

    res = conn.execute(text(
        "UPDATE genre_benchmarks SET is_sample = TRUE "
        f"WHERE {not_sample} AND genre_u1 = 'スポーツ' AND genre_u2 = 'シューズ' "
        "AND genre_u3 IS NULL AND metric = 'ctr' AND memo = 'RMS表示値（デモデータ）'"
    ))
    total += res.rowcount or 0

    if total:
        logger.info("migrations: 旧サンプルデータ %s 行に is_sample を遡及付与しました", total)


def run_migrations(engine):
    dialect = engine.dialect.name  # 'sqlite' / 'postgresql'
    try:
        with engine.begin() as conn:
            inspector = inspect(conn)
            _add_extra_columns(conn, inspector)
            _add_user_id_columns(conn, inspector, dialect)
            if dialect == "postgresql":
                # 列追加後の状態を見るため inspector を作り直す
                inspector = inspect(conn)
                _rebuild_unique_constraints_pg(conn, inspector)
            _assign_legacy_data(conn)
            _mark_legacy_sample_rows(conn)
    except Exception:
        # マイグレーション失敗でアプリを止めない（ログに残して継続）
        logger.exception("migrations: 実行中にエラーが発生しました")

    # RLS の強制は上のマイグレーションとは独立したトランザクションで行う。
    # 上が失敗しても、セキュリティの担保だけは必ず試みる。
    if dialect == "postgresql":
        try:
            with engine.begin() as conn:
                _enforce_rls_pg(conn)
        except Exception:
            logger.exception(
                "migrations: RLSの有効化に失敗しました。"
                "Data API経由でデータが露出する可能性があります。至急確認してください。"
            )
