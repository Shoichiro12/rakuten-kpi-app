# -*- coding: utf-8 -*-
"""評価マトリクスAPI（要件レポート No.1 / No.2）。

売上×KPI（アクセス・CVR・客単価）の達成/未達の組み合わせ（17パターン）を
目標比×YoYの統一ロジックで判定し、評価ランク（◎○△×）と対策優先度を返す。
ダッシュボードとGAP分析の両方から参照される。
"""

import calendar
from datetime import date, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from models import RppWeekly, Target
from evaluation import judge_metric, evaluate_matrix, MIN_ACCESS_SAMPLE
from shop_metrics import get_shop_monthly

router = APIRouter(prefix="/api/evaluation", tags=["evaluation"])


def _get_week_start(d: date) -> date:
    weekday = d.isoweekday() % 7
    return d - timedelta(days=weekday)


def _prev_month(ym: str) -> str:
    year, month = int(ym[:4]), int(ym[5:7])
    if month == 1:
        return f"{year - 1}-12"
    return f"{year}-{month - 1:02d}"


def _month_bounds(ym: str) -> tuple[date, date]:
    year, month = int(ym[:4]), int(ym[5:7])
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


def _agg(rows) -> Optional[dict]:
    """RPP軸の実績集計。kpi-tree と同じ定義で統一する。

    access = クリック数(ct) / cvr = cv/ct / av = gross/cv
    """
    if not rows:
        return None
    gross = sum(r.gross for r in rows)
    cv = sum(r.cv for r in rows)
    ct = sum(r.ct for r in rows)
    return {
        "gross": gross,
        "access": ct,
        "cvr": round((cv / ct * 100) if ct > 0 else 0, 2),
        "av": round((gross / cv) if cv > 0 else 0, 0),
    }


@router.get("/matrix")
def get_matrix(
    period: Literal["weekly", "monthly"] = Query("weekly"),
    date_str: Optional[str] = Query(None, alias="date"),
    include_inactive: bool = Query(True, description="Falseで廃盤（is_active=False）商品を集計から除外"),
    db: Session = Depends(get_db),
):
    """ショップ全体の評価マトリクスを返す。

    - monthly: 当月実績 vs 月次目標、YoYは前年同月
    - weekly : 週実績 vs 月次目標の日割り按分（目標×7÷当月日数）、YoYは52週前
    """
    from masters import inactive_management_nos
    # 既定(True)は従来どおり全商品込み。Falseで廃盤を集計から除外する。
    inactive = set() if include_inactive else inactive_management_nos(db)
    today = date.today()

    if period == "weekly":
        current_week = _get_week_start(date.fromisoformat(date_str) if date_str else today)
        prev_year_week = current_week - timedelta(weeks=52)
        current_rows = db.query(RppWeekly).filter(RppWeekly.week_start == current_week).all()
        prev_year_rows = db.query(RppWeekly).filter(RppWeekly.week_start == prev_year_week).all()
        year_month = current_week.strftime("%Y-%m")
        period_label = f"{current_week} 〜 {current_week + timedelta(days=6)}"
    else:
        year_month = date_str[:7] if date_str else today.strftime("%Y-%m")
        m_start, m_end = _month_bounds(year_month)
        py_ym = f"{int(year_month[:4]) - 1}-{year_month[5:7]}"
        py_start, py_end = _month_bounds(py_ym)
        current_rows = db.query(RppWeekly).filter(
            RppWeekly.week_start >= m_start, RppWeekly.week_start < m_end
        ).all()
        prev_year_rows = db.query(RppWeekly).filter(
            RppWeekly.week_start >= py_start, RppWeekly.week_start < py_end
        ).all()
        period_label = year_month

    if inactive:
        current_rows = [r for r in current_rows if r.management_no not in inactive]
        prev_year_rows = [r for r in prev_year_rows if r.management_no not in inactive]

    current = _agg(current_rows)
    prev_year = _agg(prev_year_rows)

    # 月次は商品分析レポート（店舗全体売上・UU）を正とする。無い月はRPP軸のまま。
    axis = "rpp"
    if period == "monthly":
        shop_cur = get_shop_monthly(db, year_month, exclude_management_nos=inactive or None)
        if shop_cur:
            axis = "shop"
            current = {
                "gross": shop_cur["sales"], "access": shop_cur["access"],
                "cvr": shop_cur["cvr"], "av": shop_cur["av"],
            }
            shop_py = get_shop_monthly(db, py_ym, exclude_management_nos=inactive or None)
            prev_year = {
                "gross": shop_py["sales"], "access": shop_py["access"],
                "cvr": shop_py["cvr"], "av": shop_py["av"],
            } if shop_py else None

    if not current:
        return {
            "period": period,
            "period_label": period_label,
            "has_data": False,
            "evaluation": None,
        }

    target = db.query(Target).filter(Target.year_month == year_month).first()

    # 目標値の期間換算。
    # 売上・アクセスはフロー量なので週次では日割り按分（×7/当月日数）。
    # CVR・客単価は比率・単価なので按分せずそのまま使う。
    t_sales = t_access = t_cvr = t_av = None
    if target:
        if period == "weekly":
            days_in_month = calendar.monthrange(int(year_month[:4]), int(year_month[5:7]))[1]
            ratio = 7 / days_in_month
            t_sales = target.target_sales * ratio if target.target_sales > 0 else None
            t_access = target.target_access * ratio if target.target_access > 0 else None
        else:
            t_sales = target.target_sales if target.target_sales > 0 else None
            t_access = target.target_access if target.target_access > 0 else None
        t_cvr = target.target_cvr if target.target_cvr > 0 else None
        t_av = target.target_av if target.target_av > 0 else None

    def _py(key: str) -> Optional[float]:
        return prev_year[key] if prev_year else None

    access_label = "アクセス人数（UU）" if axis == "shop" else "アクセス（RPPクリック数）"
    sales_j = judge_metric("sales", "売上", current["gross"], t_sales, _py("gross"))
    access_j = judge_metric("access", access_label, current["access"], t_access, _py("access"))
    cvr_j = judge_metric("cvr", "転換率（CVR）", current["cvr"], t_cvr, _py("cvr"))
    av_j = judge_metric("av", "客単価", current["av"], t_av, _py("av"))

    # 100UUルール（要件No.6）: アクセス母数不足時はCVR・客単価を評価対象外にする
    low_sample = current["access"] < MIN_ACCESS_SAMPLE
    result = evaluate_matrix(sales_j, access_j, cvr_j, av_j, low_sample=low_sample)

    return {
        "period": period,
        "period_label": period_label,
        "has_data": True,
        "has_target": target is not None,
        "axis": axis,
        "evaluation": result,
    }


@router.get("/access-plan")
def get_access_plan(
    period: Literal["weekly", "monthly"] = Query("weekly"),
    date_str: Optional[str] = Query(None, alias="date"),
    db: Session = Depends(get_db),
):
    """アクセス逆算プラン（目標売上→必要アクセス→不足分→想定追加広告費）。"""
    import calendar as _cal
    today = date.today()

    if period == "weekly":
        current_week = _get_week_start(date.fromisoformat(date_str) if date_str else today)
        rows = db.query(RppWeekly).filter(RppWeekly.week_start == current_week).all()
        year_month = current_week.strftime("%Y-%m")
        period_label = f"{current_week} 〜 {current_week + timedelta(days=6)}"
    else:
        year_month = date_str[:7] if date_str else today.strftime("%Y-%m")
        m_start, m_end = _month_bounds(year_month)
        rows = db.query(RppWeekly).filter(
            RppWeekly.week_start >= m_start, RppWeekly.week_start < m_end
        ).all()
        period_label = year_month

    current = _agg(rows)
    # 月次は商品分析レポート（店舗全体）ベースで逆算。CPCのみRPP実績から算出。
    if period == "monthly":
        shop_cur = get_shop_monthly(db, year_month)
        if shop_cur:
            current = {
                "gross": shop_cur["sales"], "access": shop_cur["access"],
                "cvr": shop_cur["cvr"], "av": shop_cur["av"],
            }
    target = db.query(Target).filter(Target.year_month == year_month).first()

    if not current or not target or target.target_sales <= 0:
        return {
            "period": period, "period_label": period_label,
            "has_data": current is not None,
            "has_target": target is not None and (target.target_sales or 0) > 0,
            "plan": None,
        }

    t_sales = target.target_sales
    if period == "weekly":
        days_in_month = _cal.monthrange(int(year_month[:4]), int(year_month[5:7]))[1]
        t_sales = t_sales * 7 / days_in_month

    gross = current["gross"]; ct = current["access"]; cvr = current["cvr"]; av = current["av"]
    rows_ad_cost = sum(r.ad_cost for r in rows)
    # CPCは必ずRPPの実クリック数で算出する（商品分析軸ではctがUUのため混同しない）
    rpp_ct = sum(r.ct for r in rows)
    cpc = rows_ad_cost / rpp_ct if rpp_ct > 0 else 0
    if cvr <= 0 or av <= 0:
        return {"period": period, "period_label": period_label, "has_data": True, "has_target": True, "plan": None}

    required_access = t_sales / (cvr / 100 * av)
    shortfall_ct = max(0.0, required_access - ct)
    est_additional_ad_cost = shortfall_ct * cpc if cpc > 0 else None
    fill_rate = ct / required_access * 100 if required_access > 0 else None

    return {
        "period": period, "period_label": period_label, "has_data": True, "has_target": True,
        "plan": {
            "target_sales": round(t_sales, 0), "actual_gross": gross, "actual_ct": ct,
            "cvr": cvr, "av": av, "cpc": round(cpc, 1), "ad_cost": rows_ad_cost,
            "required_access": round(required_access, 0), "shortfall_ct": round(shortfall_ct, 0),
            "est_additional_ad_cost": round(est_additional_ad_cost, 0) if est_additional_ad_cost is not None else None,
            "fill_rate": round(fill_rate, 1) if fill_rate is not None else None,
            "achieved": shortfall_ct <= 0,
        },
    }
