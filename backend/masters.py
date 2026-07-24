"""マスタテーブル（shops / product_categories / products / product_costs）の共通ヘルパー。

CSV取込（import_csv.py）とマスタ管理API（routers/masters.py・routers/costs.py）が共用する。

【マルチテナント前提】
これらの関数はすべてリクエスト（またはユーザーIDをセットした ContextVar）の中で呼ばれる想定。
tenancy.py のイベントにより、db.query(...) は自動で現ユーザーに絞り込まれ、db.add(...) される
新規行には現ユーザーの user_id が自動スタンプされる。したがって各関数で user_id を明示的に
触る必要はない。「デフォルト店舗」もユーザーごとに1つずつ遅延生成される（固定の id=1 は使わない）。
"""
from typing import Optional

from sqlalchemy.orm import Session

from models import Shop, ProductCategory, Product, ProductCost, RppWeekly, MonthlyItemSales

# 店舗にも商品別にも率が無いときの最終フォールバック原価率。
DEFAULT_COST_RATE = 0.6


def get_or_create_default_shop(db: Session) -> Shop:
    """現ユーザーのデフォルト店舗を取得。無ければ1つ作成して返す。

    起動時に全体で1行だけ投入する方式はマルチテナントでは使えない（どのユーザーの
    店舗か決められない）ため、最初に必要になったユーザーの分を遅延生成する。
    """
    shop = db.query(Shop).order_by(Shop.id).first()
    if shop is None:
        shop = Shop(name="メイン店舗", mall_type="rakuten")
        db.add(shop)
        db.flush()  # shop.id を確定させる（後続の Product.shop_id で使う）
    return shop


def get_or_create_category(
    db: Session,
    genre_u1: Optional[str],
    genre_u2: Optional[str],
    genre_u3: Optional[str],
) -> Optional[ProductCategory]:
    """ジャンル階層（大/中/小）から product_categories を find-or-create して返す。

    3つとも空なら None を返す（RPP実データのようにジャンル情報が無い商品は category_id=None）。
    """
    u1 = (genre_u1 or None) or None
    u2 = (genre_u2 or None) or None
    u3 = (genre_u3 or None) or None
    if not any([u1, u2, u3]):
        return None

    cat = (
        db.query(ProductCategory)
        .filter(
            ProductCategory.genre_u1 == u1,
            ProductCategory.genre_u2 == u2,
            ProductCategory.genre_u3 == u3,
        )
        .first()
    )
    if cat is None:
        cat = ProductCategory(genre_u1=u1, genre_u2=u2, genre_u3=u3)
        db.add(cat)
        db.flush()
    return cat


def upsert_product(
    db: Session,
    management_no: str,
    *,
    shop_id: int,
    product_name: Optional[str] = None,
    product_url: Optional[str] = None,
    category_id: Optional[int] = None,
) -> Optional[Product]:
    """商品マスタへ upsert。新規なら作成、既存なら name/url/category を更新する。

    - is_active は絶対に上書きしない（ユーザーが手動で立てた廃盤フラグを取込で消さないため）。
    - management_no が空の行はスキップ（None を返す）。
    - name/url/category は「値があるときだけ」更新する（取込側で欠けている情報で既存値を
      空に潰さない）。
    """
    mno = (management_no or "").strip()
    if not mno:
        return None

    prod = (
        db.query(Product)
        .filter(Product.shop_id == shop_id, Product.management_no == mno)
        .first()
    )
    if prod is None:
        prod = Product(
            shop_id=shop_id,
            management_no=mno,
            product_name=(product_name or None),
            product_url=(product_url or None),
            category_id=category_id,
        )
        db.add(prod)
    else:
        if product_name and product_name.strip():
            prod.product_name = product_name.strip()
        if product_url and product_url.strip():
            prod.product_url = product_url.strip()
        if category_id is not None:
            prod.category_id = category_id
    return prod


def make_cost_resolver(db: Session):
    """原価率の解決関数を返す（取込・recalc でまとめて掛けるとき用に率をキャッシュする）。

    解決順: ProductCost.cost_rate（商品別）→ Shop.default_cost_rate（店舗デフォルト）→ 0.6。
    戻り値は resolve(management_no) -> float。
    """
    # 商品別率を一括ロード（1回のクエリ）。
    cost_map: dict[str, float] = {
        pc.management_no: pc.cost_rate
        for pc in db.query(ProductCost).all()
        if pc.management_no
    }
    shop = db.query(Shop).order_by(Shop.id).first()
    default_rate = shop.default_cost_rate if shop and shop.default_cost_rate is not None else DEFAULT_COST_RATE

    def resolve(management_no: Optional[str]) -> float:
        mno = (management_no or "").strip()
        if mno in cost_map:
            return cost_map[mno]
        return default_rate

    return resolve


def resolve_cost_rate(db: Session, management_no: Optional[str]) -> float:
    """単発用の原価率解決（1商品だけ知りたいとき）。ループでは make_cost_resolver を使う。"""
    return make_cost_resolver(db)(management_no)


def inactive_management_nos(db: Session) -> set:
    """現ユーザーの廃盤（is_active=False）商品の management_no 集合を返す。

    集計クエリから廃盤商品を除外するのに使う。商品マスタに未登録の管理番号は
    「稼働中」とみなす（除外しない）。
    """
    return {
        p.management_no
        for p in db.query(Product).filter(Product.is_active.is_(False)).all()
        if p.management_no
    }


def recalc_rpp_cost_of_sales(db: Session, management_nos: Optional[set] = None) -> int:
    """RppWeekly の cost_of_sales を現在の原価率で掛け直す。commit はしない（呼び出し側で行う）。

    cost_of_sales = gross × resolve_rate(management_no)。
    management_nos を渡すとその商品の行だけ、None なら全行を対象にする。
    戻り値は実際に値が変わった行数。
    """
    resolve = make_cost_resolver(db)
    q = db.query(RppWeekly)
    if management_nos:
        q = q.filter(RppWeekly.management_no.in_(list(management_nos)))
    changed = 0
    for row in q.all():
        new_cost = round((row.gross or 0) * resolve(row.management_no), 0)
        if row.cost_of_sales != new_cost:
            row.cost_of_sales = new_cost
            changed += 1
    return changed


# ── 商品マスタ入力支援（自動提案キュー）────────────────────────────────────
# 取込で商品マスタは自動生成されるが、カテゴリ確定と原価率設定は手入力が要る。
# 既存データ（同カテゴリ他商品の原価率・既存カテゴリ一覧）から「たぶんこれ」を提案し、
# ユーザーはチェック＋承認で登録できるようにするための提案ロジック。


def _raw_genre_for(db: Session, management_no: str) -> tuple:
    """商品の生ジャンル (u1, u2, u3) を推定する（Product 自体はジャンル文字列を持たない）。

    優先: MonthlyItemSales（大/中/小が分かれている）→ RppWeekly.genre（"/"区切り・大/中のみ）。
    どこにも無ければ (None, None, None)。
    """
    mi = (
        db.query(MonthlyItemSales)
        .filter(MonthlyItemSales.management_no == management_no)
        .order_by(MonthlyItemSales.year_month.desc())
        .first()
    )
    if mi is not None and any([mi.genre_u1, mi.genre_u2, mi.genre_u3]):
        return (mi.genre_u1 or None, mi.genre_u2 or None, mi.genre_u3 or None)

    rw = (
        db.query(RppWeekly)
        .filter(RppWeekly.management_no == management_no, RppWeekly.genre.isnot(None))
        .first()
    )
    if rw is not None and rw.genre:
        parts = [p.strip() for p in str(rw.genre).split("/") if p.strip()]
        return (
            parts[0] if len(parts) > 0 else None,
            parts[1] if len(parts) > 1 else None,
            parts[2] if len(parts) > 2 else None,
        )
    return (None, None, None)


def _category_label(c: ProductCategory) -> str:
    return " > ".join([x for x in [c.genre_u1, c.genre_u2, c.genre_u3] if x]) or "（空カテゴリ）"


def suggest_category(db: Session, shop_id: int, management_no: str) -> Optional[dict]:
    """category_id 未設定の商品に、近い既存 ProductCategory を提案する。

    完全一致(大/中/小すべて)なら confidence="high"、大+中 または 大のみの部分一致なら "low"。
    該当なしは None（フロントで「新規カテゴリ作成」へ分岐させる）。
    戻り値: {"category_id", "label", "basis", "confidence"} | None
    """
    u1, u2, u3 = _raw_genre_for(db, management_no)
    if not any([u1, u2, u3]):
        return None

    cats = db.query(ProductCategory).all()

    # 1) 完全一致（大/中/小すべて一致）
    for c in cats:
        if (c.genre_u1, c.genre_u2, c.genre_u3) == (u1, u2, u3):
            return {"category_id": c.id, "label": _category_label(c),
                    "basis": "既存カテゴリと完全一致", "confidence": "high"}
    # 2) 大+中が一致（小は不問）
    if u1 and u2:
        for c in cats:
            if c.genre_u1 == u1 and c.genre_u2 == u2:
                return {"category_id": c.id, "label": _category_label(c),
                        "basis": "大・中分類が一致", "confidence": "low"}
    # 3) 大のみ一致
    if u1:
        for c in cats:
            if c.genre_u1 == u1:
                return {"category_id": c.id, "label": _category_label(c),
                        "basis": "大分類が一致", "confidence": "low"}
    return None


def suggest_cost_rate(db: Session, shop_id: int, management_no: str) -> dict:
    """原価率が未設定の商品に提案値を返す。

    優先: 同カテゴリ他商品の ProductCost 平均（3件以上で high、1〜2件は low）→ 店舗デフォルト(low)。
    戻り値: {"suggested_rate", "basis", "confidence"}
    """
    prod = (
        db.query(Product)
        .filter(Product.shop_id == shop_id, Product.management_no == management_no)
        .first()
    )
    cat_id = prod.category_id if prod else None

    if cat_id is not None:
        same_cat_mnos = [
            p.management_no
            for p in db.query(Product)
            .filter(Product.category_id == cat_id, Product.management_no != management_no)
            .all()
            if p.management_no
        ]
        if same_cat_mnos:
            rates = [
                pc.cost_rate
                for pc in db.query(ProductCost)
                .filter(ProductCost.management_no.in_(same_cat_mnos))
                .all()
            ]
            n = len(rates)
            if n > 0:
                avg = round(sum(rates) / n, 4)
                if n >= 3:
                    return {"suggested_rate": avg, "basis": f"同カテゴリ{n}件の平均", "confidence": "high"}
                return {"suggested_rate": avg, "basis": f"同カテゴリ{n}件の平均（少数）", "confidence": "low"}

    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    default_rate = shop.default_cost_rate if shop and shop.default_cost_rate is not None else DEFAULT_COST_RATE
    return {"suggested_rate": round(default_rate, 4), "basis": "店舗デフォルト", "confidence": "low"}


def get_review_queue(db: Session, shop_id: int) -> list[dict]:
    """category_id 未設定 または ProductCost 未登録の稼働中商品（廃盤は除外）に、
    カテゴリ・原価率の提案を付けて返す。
    """
    cost_map = {
        pc.management_no: pc.cost_rate
        for pc in db.query(ProductCost).all()
        if pc.management_no
    }
    prods = (
        db.query(Product)
        .filter(Product.shop_id == shop_id, Product.is_active.is_(True))
        .order_by(Product.management_no)
        .all()
    )
    items: list[dict] = []
    for p in prods:
        has_cat = p.category_id is not None
        has_cost = p.management_no in cost_map
        if has_cat and has_cost:
            continue  # 両方確定済みはキューに出さない
        items.append({
            "management_no": p.management_no,
            "product_name": p.product_name,
            "current": {
                "category_id": p.category_id,
                "cost_rate": cost_map.get(p.management_no),
            },
            "suggested": {
                "category": None if has_cat else suggest_category(db, shop_id, p.management_no),
                "cost_rate": suggest_cost_rate(db, shop_id, p.management_no),
            },
        })
    return items
