"""既存データから商品マスタ（products / product_categories）を一括生成するワンショットスクリプト。

背景:
    import_csv.py の自動同期は「これ以降の新規取込」にしか効かない。すでに RppWeekly /
    MonthlyItemSales に入っている過去データ分の商品はマスタに存在しないため、distinct な
    management_no を拾って products を一括生成する。

やること:
    1. MonthlyItemSales から distinct management_no を拾い、ジャンル（genre_u1/u2/u3）を
       product_categories に find-or-create して products へ upsert（category_id つき）。
    2. RppWeekly から distinct management_no を拾い、月次で拾えなかった商品を products へ
       upsert（RPPはジャンル情報が無いため category_id=None）。
    is_active は upsert_product 側で上書きしないため、既存の手動フラグは保持される。

実行方法（backend ディレクトリで）:
    # ローカル/単一テナント（user_id NULL のデータ）を対象にする場合
    py -3 scripts/backfill_products.py

    # 本番などで特定ユーザー（テナント）のデータを対象にする場合
    #   ユーザーUUIDは Supabase → Authentication → Users で確認できる
    py -3 scripts/backfill_products.py --user-id <SUPABASE_USER_UUID>

    # DB を明示する場合は環境変数 DATABASE_URL を渡す（database.py が参照する）
    #   例: DATABASE_URL=sqlite:///./rakuten_kpi.db py -3 scripts/backfill_products.py

冪等: 何度実行しても既存商品は更新されるだけで重複行は作られない。
"""
import argparse
import os
import sys

# backend ディレクトリを import パスに追加（models / database 等は bare import のため）。
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from database import SessionLocal  # noqa: E402
from tenancy import current_user_id  # noqa: E402
from models import RppWeekly, MonthlyItemSales  # noqa: E402
from masters import get_or_create_default_shop, get_or_create_category, upsert_product  # noqa: E402


def backfill(db) -> dict:
    shop = get_or_create_default_shop(db)
    seen: set[str] = set()
    created_or_updated = 0

    # 1) 月次商品分析（ジャンルあり）を先に処理してカテゴリを紐付ける。
    monthly_rows = (
        db.query(
            MonthlyItemSales.management_no,
            MonthlyItemSales.product_name,
            MonthlyItemSales.product_url,
            MonthlyItemSales.genre_u1,
            MonthlyItemSales.genre_u2,
            MonthlyItemSales.genre_u3,
        )
        .all()
    )
    for mno, name, url, u1, u2, u3 in monthly_rows:
        mno = (mno or "").strip()
        if not mno or mno in seen:
            continue
        seen.add(mno)
        cat = get_or_create_category(db, u1, u2, u3)
        upsert_product(
            db, mno, shop_id=shop.id,
            product_name=name, product_url=url,
            category_id=cat.id if cat else None,
        )
        created_or_updated += 1

    # 2) RPP週次（ジャンルなし）。月次で拾えなかった商品を補完する。
    rpp_rows = (
        db.query(RppWeekly.management_no, RppWeekly.product_name, RppWeekly.product_url).all()
    )
    for mno, name, url in rpp_rows:
        mno = (mno or "").strip()
        if not mno or mno in seen:
            continue
        seen.add(mno)
        upsert_product(
            db, mno, shop_id=shop.id,
            product_name=name, product_url=url,
            category_id=None,
        )
        created_or_updated += 1

    db.commit()
    return {"distinct_management_no": len(seen), "upserted": created_or_updated, "shop_id": shop.id}


def main():
    parser = argparse.ArgumentParser(description="既存データから商品マスタを一括生成する")
    parser.add_argument(
        "--user-id", default=None,
        help="対象ユーザー（テナント）のUUID。未指定なら user_id NULL のローカル/単一テナントを対象。",
    )
    args = parser.parse_args()

    token = current_user_id.set(args.user_id)
    db = SessionLocal()
    try:
        result = backfill(db)
    finally:
        db.close()
        current_user_id.reset(token)

    scope = args.user_id or "(user_id NULL / ローカル)"
    print(
        f"backfill 完了: 対象={scope} / distinct management_no={result['distinct_management_no']}件 "
        f"/ products upsert={result['upserted']}件 / shop_id={result['shop_id']}"
    )


if __name__ == "__main__":
    main()
