from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import ActionCheck, InventoryStatus

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
def get_inventory(product_url: str, db: Session = Depends(get_db)):
    row = db.query(InventoryStatus).filter(
        InventoryStatus.product_url == product_url
    ).first()
    return {"product_url": product_url, "has_inventory": row.has_inventory if row else True}


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
