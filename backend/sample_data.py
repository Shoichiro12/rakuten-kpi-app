import random
from datetime import date, timedelta
from sqlalchemy.orm import Session
from models import RppWeekly, MonthlyAnalysis, Target, RppSales, MonthlyItemSales, Product, ProductCategory, ProductCost, GenreBenchmark, ItemTarget
from masters import get_or_create_default_shop, get_or_create_category, upsert_product, recalc_rpp_cost_of_sales


PRODUCTS = [
    {"product_url": "https://item.rakuten.co.jp/shop/run-001/", "management_no": "RUN-001", "product_name": "ランニングシューズ プロモデル", "genre": "スポーツ/シューズ"},
    {"product_url": "https://item.rakuten.co.jp/shop/run-002/", "management_no": "RUN-002", "product_name": "ランニングシューズ ライトモデル", "genre": "スポーツ/シューズ"},
    {"product_url": "https://item.rakuten.co.jp/shop/spw-001/", "management_no": "SPW-001", "product_name": "スポーツウェア 上着 メンズ", "genre": "スポーツ/ウェア"},
    {"product_url": "https://item.rakuten.co.jp/shop/spw-002/", "management_no": "SPW-002", "product_name": "スポーツウェア パンツ メンズ", "genre": "スポーツ/ウェア"},
    {"product_url": "https://item.rakuten.co.jp/shop/spw-003/", "management_no": "SPW-003", "product_name": "スポーツウェア セット レディース", "genre": "スポーツ/ウェア"},
    {"product_url": "https://item.rakuten.co.jp/shop/bag-001/", "management_no": "BAG-001", "product_name": "スポーツバッグ 20L", "genre": "スポーツ/バッグ"},
    {"product_url": "https://item.rakuten.co.jp/shop/bag-002/", "management_no": "BAG-002", "product_name": "ジムバッグ 大容量", "genre": "スポーツ/バッグ"},
    {"product_url": "https://item.rakuten.co.jp/shop/acc-001/", "management_no": "ACC-001", "product_name": "スポーツソックス 5足セット", "genre": "スポーツ/アクセサリ"},
    {"product_url": "https://item.rakuten.co.jp/shop/acc-002/", "management_no": "ACC-002", "product_name": "スポーツタオル 速乾", "genre": "スポーツ/アクセサリ"},
    {"product_url": "https://item.rakuten.co.jp/shop/acc-003/", "management_no": "ACC-003", "product_name": "プロテインシェイカー 600ml", "genre": "スポーツ/アクセサリ"},
    {"product_url": "https://item.rakuten.co.jp/shop/acc-004/", "management_no": "ACC-004", "product_name": "スポーツソックス ロング 3足組", "genre": "スポーツ/アクセサリ"},
]

PRICE_RANGES = {
    "RUN-001": (12800, 0.55),
    "RUN-002": (8800, 0.58),
    "SPW-001": (5800, 0.60),
    "SPW-002": (4800, 0.60),
    "SPW-003": (9800, 0.57),
    "BAG-001": (6800, 0.62),
    "BAG-002": (8800, 0.60),
    "ACC-001": (1980, 0.65),
    "ACC-002": (2480, 0.63),
    "ACC-003": (1580, 0.67),
    "ACC-004": (1780, 0.64),
}

# ─── RPP診断デモ用シナリオ ────────────────────────────────────────────────
# RPP分析ページの診断機能（calculations.detect_rpp_issues）の全パターンが
# サンプルデータ上で確認できるよう、商品ごとに「意図した課題」を仕込む。
#
#   good         … 良好（課題なし）
#   ctr_low      … CTRが全商品平均の75%未満 → 確定: クリエイティブ課題
#   cvr_low      … CVRが全商品平均(加重)の85%未満 → 確定: LP/商品ページ課題
#   roas_low     … ROAS100%割れ → 要確認: キーワード確認
#   cpc_spike    … 直近週のCPCが前週比+20%以上 → 要確認: 入札見直し
#   multi        … roas_low + ctr_low + cvr_low の複数該当
#   insufficient … クリック数10未満 → データ不足（判定スキップ）
#
# 数値レンジは平均値との相対関係が崩れないよう十分に離してある
# （CTR平均≈1.4% / CVR加重平均≈2.9%を想定した設計）。
# ─── 診断分類（diagnosis.py / 第2段階）のデモ配置 ─────────────────────────
#   ACC-003 … cvr_low + ROAS<300 + 原価率0.67設定済み → 複合条件成立 → 出血型（停止候補）
#   ACC-004 … ROAS 255〜290（合格まであと一歩）・CVR良好・原価未設定 → 惜しい群
#   SPW-003 … 新商品フェーズ → 育成型（ROAS評価を適用しない）
#   RUN-001/ACC-002 … ROAS300%以上・母数十分 → 良好型
#   ※ RUN-001のROAS下限は305（255〜300に入ると惜しい群と揺れるため）
RPP_SCENARIOS = {
    "RUN-001": {"kind": "good",         "ct": (380, 450), "ctr": (1.9, 2.2), "cvr": (4.2, 4.8), "roas": (305, 340)},
    "RUN-002": {"kind": "cpc_spike",    "ct": (320, 380), "ctr": (1.7, 1.9), "cvr": (2.9, 3.2), "cpc_base": (20, 22), "cpc_now": (29, 31)},
    "SPW-001": {"kind": "ctr_low",      "ct": (230, 280), "ctr": (0.45, 0.55), "cvr": (3.8, 4.2), "roas": (190, 230)},
    "SPW-002": {"kind": "cvr_low",      "ct": (280, 330), "ctr": (1.5, 1.7), "cvr": (1.1, 1.3), "roas": (140, 170)},
    "SPW-003": {"kind": "roas_low",     "ct": (280, 330), "ctr": (1.4, 1.6), "cvr": (3.3, 3.7), "roas": (70, 90)},
    "BAG-001": {"kind": "multi",        "ct": (180, 220), "ctr": (0.40, 0.50), "cvr": (0.9, 1.1), "roas": (55, 75)},
    "BAG-002": {"kind": "good",         "ct": (350, 420), "ctr": (2.0, 2.3), "cvr": (4.0, 4.5), "roas": (260, 320)},
    "ACC-001": {"kind": "insufficient", "ct": (4, 8),     "ctr": (0.9, 1.1), "cvr": (0, 0),     "roas": (0, 0)},
    "ACC-002": {"kind": "good",         "ct": (400, 470), "ctr": (1.9, 2.2), "cvr": (4.3, 4.9), "roas": (300, 360)},
    "ACC-003": {"kind": "cvr_low",      "ct": (250, 300), "ctr": (1.6, 1.8), "cvr": (1.2, 1.4), "roas": (150, 180)},
    "ACC-004": {"kind": "good",         "ct": (300, 360), "ctr": (1.8, 2.1), "cvr": (3.8, 4.3), "roas": (255, 290)},  # 惜しい群
}


# ─── 月次商品分析（MonthlyItemSales）デモ用シナリオ ──────────────────────────
# 商品分析レポート（site_uu 軸）側の検証パターンを商品ごとに仕込む。
# RPP軸（RppWeekly.ct）とは母数が別なので、ここでもUU母数不足・在庫課題を作る。
#
#   access_uu   … 店舗ページ実訪問UU（site_uu 軸の母数）。100未満で reliable=false。
#   stock_count … 在庫数。0=欠品 / 一桁=僅少。
#   zero_stock_days … 当月の在庫切れ日数。>0 で在庫アラート・機会損失対象。
#   genre_u3    … 小分類（RPPのgenreは大/中の2階層のみのため月次側で補完）。
#
# 仕込む代表パターン:
#   ACC-001 … UU 60台（<100）→ site_uu 軸で reliable=false（低母数の参考値表示）
#   BAG-002 … 在庫0・在庫切れ8日 → 欠品＆機会損失アラート
#   SPW-003 … 在庫3（僅少）→ 在庫僅少表示
MONTHLY_ITEM_CONFIG = {
    "RUN-001": {"genre_u3": "ロードランニング", "uu": (2800, 3400), "stock": 120, "zero_days": 0},
    "RUN-002": {"genre_u3": "初心者ランニング", "uu": (2200, 2700), "stock": 80,  "zero_days": 0},
    "SPW-001": {"genre_u3": "トップス",         "uu": (1500, 1900), "stock": 45,  "zero_days": 0},
    "SPW-002": {"genre_u3": "ボトムス",         "uu": (1300, 1700), "stock": 30,  "zero_days": 0},
    "SPW-003": {"genre_u3": "セットアップ",     "uu": (900, 1200),  "stock": 3,   "zero_days": 0},   # 在庫僅少
    "BAG-001": {"genre_u3": "トートバッグ",     "uu": (700, 1000),  "stock": 60,  "zero_days": 0},
    "BAG-002": {"genre_u3": "ボストンバッグ",   "uu": (600, 900),   "stock": 0,   "zero_days": 8},   # 欠品＋在庫切れ
    "ACC-001": {"genre_u3": "ソックス",         "uu": (55, 95),     "stock": 200, "zero_days": 0},   # UU母数不足(<100)
    "ACC-002": {"genre_u3": "タオル",           "uu": (1100, 1500), "stock": 150, "zero_days": 0},
    "ACC-003": {"genre_u3": "ボトル・シェイカー", "uu": (800, 1100),  "stock": 90,  "zero_days": 0},
    "ACC-004": {"genre_u3": "ソックス",           "uu": (700, 1000),  "stock": 110, "zero_days": 0},
}

# 廃盤（is_active=False）デモに使う商品。マスタの「廃盤除外」トグル・廃盤バッジ・
# 取扱停止アクションを検証するため、特別パターン（低母数/欠品/僅少）と重複しない商品を選ぶ。
DISCONTINUED_MANAGEMENT_NO = "SPW-002"

# ─── 売上予算プラン（第4段階v2）のデモ配置 ─────────────────────────────────
# 暦月ごとの季節係数（MonthlyItemSalesの月次生成に適用。平均≒1.0）。
# 12月=歳末商戦・3月=新生活の山、2月・8月の谷という一般的なEC季節性を模す。
_SEASONAL_FACTORS = {
    1: 0.90, 2: 0.80, 3: 1.15, 4: 0.95, 5: 0.90, 6: 1.00,
    7: 0.95, 8: 0.85, 9: 1.05, 10: 0.95, 11: 1.10, 12: 1.40,
}
# デモ店舗の年間売上予算。月平均実績（約200万円）より少し高めに置き、
# 「予算に対して不足 → 必要アクセス・想定広告費・ギャップ逆算」のデモが
# 決定的に発火するようにする（30,000,000 ÷ 12 = 月250万円）。
DEMO_ANNUAL_SALES_BUDGET = 30_000_000

# ─── ゲート判定（gates.py / 設計ドキュメント2-A）のデモ配置 ─────────────────
# RPP診断のゲート・フェーズ・意図確認が一通り確認できるよう、商品ごとに状態を仕込む。
#   BAG-002 … 在庫0（MONTHLY_ITEM_CONFIG）→ 在庫ゲートで診断から除外・入荷提案
#   BAG-001 … page_ready=False → ページ品質ゲートで「まずページ完成」提案
#   SPW-003 … 発売月=当月（新商品フェーズ）＋ roas_low → 意図確認（投資ラインの問いかけ）
#   それ以外 … 発売から1年経過の稼働済み商品として扱う
NEW_PRODUCT_MANAGEMENT_NO = "SPW-003"
PAGE_NOT_READY_MANAGEMENT_NO = "BAG-001"


def get_week_start(d: date) -> date:
    return d - timedelta(days=d.weekday() + 1) if d.weekday() != 6 else d


def _week_metrics(rng: random.Random, mgmt_no: str, week_offset: int) -> dict:
    """シナリオに基づき1商品×1週のRPP実績を生成する。

    week_offset=0 が最新週。cpc_spike は最新週だけCPCを跳ね上げ、
    前週比+20%以上（要確認: 入札見直し）を成立させる。
    """
    sc = RPP_SCENARIOS[mgmt_no]
    unit_price, _ = PRICE_RANGES[mgmt_no]

    ct = rng.randint(*sc["ct"])
    ctr = round(rng.uniform(*sc["ctr"]), 2)

    if sc["kind"] == "insufficient":
        # クリック母数不足（判定スキップ対象）。売上ゼロ〜1件の弱小広告
        cv = rng.randint(0, 1)
        gross = cv * unit_price
        ad_cost = ct * rng.uniform(25, 35)
    elif sc["kind"] == "cpc_spike":
        # CPCを直接指定し、最新週だけ急騰させる（ROASは100%以上を維持）
        cvr = rng.uniform(*sc["cvr"])
        cv = max(1, round(ct * cvr / 100))
        gross = cv * unit_price * rng.uniform(0.95, 1.05)
        cpc = rng.uniform(*(sc["cpc_now"] if week_offset == 0 else sc["cpc_base"]))
        ad_cost = ct * cpc
    else:
        # CPCを商品ごとに固定（cvr・roasの中央値から逆算）し、週ごとの揺らぎを
        # ±数%に抑える。ROAS逆算方式だと乱数の組み合わせでCPCが前週比+20%を
        # 超えて cpc_spike を誤発火することがあるため、CPC基準で生成する。
        cvr0 = sum(sc["cvr"]) / 2
        roas0 = sum(sc["roas"]) / 2
        cpc0 = unit_price * cvr0 / roas0  # = price*(cvr0/100)/(roas0/100)
        cvr = rng.uniform(*sc["cvr"])
        cv = max(1, round(ct * cvr / 100))
        gross = cv * unit_price * rng.uniform(0.97, 1.03)
        ad_cost = ct * cpc0 * rng.uniform(0.98, 1.02)

    return {
        "ct": ct,
        "ctr": ctr,
        "cv": cv,
        "gross": round(gross, 0),
        "ad_cost": round(ad_cost, 0),
        "cpc": round(ad_cost / ct, 1) if ct else 0.0,
    }


def delete_sample_data(db: Session, *, commit: bool = True) -> dict:
    """サンプルデータ（is_sample=True の行）だけを削除する。実データは触らない。

    2026-08-20 オーナー指摘への対応: 従来は生成時・全削除時に実データごと消していた。
    判定は必ず is_(True)（NULL=実データを巻き込まない）。
    削除順は参照の向きに合わせる: 明細・目標 → 商品 → カテゴリ。
    実データの商品がサンプルカテゴリを参照していた場合は未分類に戻してから消す。
    """
    deleted: dict[str, int] = {}
    for model, name in (
        (RppWeekly, "rpp_weekly"),
        (RppSales, "rpp_sales"),
        (MonthlyAnalysis, "monthly_analysis"),
        (MonthlyItemSales, "monthly_item_sales"),
        (Target, "targets"),
        (ItemTarget, "item_targets"),
        (GenreBenchmark, "genre_benchmarks"),
        (ProductCost, "product_costs"),
        (Product, "products"),
    ):
        deleted[name] = db.query(model).filter(model.is_sample.is_(True)).delete(
            synchronize_session=False
        )
    # サンプルカテゴリを参照している実データ商品は未分類へ戻す（外部参照を残さない）
    sample_cat_ids = [c.id for c in db.query(ProductCategory).filter(ProductCategory.is_sample.is_(True)).all()]
    if sample_cat_ids:
        db.query(Product).filter(Product.category_id.in_(sample_cat_ids)).update(
            {Product.category_id: None}, synchronize_session=False
        )
    deleted["product_categories"] = db.query(ProductCategory).filter(
        ProductCategory.is_sample.is_(True)
    ).delete(synchronize_session=False)
    # synchronize_session=False で消した行のORMオブジェクトがセッションに残ると、
    # 直後の再生成で同じ主キーを再利用したときに identity map の警告が出るため破棄する
    db.expire_all()
    if commit:
        db.commit()
    return deleted


def _get_or_create_sample_category(db: Session, u1, u2, u3):
    """カテゴリの find-or-create。**新規作成したときだけ** is_sample を立てる。

    既存カテゴリ（実データ由来）に is_sample を立てると、サンプル削除で
    利用者のカテゴリごと消えてしまうため。
    """
    u1n = (u1 or None) or None
    u2n = (u2 or None) or None
    u3n = (u3 or None) or None
    if not any([u1n, u2n, u3n]):
        return None
    existing = (
        db.query(ProductCategory)
        .filter(
            ProductCategory.genre_u1 == u1n,
            ProductCategory.genre_u2 == u2n,
            ProductCategory.genre_u3 == u3n,
        )
        .first()
    )
    if existing is not None:
        return existing
    cat = get_or_create_category(db, u1n, u2n, u3n)
    if cat is not None:
        cat.is_sample = True
    return cat


def generate_sample_data(db: Session):
    # 意図的に対象外のテーブル:
    #   subscriptions          … 実際のStripe契約状態。ダミーを入れると課金画面が嘘をつく。
    #   consulting_inquiries   … 問い合わせの受信記録。アプリ内に閲覧画面が無く（通知メールが
    #                            一次チャネル）、ダミーを足してもデモ・動作確認に寄与しない。
    #   feedbacks              … フィードバックの受信記録。理由は consulting_inquiries と同じ。
    #
    # 2026-08-20: 実データを消す db.query(...).delete() の一括削除をやめ、
    # 「サンプル分（is_sample=True）だけを消してから作り直す」方式に変更した。
    # 実データ取込み後でも安心してサンプルを再生成・削除できる。
    # **無条件の全削除に戻さないこと**（実データが消える事故報告あり・2026-08-20）。
    delete_sample_data(db, commit=False)

    # 実データと管理番号が衝突する場合（同じ管理番号の実績・商品が既にある）、
    # その商品はユニーク制約に当たるため生成をスキップする（実データ優先）。
    sample_mnos = [p["management_no"] for p in PRODUCTS] + ["NEW-001"]
    conflict_mnos: set[str] = set()
    for model, col in ((MonthlyItemSales, MonthlyItemSales.management_no),
                       (RppSales, RppSales.item_code),
                       (Product, Product.management_no)):
        for (mno,) in (
            db.query(col)
            .filter(col.in_(sample_mnos), model.is_sample.isnot(True))
            .distinct()
            .all()
        ):
            if mno:
                conflict_mnos.add(mno)

    today = date.today()
    current_week_start = get_week_start(today)

    rng = random.Random(42)

    # ── 週次: RppWeekly（既存集計用）+ RppSales（RPP分析・診断用）を同じ数値で生成 ──
    weekly_rows: list[dict] = []
    for week_offset in range(8):
        week_start = current_week_start - timedelta(weeks=week_offset)
        week_end = week_start + timedelta(days=6)

        for product in PRODUCTS:
            mgmt_no = product["management_no"]
            if mgmt_no in conflict_mnos:
                continue
            _, cost_rate = PRICE_RANGES[mgmt_no]
            m = _week_metrics(rng, mgmt_no, week_offset)

            db.add(RppWeekly(
                is_sample=True,
                week_start=week_start,
                product_url=product["product_url"],
                management_no=mgmt_no,
                product_name=product["product_name"],
                genre=product["genre"],
                gross=m["gross"],
                cost_of_sales=round(m["gross"] * (cost_rate + rng.uniform(-0.02, 0.02)), 0),
                ad_cost=m["ad_cost"],
                cv=m["cv"],
                ct=m["ct"],
                ctr=m["ctr"],
                cpc=round(m["cpc"], 0),
            ))

            # 12h値は720h値の約7割（実レポートの傾向に合わせたサンプル比率）
            cv_12 = round(m["cv"] * 0.7)
            gross_12 = round(m["gross"] * 0.7, 0)
            row = {
                "is_sample": True,
                "period_type": "weekly",
                "year_month": week_start.strftime("%Y-%m"),
                "date_from": week_start.isoformat(),
                "date_to": week_end.isoformat(),
                "item_code": mgmt_no,
                "item_url": product["product_url"],
                "product_name": product["product_name"],
                "bid_price": int(m["cpc"] * 1.2) or 10,
                "ct": m["ct"],
                "ad_cost": int(m["ad_cost"]),
                "cpc_actual": m["cpc"],
                "ctr": m["ctr"],
                "gross_720": m["gross"],
                "cv_720": m["cv"],
                "cvr_720": round(m["cv"] / m["ct"] * 100, 2) if m["ct"] else 0.0,
                "roas_720": round(m["gross"] / m["ad_cost"] * 100, 1) if m["ad_cost"] else 0.0,
                "cpo_720": round(m["ad_cost"] / m["cv"], 0) if m["cv"] else 0.0,
                "gross_12": gross_12,
                "cv_12": cv_12,
                "cvr_12": round(cv_12 / m["ct"] * 100, 2) if m["ct"] else 0.0,
                "roas_12": round(gross_12 / m["ad_cost"] * 100, 1) if m["ad_cost"] else 0.0,
                "cpo_12": round(m["ad_cost"] / cv_12, 0) if cv_12 else 0.0,
            }
            weekly_rows.append(row)
            db.add(RppSales(**row))

    # ── 月次: 週次RppSalesを week_start の月で束ねて月次行を作る ──
    # （実データ同様、RPP分析ページの月次タブ・月次診断の動作確認用）
    monthly_agg: dict[tuple[str, str], list[dict]] = {}
    for r in weekly_rows:
        monthly_agg.setdefault((r["year_month"], r["item_code"]), []).append(r)

    for (ym, mgmt_no), rows in monthly_agg.items():
        y, mo = map(int, ym.split("-"))
        last_day = (date(y + (mo == 12), mo % 12 + 1, 1) - timedelta(days=1)).day
        ct = sum(r["ct"] for r in rows)
        ad_cost = sum(r["ad_cost"] for r in rows)
        gross_720 = sum(r["gross_720"] for r in rows)
        cv_720 = sum(r["cv_720"] for r in rows)
        gross_12 = sum(r["gross_12"] for r in rows)
        cv_12 = sum(r["cv_12"] for r in rows)
        first = rows[0]
        db.add(RppSales(
            is_sample=True,
            period_type="monthly",
            year_month=ym,
            date_from=f"{ym}-01",
            date_to=f"{ym}-{last_day:02d}",
            item_code=mgmt_no,
            item_url=first["item_url"],
            product_name=first["product_name"],
            bid_price=max(r["bid_price"] for r in rows),
            ct=ct,
            ad_cost=ad_cost,
            cpc_actual=round(ad_cost / ct, 1) if ct else 0.0,
            ctr=round(sum(r["ctr"] for r in rows) / len(rows), 2),
            gross_720=gross_720,
            cv_720=cv_720,
            cvr_720=round(cv_720 / ct * 100, 2) if ct else 0.0,
            roas_720=round(gross_720 / ad_cost * 100, 1) if ad_cost else 0.0,
            cpo_720=round(ad_cost / cv_720, 0) if cv_720 else 0.0,
            gross_12=gross_12,
            cv_12=cv_12,
            cvr_12=round(cv_12 / ct * 100, 2) if ct else 0.0,
            roas_12=round(gross_12 / ad_cost * 100, 1) if ad_cost else 0.0,
            cpo_12=round(ad_cost / cv_12, 0) if cv_12 else 0.0,
        ))

    # ── 月次商品分析（レガシー）と目標は従来どおり ──
    for month_offset in range(2):
        month_date = date(today.year, today.month, 1)
        if month_offset == 1:
            if month_date.month == 1:
                month_date = date(month_date.year - 1, 12, 1)
            else:
                month_date = date(month_date.year, month_date.month - 1, 1)
        year_month = month_date.strftime("%Y-%m")

        for product in PRODUCTS:
            mgmt_no = product["management_no"]
            if mgmt_no in conflict_mnos:
                continue
            unit_price, _ = PRICE_RANGES[mgmt_no]
            factor = 1.0 if month_offset == 0 else 0.9

            cv_monthly = int(rng.gauss(120, 20) * factor)
            sales = cv_monthly * unit_price * rng.uniform(0.95, 1.05)
            access = int(cv_monthly / rng.uniform(0.008, 0.02))

            db.add(MonthlyAnalysis(
                is_sample=True,
                year_month=year_month,
                product_url=product["product_url"],
                management_no=mgmt_no,
                product_name=product["product_name"],
                genre=product["genre"],
                sales=round(sales, 0),
                access_count=access,
                cv=cv_monthly,
            ))

    # ── 月次商品分析（MonthlyItemSales / 新スキーマ）──
    # site_uu 軸（アクセスUU）の集計・GAP分析・商品別KPI・在庫アラート・
    # 100UUルール（reliable=false）をこのデータで検証する。
    #
    # 第4段階v2（売上予算プラン）から14ヶ月分を生成する:
    #   - 暦月12種をカバーする12ヶ月以上の有効実績 → 季節指数按分（confidence=medium）
    #     がサンプルデータ上で決定的に発火する
    #   - 12月（歳末商戦）と3月（新生活）に山のある季節カーブを仕込み、按分プレビューで
    #     月ごとの予算差が目視できるようにする
    # 商品ごとの基準CVRを固定する（毎月引き直すと乱数ノイズが季節係数を埋もれさせ、
    # 按分プレビューの季節カーブが読めなくなるため。月ごとの揺らぎは±5%に抑える）
    _item_base_cvr = {p["management_no"]: rng.uniform(0.8, 3.0) for p in PRODUCTS}

    for month_offset in range(14):
        y = today.year
        m = today.month - month_offset
        while m <= 0:
            m += 12
            y -= 1
        month_date = date(y, m, 1)
        year_month = month_date.strftime("%Y-%m")
        # 暦月ごとの季節係数（平均≒1.0）。12月・3月が山、2月・8月が谷。
        factor = _SEASONAL_FACTORS[month_date.month]

        for product in PRODUCTS:
            mgmt_no = product["management_no"]
            if mgmt_no in conflict_mnos:
                continue
            unit_price, cost_rate = PRICE_RANGES[mgmt_no]
            cfg = MONTHLY_ITEM_CONFIG[mgmt_no]

            # ジャンルを大/中に分割し、小分類はconfigで補完（RPPは大/中の2階層のみ）
            g_parts = product["genre"].split("/")
            genre_u1 = g_parts[0] if len(g_parts) > 0 else "未分類"
            genre_u2 = g_parts[1] if len(g_parts) > 1 else "未分類"
            genre_u3 = cfg["genre_u3"]

            access_uu = int(rng.randint(*cfg["uu"]) * factor)
            # ACC-001 はUU母数不足（<100 → reliable=false）のデモ商品。季節係数で
            # 100を超えてデモが壊れないよう上限を固定する。
            if mgmt_no == "ACC-001":
                access_uu = min(access_uu, 95)
            # 転換率は商品ごとの基準値（0.8〜3.0%）に月±5%の揺らぎ（UU→注文）
            cvr = round(_item_base_cvr[mgmt_no] * rng.uniform(0.95, 1.05), 2)
            cv = max(0, round(access_uu * cvr / 100))
            sales = round(cv * unit_price * rng.uniform(0.95, 1.05), 0)
            zero_days = cfg["zero_days"]

            db.add(MonthlyItemSales(
                is_sample=True,
                year_month=year_month,
                management_no=mgmt_no,
                product_url=product["product_url"],
                product_name=product["product_name"],
                genre_u1=genre_u1,
                genre_u2=genre_u2,
                genre_u3=genre_u3,
                price=unit_price,
                stock_count=cfg["stock"],
                access_uu=access_uu,
                access_count=int(access_uu * rng.uniform(1.1, 1.4)),  # 件数はUUより多い
                cvr=cvr,
                cv=cv,
                sales=sales,
                sales_qty=cv,
                avg_price=unit_price,
                zero_stock_days=zero_days,
                review_count=rng.randint(0, 40),
                review_score=round(rng.uniform(3.2, 4.9), 1),
            ))

    for month_offset in range(2):
        month_date = date(today.year, today.month, 1)
        if month_offset == 1:
            if month_date.month == 1:
                month_date = date(month_date.year - 1, 12, 1)
            else:
                month_date = date(month_date.year, month_date.month - 1, 1)
        year_month = month_date.strftime("%Y-%m")

        # 実データの目標が既にある月はスキップ（unique制約 uq_target_user_month を守る。
        # 利用者が設定した目標をサンプルで潰さない）
        if db.query(Target.id).filter(Target.year_month == year_month).first() is not None:
            continue
        db.add(Target(
            is_sample=True,
            year_month=year_month,
            target_sales=5_000_000,
            target_access=50000,
            target_cvr=1.5,
            target_av=7000,
            expense_rate=0.15,
        ))

    # ── 商品マスタ（products / categories / costs）＋各種デモ ──
    # マスタ機能（廃盤・原価連携）とマスタ入力支援（自動提案キュー）にデモデータを供給する。
    # カテゴリは大/中（u1/u2）でまとめる。小分類(u3)まで割ると各商品が単独カテゴリになり
    # 「同カテゴリ平均」の原価率提案が成立しないため。
    #
    # 提案キューにわざと残す商品:
    #   RUN-002 … カテゴリ未設定・原価率未設定 → カテゴリ提案（既存シューズと一致=高信頼）を検証
    #   ACC-004 … カテゴリ設定済み・原価率のみ未設定 → 同カテゴリ平均(ACC-001/2/3=3件)からの高信頼提案を検証
    CATEGORY_UNSET = {"RUN-002"}
    COST_UNSET = {"RUN-002", "ACC-004"}

    shop = get_or_create_default_shop(db)
    # 売上予算プラン（第4段階v2）のデモ: 年間売上予算と予算年度起点（1月=暦年）。
    # ⚠️ 上書きガード（2026-08-02 オーナー指示）: Shopの設定値はサンプル再生成で
    # 消えてはいけない利用者データ。現在値が NULL のときだけデモ値を埋め、
    # 既に値が入っている場合（UIから設定済み・デモ値済みとも）は触らない。
    # 本番で「UIから設定した年間予算が再生成で問答無用に上書きされる」事象が
    # 実際に確認されたための修正。変更検知のような複雑な判定はしない方針。
    if shop.annual_sales_budget is None:
        shop.annual_sales_budget = DEMO_ANNUAL_SALES_BUDGET
    if shop.budget_year_start_month is None:
        shop.budget_year_start_month = 1
    for product in PRODUCTS:
        mno = product["management_no"]
        if mno in conflict_mnos:
            continue
        g_parts = product["genre"].split("/")
        u1 = g_parts[0] if len(g_parts) > 0 else None
        u2 = g_parts[1] if len(g_parts) > 1 else None
        # カテゴリは「新規作成分だけ」is_sample を立てる（既存＝実データ由来は消さない）
        cat = None if mno in CATEGORY_UNSET else _get_or_create_sample_category(db, u1, u2, None)
        prod = upsert_product(
            db, mno, shop_id=shop.id,
            product_name=product["product_name"],
            product_url=product["product_url"],
            category_id=cat.id if cat else None,
        )
        if prod is None:
            continue
        # conflict_mnos で実データ商品を除外済みなので、ここに来る商品は必ずサンプル
        prod.is_sample = True
        # 未分類で残したい商品は明示的に None（upsert は値があるときだけ更新するため）。
        if mno in CATEGORY_UNSET:
            prod.category_id = None
        # 1件だけ廃盤にして廃盤機能（除外トグル・バッジ・取扱停止）を検証（旧モデル想定）。
        if mno == DISCONTINUED_MANAGEMENT_NO:
            prod.is_active = False
        # ── ゲート判定デモ（gates.py）: フェーズ・ページ品質の状態を仕込む ──
        if mno == NEW_PRODUCT_MANAGEMENT_NO:
            # 発売月=当月 → 新商品フェーズ（3ヶ月様子見）。roas_low と組み合わせて
            # 意図確認（「投資ラインとして許容範囲か」）の表示を検証する。
            prod.launch_month = today.strftime("%Y-%m")
        else:
            # それ以外は1年前発売の稼働済み商品（自動推定に依存しない決定的なデモ）
            prod.launch_month = f"{today.year - 1}-{today.month:02d}"
        if mno == PAGE_NOT_READY_MANAGEMENT_NO:
            # ページ未完成 → ページ品質ゲートで広告提案を止め「まずページ完成」を提示
            prod.page_ready = False
        # 原価率（個別）: 提案キューのデモ対象以外に設定する（PRICE_RANGES の原価率を流用）。
        if mno not in COST_UNSET:
            rate = PRICE_RANGES[mno][1]
            pc = db.query(ProductCost).filter(ProductCost.management_no == mno).first()
            if pc is None:
                db.add(ProductCost(management_no=mno, cost_rate=rate, is_sample=True))
            else:
                pc.cost_rate = rate

    # カテゴリ未設定デモ商品が「完全一致=高信頼」のカテゴリ提案を受けられるよう、
    # その商品の小分類まで含む既存カテゴリを用意しておく（取込で既に存在する想定を再現）。
    for mno in CATEGORY_UNSET:
        pdef = next((p for p in PRODUCTS if p["management_no"] == mno), None)
        if pdef is not None:
            gp = pdef["genre"].split("/")
            _get_or_create_sample_category(
                db,
                gp[0] if len(gp) > 0 else None,
                gp[1] if len(gp) > 1 else None,
                MONTHLY_ITEM_CONFIG.get(mno, {}).get("genre_u3"),
            )

    # ── アイテム別目標（item_targets / 3-B''）のデモ ──
    #   RUN-001 … 実績あり → 確定公式(rule)。前年実績は無いため「現状値のみ採用」の注記付き
    #   NEW-001 … 実績データが無い新商品 → 自店平均からの推定(estimated)＋承認フローを検証
    if "NEW-001" not in conflict_mnos:
        # ⚠️ upsert_product の戻り値を直接使うこと。このセッションは autoflush=False のため、
        # add 直後に db.query で引き直すと未フラッシュの行が見えず None になる
        # （旧実装はこれで launch_month が設定されない潜在バグだった。2026-08-20 修正）
        prod_new = upsert_product(db, "NEW-001", shop_id=shop.id, product_name="新商品サンプル（実績データなし）")
        if prod_new is not None:
            prod_new.launch_month = today.strftime("%Y-%m")
            prod_new.is_sample = True
    db.flush()

    from target_calc import calc_item_target
    cur_ym = today.strftime("%Y-%m")
    for mno, sales_target in (("RUN-001", 1_500_000), ("NEW-001", 300_000)):
        if mno in conflict_mnos:
            continue
        # 実データのアイテム別目標が同キーに残っている場合はスキップ（潰さない）
        if db.query(ItemTarget.id).filter(
            ItemTarget.management_no == mno, ItemTarget.year_month == cur_ym,
        ).first() is not None:
            continue
        calc = calc_item_target(db, mno, cur_ym, sales_target)
        db.add(ItemTarget(
            is_sample=True,
            management_no=mno, year_month=cur_ym, target_sales=sales_target, **calc,
        ))

    # ── ジャンル別ベンチマーク手入力のデモ（benchmarks.py の①を検証）──
    # RMS画面で見た値を入力した想定。RPP診断のベースライン解決が
    # manual_genre → shop_avg → default とフォールバックする様子を確認できる。
    # 同じ階層×指標の実データが既にあれば追加しない（重複行を作らない）
    if db.query(GenreBenchmark.id).filter(
        GenreBenchmark.genre_u1 == "スポーツ", GenreBenchmark.genre_u2 == "シューズ",
        GenreBenchmark.genre_u3.is_(None), GenreBenchmark.metric == "ctr",
    ).first() is None:
        db.add(GenreBenchmark(
            is_sample=True,
            genre_u1="スポーツ", genre_u2="シューズ", genre_u3=None,
            metric="ctr", value=1.8, memo="RMS表示値（デモデータ）",
        ))

    db.flush()
    recalc_rpp_cost_of_sales(db)  # 個別原価率を RppWeekly に反映
    db.commit()
    return {"skipped_mnos": sorted(conflict_mnos)}
