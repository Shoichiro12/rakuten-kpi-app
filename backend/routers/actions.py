from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from database import get_db
from models import ActionCheck, InventoryStatus, MonthlyItemSales, Product

router = APIRouter(prefix="/api/actions", tags=["actions"])


def _resolve_product(db: Session, management_no: Optional[str], product_url: Optional[str]) -> Optional[Product]:
    """商品マスタ（products）から該当商品を引く。management_no優先、無ければproduct_url。"""
    if management_no:
        p = db.query(Product).filter(Product.management_no == management_no).first()
        if p:
            return p
    if product_url:
        return db.query(Product).filter(Product.product_url == product_url).first()
    return None


def _latest_monthly(db: Session, management_no: Optional[str], product_url: Optional[str]):
    """最新月の商品分析データ（在庫数の元データ）を返す。management_no優先。"""
    conds = []
    if management_no:
        conds.append(MonthlyItemSales.management_no == management_no)
    if product_url:
        conds.append(MonthlyItemSales.product_url == product_url)
    if not conds:
        return None
    return (
        db.query(MonthlyItemSales)
        .filter(or_(*conds))
        .order_by(MonthlyItemSales.year_month.desc())
        .first()
    )


class ToggleActionPayload(BaseModel):
    product_url: str
    week_key: str
    action_key: str


class ToggleInventoryPayload(BaseModel):
    product_url: Optional[str] = None
    management_no: Optional[str] = None


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
    product_url: Optional[str] = Query(None),
    management_no: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """在庫ステータスを返す（要件No.4: 在庫データの自動連携／products マスタ基盤）。

    解決順（source）:
      1. inactive  … 商品マスタで is_active=False（廃盤・取扱停止）なら在庫なし扱い。
      2. auto      … 月次商品分析（MonthlyItemSales）の在庫数から自動判定。
      3. manual    … 上記いずれも無ければ従来の手動ステータス（InventoryStatus）。

    management_no を主キーに解決し、product_url は後方互換として受け付ける
    （既存 ActionPanel は product_url ベースで呼ぶ）。
    """
    prod = _resolve_product(db, management_no, product_url)
    is_active = prod.is_active if prod is not None else None
    # 商品マスタの management_no/url を採用（呼び出し側が片方しか持たない場合の補完）
    mno = management_no or (prod.management_no if prod else None)
    purl = product_url or (prod.product_url if prod else None)

    # 1) 廃盤（取扱停止）は在庫連携より優先して「在庫なし」を返す
    if is_active is False:
        return {
            "product_url": purl,
            "management_no": mno,
            "has_inventory": False,
            "is_active": False,
            "source": "inactive",
            "stock_count": None,
            "zero_stock_days": None,
            "year_month": None,
        }

    # 2) 月次商品分析の在庫数から自動判定
    item = _latest_monthly(db, mno, purl)
    if item is not None:
        return {
            "product_url": purl,
            "management_no": mno or item.management_no,
            "has_inventory": (item.stock_count or 0) > 0,
            "is_active": is_active,
            "source": "auto",
            "stock_count": item.stock_count or 0,
            "zero_stock_days": item.zero_stock_days or 0,
            "year_month": item.year_month,
        }

    # 3) 手動ステータス（InventoryStatus）にフォールバック
    row = None
    if purl:
        row = db.query(InventoryStatus).filter(InventoryStatus.product_url == purl).first()
    return {
        "product_url": purl,
        "management_no": mno,
        "has_inventory": row.has_inventory if row else True,
        "is_active": is_active,
        "source": "manual",
        "stock_count": None,
        "zero_stock_days": None,
        "year_month": None,
    }


@router.post("/inventory/toggle")
def toggle_inventory(payload: ToggleInventoryPayload, db: Session = Depends(get_db)):
    """手動在庫ステータスをトグルする。

    InventoryStatus は product_url キーのため、management_no だけ渡された場合は
    商品マスタ／月次データから product_url を解決してから切り替える。
    """
    purl = payload.product_url
    if not purl and payload.management_no:
        prod = _resolve_product(db, payload.management_no, None)
        if prod and prod.product_url:
            purl = prod.product_url
        else:
            item = _latest_monthly(db, payload.management_no, None)
            purl = item.product_url if item and item.product_url else None
    if not purl:
        # url を特定できないときは管理番号を疑似キーにして状態だけ保持する
        purl = f"code:{payload.management_no}" if payload.management_no else None
    if not purl:
        return {"product_url": None, "management_no": payload.management_no,
                "has_inventory": True, "error": "商品を特定できませんでした"}

    row = db.query(InventoryStatus).filter(InventoryStatus.product_url == purl).first()
    if row:
        row.has_inventory = not row.has_inventory
    else:
        row = InventoryStatus(product_url=purl, has_inventory=False)
        db.add(row)

    db.commit()
    return {"product_url": purl, "management_no": payload.management_no, "has_inventory": row.has_inventory}
