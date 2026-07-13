from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import get_db
from models import ActionCheck, InventoryStatus, MonthlyItemSales

router = APIRouter(prefix="/api/actions", tags=["actions"])


class ToggleActionPayload(BaseModel):
    product_url: str
    week_key: str
    action_key: str


class ToggleInventoryPayload(BaseModel):
    product_url: str


@router.get("")
def get_actions(product_url: str, week_key: str, db: Session = Depends(get_db)):
    rows = db.query(ActionCheck).filter(
        ActionCheck.product_url == product_url,
        ActionCheck.week_key == week_key,
    ).all()
    return {r.action_key: r.checked for r in rows}


@router.post("/toggle")
def toggle_action(payload: ToggleActionPayload, db: Session = Depends(get_db)):
    row = db.query(ActionCheck).filter(
        ActionCheck.product_url == payload.product_url,
        ActionCheck.week_key == payload.week_key,
        ActionCheck.action_key == payload.action_key,
    ).first()

    if row:
        row.checked = not row.checked
    else:
        row = ActionCheck(
            product_url=payload.product_url,
            week_key=payload.week_key,
            action_key=payload.action_key,
            checked=True,
        )
        db.add(row)

    db.commit()
    return {"action_key": payload.action_key, "checked": row.checked}


@router.get("/inventory")
def get_inventory(
    product_url: str,
    management_no: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """在庫ステータスを返す（要件No.4: 在庫データの自動連携）。

    月次商品分析データ（MonthlyItemSales）に該当商品があれば、取り込み済みの
    在庫数から自動判定する（source='auto'）。無い場合のみ従来の手動ステータス
    （InventoryStatus）にフォールバックする（source='manual'）。
    """
    conds = [MonthlyItemSales.product_url == product_url]
    if management_no:
        conds.append(MonthlyItemSales.management_no == management_no)

    item = (
        db.query(MonthlyItemSales)
        .filter(or_(*conds))
        .order_by(MonthlyItemSales.year_month.desc())
        .first()
    )

    if item is not None:
        return {
            "product_url": product_url,
            "has_inventory": (item.stock_count or 0) > 0,
            "source": "auto",
            "stock_count": item.stock_count or 0,
            "zero_stock_days": item.zero_stock_days or 0,
            "year_month": item.year_month,
        }

    row = db.query(InventoryStatus).filter(
        InventoryStatus.product_url == product_url
    ).first()
    return {
        "product_url": product_url,
        "has_inventory": row.has_inventory if row else True,
        "source": "manual",
        "stock_count": None,
        "zero_stock_days": None,
        "year_month": None,
    }


@router.post("/inventory/toggle")
def toggle_inventory(payload: ToggleInventoryPayload, db: Session = Depends(get_db)):
    row = db.query(InventoryStatus).filter(
        InventoryStatus.product_url == payload.product_url
    ).first()

    if row:
        row.has_inventory = not row.has_inventory
    else:
        row = InventoryStatus(product_url=payload.product_url, has_inventory=False)
        db.add(row)

    db.commit()
    return {"product_url": payload.product_url, "has_inventory": row.has_inventory}
