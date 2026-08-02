# -*- coding: utf-8 -*-
"""売上予算プランAPI（アクション提案ロジック第4段階v2）。

年間売上予算（shops.annual_sales_budget）を季節指数で月次按分し、
基準月の必要アクセス・想定広告費・ギャップ逆算までを一気通貫で返す。

レスポンスは常にJSON（データ無しでも status と guide を返し、画面全体を隠さない）。
按分・逆算ロジックの本体は revenue_plan.py（backend直下）。
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from masters import get_or_create_default_shop
from revenue_plan import build_budget_plan

router = APIRouter(prefix="/api/revenue-plan", tags=["revenue-plan"])


@router.get("")
def get_revenue_plan(
    year_month: Optional[str] = Query(None, description="基準月 YYYY-MM（既定は当月）"),
    allowable_ad_cost: Optional[float] = Query(
        None,
        ge=0,
        description="今月かけられる広告費の上限（円）。指定時のみギャップ逆算を返す。保存はしない",
    ),
    db: Session = Depends(get_db),
):
    """売上予算プラン（月次按分＋基準月の必要アクセス・想定広告費・ギャップ逆算）。"""
    base_ym = (year_month or date.today().strftime("%Y-%m"))[:7]
    shop = get_or_create_default_shop(db)

    plan = build_budget_plan(db, shop, base_ym, allowable_ad_cost=allowable_ad_cost)
    return plan
