from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
from models import Target

router = APIRouter(prefix="/api/targets", tags=["targets"])


class TargetIn(BaseModel):
    year_month: str
    target_sales: float = 0
    target_access: int = 0
    target_cvr: float = 0
    target_av: float = 0
    expense_rate: float = 0.15


@router.get("")
def list_targets(db: Session = Depends(get_db)):
    targets = db.query(Target).order_by(Target.year_month.desc()).all()
    return [
        {
            "year_month": t.year_month,
            "target_sales": t.target_sales,
            "target_access": t.target_access,
            "target_cvr": t.target_cvr,
            "target_av": t.target_av,
            "expense_rate": t.expense_rate,
        }
        for t in targets
    ]


@router.get("/{year_month}")
def get_target(year_month: str, db: Session = Depends(get_db)):
    target = db.query(Target).filter(Target.year_month == year_month).first()
    if not target:
        raise HTTPException(status_code=404, detail="目標が設定されていません")
    return target


@router.post("")
def upsert_target(payload: TargetIn, db: Session = Depends(get_db)):
    existing = db.query(Target).filter(Target.year_month == payload.year_month).first()
    if existing:
        existing.target_sales = payload.target_sales
        existing.target_access = payload.target_access
        existing.target_cvr = payload.target_cvr
        existing.target_av = payload.target_av
        existing.expense_rate = payload.expense_rate
    else:
        db.add(Target(**payload.model_dump()))
    db.commit()
    return {"message": f"{payload.year_month} の目標を保存しました"}
