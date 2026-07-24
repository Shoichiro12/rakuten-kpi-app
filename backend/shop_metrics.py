# -*- coding: utf-8 -*-
"""店舗全体の実績（商品分析レポートベース）の共通ヘルパー。

ダッシュボードのKGI・評価マトリクス・アクセス逆算・KGIツリーは、月次では
商品分析レポート（MonthlyItemSales = 店舗全体の売上・アクセスUU）を正とする。
RPP広告経由の実績はRPP広告実績画面で別途確認できるため、KGI評価と混ぜない。

データが無い月は None を返し、呼び出し側は従来のRPP軸へフォールバックする。
"""

from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from models import MonthlyItemSales, RppWeekly
from calculations import calc_kpis


def get_shop_monthly(
    db: Session,
    year_month: str,
    exclude_management_nos: Optional[set] = None,
) -> Optional[dict]:
    """指定年月の店舗全体実績（商品分析レポート合算）を返す。

    exclude_management_nos を渡すと、その管理番号（例: 廃盤商品）を合算から除外する。

    Returns:
        sales  : 店舗全体売上（合計）
        access : アクセス人数UU（合計）
        cv     : 売上件数（合計）
        cvr    : 転換率(%) = cv ÷ UU × 100
        av     : 客単価 = sales ÷ cv
        いずれもデータが無い月は None。
    """
    q = db.query(
        MonthlyItemSales.sales,
        MonthlyItemSales.access_uu,
        MonthlyItemSales.cv,
    ).filter(MonthlyItemSales.year_month == year_month)
    if exclude_management_nos:
        q = q.filter(MonthlyItemSales.management_no.notin_(list(exclude_management_nos)))
    rows = q.all()

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


def get_rpp_month_products(
    db: Session,
    year_month: str,
    exclude_management_nos: Optional[set] = None,
) -> list:
    """指定年月のRPP実績を商品単位で合算し、限界CPO判定用のKPIを返す（原価見直しアクション用）。

    week_start がその月に含まれる RppWeekly を商品ごとに集計する。月フィルタは
    Postgres/SQLite 両対応のため日付範囲で行う（strftime を使わない）。
    Returns: [{management_no, product_name, cv, cpo, limit_cpo, limit_cpo_exceeded}, ...]
    """
    try:
        y, m = int(year_month[:4]), int(year_month[5:7])
    except (ValueError, IndexError):
        return []
    start = date(y, m, 1)
    end = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)

    rows = db.query(RppWeekly).filter(
        RppWeekly.week_start >= start, RppWeekly.week_start < end
    ).all()

    agg: dict = {}
    for r in rows:
        mno = r.management_no
        if not mno or (exclude_management_nos and mno in exclude_management_nos):
            continue
        a = agg.setdefault(mno, {
            "management_no": mno, "product_name": r.product_name,
            "gross": 0.0, "cost_of_sales": 0.0, "ad_cost": 0.0, "cv": 0, "ct": 0, "_ctr_sum": 0.0,
        })
        a["gross"] += r.gross or 0
        a["cost_of_sales"] += r.cost_of_sales or 0
        a["ad_cost"] += r.ad_cost or 0
        a["cv"] += r.cv or 0
        a["ct"] += r.ct or 0
        a["_ctr_sum"] += (r.ctr or 0) * (r.ct or 0)
        if r.product_name:
            a["product_name"] = r.product_name

    out = []
    for a in agg.values():
        ctr = a["_ctr_sum"] / a["ct"] if a["ct"] > 0 else 0.0
        k = calc_kpis(a["gross"], a["cost_of_sales"], a["ad_cost"], a["cv"], a["ct"], ctr=ctr)
        out.append({
            "management_no": a["management_no"],
            "product_name": a["product_name"],
            "cv": a["cv"],
            "cpo": k["cpo"],
            "limit_cpo": k["limit_cpo"],
            "limit_cpo_exceeded": (k["cpo"] > k["limit_cpo"]) if k["limit_cpo"] > 0 else False,
        })
    return out
