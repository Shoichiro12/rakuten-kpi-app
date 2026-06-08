from datetime import date, timedelta
from typing import Literal, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db
from models import RppWeekly
from calculations import calc_kpis

router = APIRouter(prefix="/api/products", tags=["products"])


def get_week_start(d: date) -> date:
    weekday = d.isoweekday() % 7
    return d - timedelta(days=weekday)


@router.get("")
def list_products(
    period: Literal["weekly", "monthly"] = Query("weekly"),
    date_str: Optional[str] = Query(None, alias="date"),
    genre: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    today = date.today()

    if period == "weekly":
        target_date = date.fromisoformat(date_str) if date_str else today
        week_start = get_week_start(target_date)
        q = db.query(RppWeekly).filter(RppWeekly.week_start == week_start)
    else:
        ym = date_str[:7] if date_str else today.strftime("%Y-%m")
        q = db.query(RppWeekly).filter(func.strftime("%Y-%m", RppWeekly.week_start) == ym)

    if genre:
        q = q.filter(RppWeekly.genre == genre)

    rows = q.order_by(RppWeekly.gross.desc()).all()

    result = []
    for r in rows:
        kpis = calc_kpis(r.gross, r.cost_of_sales, r.ad_cost, r.cv, r.ct, ctr=r.ctr)
        result.append({
            "product_url": r.product_url,
            "management_no": r.management_no,
            "product_name": r.product_name,
            "genre": r.genre,
            "week_start": r.week_start.isoformat() if period == "weekly" else None,
            **kpis,
            "limit_cpo_exceeded": kpis["cpo"] > kpis["limit_cpo"] if kpis["limit_cpo"] > 0 else False,
        })

    return {"products": result, "count": len(result)}


@router.get("/trend/{management_no}")
def product_trend(
    management_no: str,
    weeks: int = Query(8, ge=1, le=52),
    db: Session = Depends(get_db),
):
    today = date.today()
    current_week = get_week_start(today)

    result = []
    for i in range(weeks - 1, -1, -1):
        week_start = current_week - timedelta(weeks=i)
        row = db.query(RppWeekly).filter(
            RppWeekly.management_no == management_no,
            RppWeekly.week_start == week_start,
        ).first()

        if row:
            kpis = calc_kpis(row.gross, row.cost_of_sales, row.ad_cost, row.cv, row.ct, ctr=row.ctr)
            result.append({
                "week": week_start.isoformat(),
                "label": f"{week_start.month}/{week_start.day}",
                **kpis,
            })
        else:
            result.append({
                "week": week_start.isoformat(),
                "label": f"{week_start.month}/{week_start.day}",
                "gross": 0, "gp": 0, "ad_cost": 0, "rev": 0,
                "roi": 0, "roas": 0, "cvr": 0, "cpc": 0, "cv": 0,
            })

    return {"management_no": management_no, "trend": result}


@router.get("/genres")
def list_genres(db: Session = Depends(get_db)):
    rows = db.query(RppWeekly.genre).distinct().all()
    return {"genres": [r.genre for r in rows if r.genre]}
