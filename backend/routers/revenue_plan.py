# -*- coding: utf-8 -*-
"""売上予算プランAPI（アクション提案ロジック第4段階v2）。

年間売上予算（shops.annual_sales_budget）を季節指数で月次按分し、
基準月の必要アクセス・想定広告費・ギャップ逆算までを一気通貫で返す。

レスポンスは常にJSON（データ無しでも status と guide を返し、画面全体を隠さない）。
按分・逆算ロジックの本体は revenue_plan.py（backend直下）。
"""
import re
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from masters import get_or_create_default_shop
from models import Target
from revenue_plan import build_budget_plan

router = APIRouter(prefix="/api/revenue-plan", tags=["revenue-plan"])

_YM_RE = re.compile(r"^\d{4}-\d{2}$")


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


class BudgetOverridePayload(BaseModel):
    year_month: str
    # null=補正解除（自動按分に戻す）/ 正の値=その月の売上予算を手動で上書き
    sales_budget: Optional[float] = None


@router.post("/override")
def upsert_budget_override(payload: BudgetOverridePayload, db: Session = Depends(get_db)):
    """月次売上予算の手動補正（追加指示書2章）。

    Target（店舗×月）の target_sales_budget だけを更新する専用エンドポイント。
    既存 POST /api/targets（KGIフォーム）には意図的に載せない。あちらは送られた
    全項目で上書きする型のため、フォーム保存のたびに補正が消える事故になる。
    Target行が無い月は行を新規作成する（target_sales等は0のまま。既存の評価・
    アラートは全て target_sales > 0 ガードがあるため副作用なし）。
    """
    ym = (payload.year_month or "")[:7]
    if not _YM_RE.match(ym):
        raise HTTPException(status_code=422, detail="year_month は YYYY-MM 形式で指定してください")
    value = payload.sales_budget
    if value is not None and value <= 0:
        # 0以下は「解除」として扱う（UI上は空欄=解除だが、0入力も同じ意図とみなす）
        value = None

    row = db.query(Target).filter(Target.year_month == ym, Target.archived_at.is_(None)).first()
    if row is None:
        if value is None:
            return {"year_month": ym, "sales_budget": None, "message": "補正はありません"}
        row = Target(year_month=ym)
        db.add(row)
    row.target_sales_budget = value
    db.commit()
    return {
        "year_month": ym,
        "sales_budget": value,
        "message": (
            f"{ym} の売上予算を手動補正しました" if value is not None
            else f"{ym} の補正を解除しました（自動按分に戻ります）"
        ),
    }
