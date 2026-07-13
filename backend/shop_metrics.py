# -*- coding: utf-8 -*-
"""店舗全体の実績（商品分析レポートベース）の共通ヘルパー。

ダッシュボードのKGI・評価マトリクス・アクセス逆算・KGIツリーは、月次では
商品分析レポート（MonthlyItemSales = 店舗全体の売上・アクセスUU）を正とする。
RPP広告経由の実績はRPP広告実績画面で別途確認できるため、KGI評価と混ぜない。

データが無い月は None を返し、呼び出し側は従来のRPP軸へフォールバックする。
"""

from typing import Optional

from sqlalchemy.orm import Session

from models import MonthlyItemSales


def get_shop_monthly(db: Session, year_month: str) -> Optional[dict]:
    """指定年月の店舗全体実績（商品分析レポート合算）を返す。

    Returns:
        sales  : 店舗全体売上（合計）
        access : アクセス人数UU（合計）
        cv     : 売上件数（合計）
        cvr    : 転換率(%) = cv ÷ UU × 100
        av     : 客単価 = sales ÷ cv
        いずれもデータが無い月は None。
    """
    rows = db.query(
        MonthlyItemSales.sales,
        MonthlyItemSales.access_uu,
        MonthlyItemSales.cv,
    ).filter(MonthlyItemSales.year_month == year_month).all()

    if not rows:
        return None

    sales = sum(r.sales or 0 for r in rows)
    uu = sum(r.access_uu or 0 for r in rows)
    cv = sum(r.cv or 0 for r in rows)

    return {
        "sales": sales,
        "access": uu,
        "cv": cv,
        "cvr": round((cv / uu * 100) if uu > 0 else 0, 2),
        "av": round((sales / cv) if cv > 0 else 0, 0),
    }
