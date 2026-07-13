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
}


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


def run_migrations(engine):
    dialect = engine.dialect.name  # 'sqlite' / 'postgresql'
    try:
        with engine.begin() as conn:
            inspector = inspect(conn)
            _add_user_id_columns(conn, inspector, dialect)
            if dialect == "postgresql":
                # 列追加後の状態を見るため inspector を作り直す
                inspector = inspect(conn)
                _rebuild_unique_constraints_pg(conn, inspector)
            _assign_legacy_data(conn)
    except Exception:
        # マイグレーション失敗でアプリを止めない（ログに残して継続）
        logger.exception("migrations: 実行中にエラーが発生しました")
