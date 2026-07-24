from datetime import date, timedelta
from typing import Literal, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from models import RppWeekly
from calculations import calc_kpis
from masters import inactive_management_nos

router = APIRouter(prefix="/api/products", tags=["products"])


def get_week_start(d: date) -> date:
    weekday = d.isoweekday() % 7
    return d - timedelta(days=weekday)


def _month_bounds(ym: str) -> tuple[date, date]:
    """'YYYY-MM' から [月初, 翌月初) の半開区間を返す。

    strftime は SQLite 専用SQL関数で PostgreSQL(本番=Supabase)では動かないため、
    Date型の範囲フィルタに統一する（gap_analysis.py と同方針）。
    """
    year, month = int(ym[:4]), int(ym[5:7])
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


@router.get("")
def list_products(
    period: Literal["weekly", "monthly"] = Query("weekly"),
    date_str: Optional[str] = Query(None, alias="date"),
    genre: Optional[str] = Query(None),
    include_inactive: bool = Query(False, description="Trueで廃盤（is_active=False）商品も含める"),
    db: Session = Depends(get_db),
):
    today = date.today()
    # 廃盤商品は既定で商品KPI一覧から除外する（マスタ未登録の管理番号は稼働中扱い）。
    # is_active バッジ表示のため廃盤集合は常に把握し、除外に使うかだけを切り替える。
    all_inactive = inactive_management_nos(db)
    inactive = set() if include_inactive else all_inactive

    if period == "weekly":
        target_date = date.fromisoformat(date_str) if date_str else today
        week_start = get_week_start(target_date)
        q = db.query(RppWeekly).filter(RppWeekly.week_start == week_start)
    else:
        ym = date_str[:7] if date_str else today.strftime("%Y-%m")
        m_start, m_end = _month_bounds(ym)
        q = db.query(RppWeekly).filter(
            RppWeekly.week_start >= m_start, RppWeekly.week_start < m_end
        )

    if genre:
        q = q.filter(RppWeekly.genre == genre)

    rows = q.all()

    # 月次では同一商品が週ごとに複数レコード存在するため、商品管理番号
    # （無ければ商品URL）をキーに合算して1商品=1行に統一する。
    # 商品名・ジャンル・URLは最新週（week_start 最大）のレコードの値を採用する。
    # 週次でも同一キーは1件のみなので、同じ集約処理で安全に動作する。
    agg: dict = {}
    for r in rows:
        key = r.management_no or r.product_url
        if key not in agg:
            agg[key] = {
                "product_url": r.product_url,
                "management_no": r.management_no,
                "product_name": r.product_name,
                "genre": r.genre,
                "week_start": r.week_start,
                "gross": 0.0, "cost_of_sales": 0.0, "ad_cost": 0.0,
                "cv": 0, "ct": 0, "_ctr_sum": 0.0,
            }
        a = agg[key]
        a["gross"] += r.gross
        a["cost_of_sales"] += r.cost_of_sales
        a["ad_cost"] += r.ad_cost
        a["cv"] += r.cv
        a["ct"] += r.ct
        a["_ctr_sum"] += r.ctr * r.ct  # ct加重平均用
        # 最新週の属性（商品名・ジャンル・URL）で上書き
        if r.week_start >= a["week_start"]:
            a["week_start"] = r.week_start
            a["product_url"] = r.product_url
            a["management_no"] = r.management_no
            a["product_name"] = r.product_name
            a["genre"] = r.genre

    result = []
    for a in agg.values():
        # 廃盤商品を除外（include_inactive=True のときは inactive が空なので通過）
        if a["management_no"] and a["management_no"] in inactive:
            continue
        ctr = a["_ctr_sum"] / a["ct"] if a["ct"] > 0 else 0.0
        kpis = calc_kpis(a["gross"], a["cost_of_sales"], a["ad_cost"], a["cv"], a["ct"], ctr=ctr)
        result.append({
            "product_url": a["product_url"],
            "management_no": a["management_no"],
            "product_name": a["product_name"],
            "genre": a["genre"],
            "week_start": a["week_start"].isoformat() if period == "weekly" else None,
            "is_active": (a["management_no"] not in all_inactive) if a["management_no"] else True,
            **kpis,
            "limit_cpo_exceeded": kpis["cpo"] > kpis["limit_cpo"] if kpis["limit_cpo"] > 0 else False,
        })

    result.sort(key=lambda x: x["gross"], reverse=True)
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
