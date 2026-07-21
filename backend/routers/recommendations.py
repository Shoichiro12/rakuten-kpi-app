# -*- coding: utf-8 -*-
"""「今日やるべきこと」API（Phase 1）。

判定ロジックは recommendations.py、KPI計算は calculations.py が唯一の真実。
このルーターは既存の評価・逆算・ダッシュボード計算を呼び出して束ねるだけで、
指標の再実装は一切しない（数値が画面間でズレるのを防ぐため）。
"""

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import ActionLog, MonthlyItemSales
from recommendations import build_recommendations
from product_recommendations import build_product_recommendations

router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])


def _period_key(period: str, date_str: Optional[str]) -> str:
    """提案の実施記録を紐づけるキー。週次は週開始日、月次は年月。"""
    from routers.dashboard import get_week_start

    today = date.today()
    if period == "monthly":
        return (date_str[:7] if date_str else today.strftime("%Y-%m"))
    target = date.fromisoformat(date_str) if date_str else today
    return get_week_start(target).isoformat()


class CompletePayload(BaseModel):
    action_key: str
    period_key: str
    period_type: Literal["weekly", "monthly"] = "monthly"
    status: Literal["done", "snoozed"] = "done"
    title: Optional[str] = None


@router.get("")
def get_recommendations(
    period: Literal["weekly", "monthly"] = Query("monthly"),
    date_str: Optional[str] = Query(None, alias="date"),
    limit: int = Query(3, ge=1, le=10),
    db: Session = Depends(get_db),
):
    """現在の期間に対する「今日やるべきこと」を優先度順で返す。"""
    from routers.dashboard import get_dashboard
    from routers.evaluation import get_access_plan, get_matrix

    dash = get_dashboard(period=period, date_str=date_str, db=db)
    ev = get_matrix(period=period, date_str=date_str, db=db)
    ap = get_access_plan(period=period, date_str=date_str, db=db)

    pkey = _period_key(period, date_str)
    done_keys = {
        r.action_key
        for r in db.query(ActionLog).filter(ActionLog.period_key == pkey).all()
    }

    # Phase 2: 過去の実施結果から順位の微調整値を得る（サンプル不足なら空dict）
    from learning import outcome_weights

    weights = outcome_weights(db)

    items = build_recommendations(
        evaluation=(ev or {}).get("evaluation"),
        plan=(ap or {}).get("plan"),
        kpis=dash.get("kpis"),
        shop=dash.get("shop"),
        changes=dash.get("changes"),
        done_keys=done_keys,
        limit=limit,
        weights=weights,
    )

    # 商品単位の提案（「どの商品の何を直すか」）。
    # 店舗全体の提案が「CVRを上げる」で止まるのに対し、こちらは商品名まで特定する。
    # 商品分析レポートがある期間のみ（RPP未取込でも動く）。
    import calendar as _cal

    ym = _period_key("monthly", date_str) if period == "monthly" else None
    if ym is None:
        # 週次でも、その週が属する月の商品分析データを参照する
        ym = pkey[:7]
    product_rows = db.query(MonthlyItemSales).filter(
        MonthlyItemSales.year_month == ym
    ).all()
    days_in_month = _cal.monthrange(int(ym[:4]), int(ym[5:7]))[1]
    product_items = build_product_recommendations(
        items=product_rows,
        shop=dash.get("shop"),
        days_in_month=days_in_month,
        done_keys=done_keys,
        limit=limit,
    )

    gap = None
    target_sales = dash.get("target_sales") or 0
    if target_sales > 0:
        actual = (dash.get("shop") or {}).get("sales") if dash.get("shop") else None
        if actual is None:
            actual = (dash.get("kpis") or {}).get("gross") if dash.get("kpis") else None
        if actual is not None:
            gap = round(target_sales - actual, 0)

    return {
        "period": period,
        "period_label": dash.get("period_label"),
        "period_key": pkey,
        "target_gap": gap,
        "recommendations": items,
        "product_recommendations": product_items,
        "done_count": len(done_keys),
    }


@router.get("/outcomes")
def get_outcomes(db: Session = Depends(get_db)):
    """実施した施策の「その後」を返す（Phase 2 の振り返り）。

    測定できたものだけでなく、翌月データ待ち（pending）も正直に返す。
    効果は相関であって因果ではないため、UI側でも断定的な表現はしない。
    """
    from learning import MIN_SAMPLE_FOR_WEIGHT, measure_all, summarize_outcomes

    results = measure_all(db, limit=20)
    return {
        "results": results,
        "summary": summarize_outcomes(db),
        "measured_count": sum(1 for r in results if r["status"] == "measured"),
        "pending_count": sum(1 for r in results if r["status"] == "pending"),
        "min_sample_for_weight": MIN_SAMPLE_FOR_WEIGHT,
    }


@router.post("/complete")
def complete_recommendation(payload: CompletePayload, db: Session = Depends(get_db)):
    """提案の実施/スヌーズを記録する。

    実施時点のKPIスナップショットを併せて保存する（Phase 2 の効果測定用）。
    同一 action_key × period_key は1行に集約し、押し直しは状態を上書きする。
    """
    from routers.dashboard import get_dashboard

    period = payload.period_type
    date_str = payload.period_key if period == "monthly" else payload.period_key
    dash = get_dashboard(period=period, date_str=date_str, db=db)
    shop = dash.get("shop") or {}
    kpis = dash.get("kpis") or {}

    row = (
        db.query(ActionLog)
        .filter(
            ActionLog.action_key == payload.action_key,
            ActionLog.period_key == payload.period_key,
        )
        .first()
    )
    if row is None:
        row = ActionLog(
            action_key=payload.action_key,
            period_key=payload.period_key,
            period_type=period,
        )
        db.add(row)

    row.status = payload.status
    row.title = payload.title
    row.snapshot_sales = shop.get("sales") if shop else kpis.get("gross")
    row.snapshot_access = shop.get("access") if shop else kpis.get("ct")
    row.snapshot_cvr = shop.get("cvr") if shop else kpis.get("cvr")
    row.snapshot_av = shop.get("av") if shop else kpis.get("av")

    db.commit()
    return {"action_key": row.action_key, "period_key": row.period_key, "status": row.status}


@router.delete("/complete")
def undo_recommendation(
    action_key: str = Query(...),
    period_key: str = Query(...),
    db: Session = Depends(get_db),
):
    """実施/スヌーズを取り消して提案を再表示する。"""
    deleted = (
        db.query(ActionLog)
        .filter(ActionLog.action_key == action_key, ActionLog.period_key == period_key)
        .delete()
    )
    db.commit()
    return {"deleted": deleted}
