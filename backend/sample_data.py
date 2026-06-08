import random
from datetime import date, timedelta
from sqlalchemy.orm import Session
from models import RppWeekly, MonthlyAnalysis, Target


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
}


def get_week_start(d: date) -> date:
    return d - timedelta(days=d.weekday() + 1) if d.weekday() != 6 else d


def generate_sample_data(db: Session):
    db.query(RppWeekly).delete()
    db.query(MonthlyAnalysis).delete()
    db.query(Target).delete()

    today = date.today()
    current_week_start = get_week_start(today)

    rng = random.Random(42)

    for week_offset in range(8):
        week_start = current_week_start - timedelta(weeks=week_offset)

        for product in PRODUCTS:
            mgmt_no = product["management_no"]
            unit_price, cost_rate = PRICE_RANGES[mgmt_no]

            trend_factor = 1.0 + week_offset * 0.03
            cv = max(1, int(rng.gauss(30 + (8 - week_offset) * 5, 8) / trend_factor))
            gross = cv * unit_price * rng.uniform(0.9, 1.1)
            cost_of_sales = gross * (cost_rate + rng.uniform(-0.02, 0.02))
            ad_cost = gross * rng.uniform(0.08, 0.15)

            ctr_base = rng.uniform(0.8, 2.5)
            cvr_pct = rng.uniform(0.5, 2.5)
            ct = max(1, int(cv / (cvr_pct / 100)))
            cpc = ad_cost / ct if ct > 0 else 0

            row = RppWeekly(
                week_start=week_start,
                product_url=product["product_url"],
                management_no=mgmt_no,
                product_name=product["product_name"],
                genre=product["genre"],
                gross=round(gross, 0),
                cost_of_sales=round(cost_of_sales, 0),
                ad_cost=round(ad_cost, 0),
                cv=cv,
                ct=ct,
                ctr=round(ctr_base, 2),
                cpc=round(cpc, 0),
            )
            db.add(row)

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
            unit_price, _ = PRICE_RANGES[mgmt_no]
            factor = 1.0 if month_offset == 0 else 0.9

            cv_monthly = int(rng.gauss(120, 20) * factor)
            sales = cv_monthly * unit_price * rng.uniform(0.95, 1.05)
            access = int(cv_monthly / rng.uniform(0.008, 0.02))

            row = MonthlyAnalysis(
                year_month=year_month,
                product_url=product["product_url"],
                management_no=mgmt_no,
                product_name=product["product_name"],
                genre=product["genre"],
                sales=round(sales, 0),
                access_count=access,
                cv=cv_monthly,
            )
            db.add(row)

    for month_offset in range(2):
        month_date = date(today.year, today.month, 1)
        if month_offset == 1:
            if month_date.month == 1:
                month_date = date(month_date.year - 1, 12, 1)
            else:
                month_date = date(month_date.year, month_date.month - 1, 1)
        year_month = month_date.strftime("%Y-%m")

        target = Target(
            year_month=year_month,
            target_sales=5_000_000,
            target_access=50000,
            target_cvr=1.5,
            target_av=7000,
            expense_rate=0.15,
        )
        db.add(target)

    db.commit()
