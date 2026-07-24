"""在庫アラート一覧API（/api/inventory）。

推奨アクション（今日やるべきこと）は上位数件しか出さないため、欠品・在庫僅少の
商品を「機会損失順で全部」把握できる worklist をここで提供する。
判定は最新（または指定）月の商品分析データ（MonthlyItemSales）を根拠にする。

- 欠品(out)   : 在庫数<=0 もしくは 当月に在庫0日数>0
- 僅少(low)   : まだ在庫はあるが、販売ペースからすると RESTOCK_ALERT_DAYS 日以内に欠品
- 廃盤(is_active=False)は取扱停止のため対象外
"""
import calendar
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import MonthlyItemSales, Shop
from masters import inactive_management_nos
from product_recommendations import RESTOCK_ALERT_DAYS

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


def _days_in_month(ym: str) -> int:
    return calendar.monthrange(int(ym[:4]), int(ym[5:7]))[1]


@router.get("/alerts")
def get_inventory_alerts(
    year_month: Optional[str] = Query(None, description="YYYY-MM。未指定は最新月"),
    db: Session = Depends(get_db),
):
    """欠品・在庫僅少の商品を機会損失順で返す（廃盤は除外）。"""
    ym = year_month or db.query(func.max(MonthlyItemSales.year_month)).scalar()
    if not ym:
        return {"year_month": None, "count": 0, "out_count": 0, "low_count": 0, "items": []}

    inactive = inactive_management_nos(db)
    days_in_month = _days_in_month(ym)
    # 在庫僅少の閾値は店舗設定（restock_lead_days）を優先。未設定は既定14日。
    _shop = db.query(Shop).first()
    threshold_days = (_shop.restock_lead_days if _shop and _shop.restock_lead_days else RESTOCK_ALERT_DAYS)
    rows = db.query(MonthlyItemSales).filter(MonthlyItemSales.year_month == ym).all()

    items = []
    for r in rows:
        if r.management_no in inactive:
            continue
        stock = r.stock_count or 0
        zero_days = r.zero_stock_days or 0
        qty = (r.sales_qty or 0) or (r.cv or 0)
        per_day = qty / max(1, days_in_month) if qty > 0 else 0.0
        cv = r.cv or 0
        av = (r.sales or 0) / cv if cv > 0 else (r.avg_price or 0)

        status = None
        days_left = None
        if stock <= 0 or zero_days > 0:
            status = "out"
        elif per_day > 0 and (stock / per_day) < threshold_days:
            status = "low"
            days_left = round(stock / per_day, 1)
        if status is None:
            continue

        # 機会損失/売上規模（ランキング用）。欠品は在庫切れ日数から概算、僅少は月換算。
        if status == "out" and zero_days > 0 and (r.sales or 0) > 0:
            active_days = max(1, days_in_month - zero_days)
            value_at_risk = (r.sales or 0) / active_days * zero_days
        else:
            value_at_risk = per_day * av * days_in_month if per_day > 0 else (r.sales or 0)

        items.append({
            "management_no": r.management_no,
            "product_name": r.product_name,
            "status": status,                 # "out"（欠品）/ "low"（僅少）
            "stock_count": stock,
            "zero_stock_days": zero_days,
            "days_left": days_left,           # 僅少のみ推定残り日数
            "sales": r.sales or 0,
            "value_at_risk": round(value_at_risk),
        })

    items.sort(key=lambda x: x["value_at_risk"], reverse=True)
    out_count = sum(1 for i in items if i["status"] == "out")
    low_count = sum(1 for i in items if i["status"] == "low")
    return {
        "year_month": ym,
        "count": len(items),
        "out_count": out_count,
        "low_count": low_count,
        "threshold_days": threshold_days,
        "items": items,
    }
