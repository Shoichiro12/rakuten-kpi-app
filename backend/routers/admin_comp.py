# -*- coding: utf-8 -*-
"""無償提供（comp）管理API。

計画書 docs/jisso_keikaku_comp_management_2026-08-28.md §7〜§9 参照。
`admin.py`（アカウント一覧・閲覧セッション）とは別ファイルに分離し、
`admin.py` を肥大化させない。main.py で同じ `_admin` グループに登録する。

書き込み系（付与・解除）は `require_admin_write` を使う。
`auth.py::UserContextMiddleware` は `/api/admin/*` を読み取り専用強制の対象外に
しているため（既存の閲覧セッション終了APIのデッドロック回避が目的）、
このモジュールの書き込みエンドポイントは自前で閲覧モード中かを再チェックする
（`admin_guard.require_admin_write` が担う。§2参照）。一覧（読み取り）は
`require_admin` のままでよい（閲覧モード中でも一覧が見えること自体は問題ない）。
"""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

import billing as B
import supabase_admin
from admin_guard import require_admin, require_admin_write
from auth import AuthUser
from database import get_db
from models import CompGrant, Subscription
from tenancy import current_user_id

logger = logging.getLogger("admin_comp")

router = APIRouter(prefix="/api/admin", tags=["admin"])

# Stripe契約が実在するとみなすステータス（この状態のメールへの付与は拒否する）。
# routers/account.py::_BLOCKING_SUB_STATUSES と同じ4値（意味も同じ「契約が生きている」）。
_STRIPE_LIVE_STATUSES = ("trialing", "active", "past_due", "unpaid")


class CompGrantRequest(BaseModel):
    email: str
    note: str = Field(min_length=1)

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if not v or "@" not in v:
            raise ValueError("メールアドレスの形式が正しくありません。")
        return v

    @field_validator("note")
    @classmethod
    def _strip_note(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("付与理由（note）を入力してください。")
        return v


def _grant_out(g: CompGrant) -> dict:
    return {
        "id": g.id,
        "email": g.email,
        "target_user_id": g.target_user_id,
        "resolved": g.target_user_id is not None,
        "granted_by_email": g.granted_by_email,
        "granted_at": g.granted_at,
        "revoked_at": g.revoked_at,
        "revoked_by_email": g.revoked_by_email,
        "note": g.note,
    }


@router.get("/comp-grants")
def list_comp_grants(
    _admin: AuthUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """有効な無償提供の一覧（解除済みは含まない）。"""
    grants = (
        db.query(CompGrant)
        .filter(CompGrant.revoked_at.is_(None))
        .order_by(CompGrant.granted_at.desc())
        .all()
    )
    return {"grants": [_grant_out(g) for g in grants]}


@router.post("/comp-grants")
def create_comp_grant(
    body: CompGrantRequest,
    admin: AuthUser = Depends(require_admin_write),
    db: Session = Depends(get_db),
):
    """無償提供を付与する。

    既存アカウント（Supabase Auth に実在）なら即時に Subscription.status を
    "comp" へ書き換える（パターンA）。未登録メールなら CompGrant だけ保存し、
    本人の初回リクエストで確定させる（パターンB。billing.resolve_pending_comp_grant）。
    """
    email = body.email
    note = body.note

    # 重複付与は冪等に扱う（新しい行を作らず、既存の有効な付与をそのまま返す）。
    existing = (
        db.query(CompGrant)
        .filter(CompGrant.email == email, CompGrant.revoked_at.is_(None))
        .first()
    )
    if existing:
        return {**_grant_out(existing), "already_granted": True}

    target_user_id = None
    if supabase_admin.admin_configured():
        target = supabase_admin.find_user_by_email(email)
        if target:
            target_user_id = target.get("id")

    if target_user_id:
        # ── Stripe整合チェック（要件5）: 実在する契約があれば拒否する ──────
        # stripe_customer_id が無い（EXEMPT/TRIAL_WITHOUT_CARD由来 or 未契約）は拒否しない。
        row = db.execute(text(
            "SELECT status, stripe_customer_id FROM subscriptions WHERE user_id = :uid"
        ), {"uid": target_user_id}).fetchone()
        if row and row[1] and row[0] in _STRIPE_LIVE_STATUSES:
            raise HTTPException(
                status_code=409,
                detail=(
                    "このメールには既にStripe契約があります"
                    f"（status={row[0]}）。先にStripe側の解約手続きを行ってから、"
                    "無償提供を付与してください。"
                ),
            )

        # ── パターンA: 既存アカウントへ即時反映 ────────────────────────
        # 対象ユーザーの Subscription 行を書くため、tenancy コンテキストを
        # 一時的に対象ユーザーへ切り替える（routers/billing.py::_sync_subscription
        # と同じ手法。計画書§6-2）。
        token = current_user_id.set(target_user_id)
        try:
            s = db.query(Subscription).first()
            if s is None:
                s = Subscription()
                db.add(s)
            s.plan = B.STANDARD_PLAN
            s.status = "comp"
            s.trial_end = None
            s.current_period_end = None
        finally:
            current_user_id.reset(token)

    grant = CompGrant(
        email=email,
        target_user_id=target_user_id,
        granted_by_email=admin.email,
        note=note,
    )
    db.add(grant)
    db.commit()
    db.refresh(grant)

    logger.info(
        "無償提供を付与しました: admin=%s target_email=%s target_user_id=%s note=%s",
        admin.email, email, target_user_id, note,
    )
    return {**_grant_out(grant), "already_granted": False}


@router.post("/comp-grants/{grant_id}/revoke")
def revoke_comp_grant(
    grant_id: int,
    admin: AuthUser = Depends(require_admin_write),
    db: Session = Depends(get_db),
):
    """無償提供を解除する。

    対象が既にサインアップ済み（target_user_id 確定済み）で、その
    Subscription.status が "comp" のときだけ Subscription 行を削除し、
    「通常の未契約状態」に戻す（計画書§9）。status が comp 以外に既に
    変わっている場合は安全側に倒して何もしない（うっかり実契約を壊さない）。
    """
    grant = (
        db.query(CompGrant)
        .filter(CompGrant.id == grant_id, CompGrant.revoked_at.is_(None))
        .first()
    )
    if not grant:
        raise HTTPException(
            status_code=404,
            detail="対象の無償提供が見つかりません（既に解除済みの可能性があります）。",
        )

    subscription_touched = False
    if grant.target_user_id:
        token = current_user_id.set(grant.target_user_id)
        try:
            s = db.query(Subscription).first()
            if s is not None and s.status == "comp":
                db.delete(s)
                subscription_touched = True
        finally:
            current_user_id.reset(token)

    grant.revoked_at = datetime.utcnow()
    grant.revoked_by_email = admin.email
    db.commit()
    db.refresh(grant)

    logger.info(
        "無償提供を解除しました: admin=%s target_email=%s target_user_id=%s subscription_touched=%s",
        admin.email, grant.email, grant.target_user_id, subscription_touched,
    )
    return {**_grant_out(grant), "subscription_touched": subscription_touched}
