# -*- coding: utf-8 -*-
"""管理者専用API（アカウント一覧＝区切り1。閲覧セッションの開始・終了・履歴＝区切り2）。

計画書 docs/jisso_keikaku_admin_viewer_2026-08-26.md 参照。
契約状態と無関係な第3のグループとして main.py に登録する（_paid でも _auth 単体でもない）。

閲覧モードの実際の「対象データが読める・書き込みは403になる」という強制は
ここではなく auth.py の UserContextMiddleware が行う（X-Admin-View-Session ヘッダの
検証と tenancy.current_user_id の一時的な上書き）。このファイルはセッションの
発行・終了・監査ログの読み出しだけを担当する。
"""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

import admin_view
import supabase_admin
from admin_guard import require_admin
from auth import AuthUser
from database import get_db
from models import AdminViewSession

logger = logging.getLogger("admin")

router = APIRouter(prefix="/api/admin", tags=["admin"])

# サンプルデータだけの行を「取込あり」と誤認しないための条件（migrations.py の
# _mark_legacy_sample_rows と同じ書き方で統一）。
_NOT_SAMPLE = "(is_sample IS NULL OR is_sample = FALSE)"


@router.get("/accounts")
def list_accounts(
    _admin: AuthUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """登録アカウント一覧（メール・登録日・課金状態・最終ログイン・データ取込有無）。

    Supabase Auth（ユーザー本体・Admin API）とアプリDB（契約・データ取込状況）を
    user_id をキーにマージして返す。契約・データ集計は生SQL＝tenancy の自動絞り込みを
    受けない全ユーザー横断クエリ（GET /api/security-status と同じパターン）。
    """
    if not supabase_admin.admin_configured():
        return {"accounts": [], "configured": False, "count": 0}

    auth_users = supabase_admin.list_users()

    sub_rows = db.execute(text(
        "SELECT user_id, status FROM subscriptions WHERE user_id IS NOT NULL"
    )).fetchall()
    sub_status_by_user = {r[0]: r[1] for r in sub_rows}

    shop_rows = db.execute(text(
        "SELECT user_id, name FROM shops WHERE user_id IS NOT NULL"
    )).fetchall()
    shop_by_user = {r[0]: r[1] for r in shop_rows}

    rpp_rows = db.execute(text(
        f"SELECT user_id, COUNT(*) FROM rpp_weekly "
        f"WHERE user_id IS NOT NULL AND {_NOT_SAMPLE} GROUP BY user_id"
    )).fetchall()
    rpp_count_by_user = {r[0]: r[1] for r in rpp_rows}

    monthly_rows = db.execute(text(
        f"SELECT user_id, COUNT(*) FROM monthly_item_sales "
        f"WHERE user_id IS NOT NULL AND {_NOT_SAMPLE} GROUP BY user_id"
    )).fetchall()
    monthly_count_by_user = {r[0]: r[1] for r in monthly_rows}

    accounts = []
    for u in auth_users:
        uid = u.get("id")
        rpp_count = rpp_count_by_user.get(uid, 0)
        monthly_count = monthly_count_by_user.get(uid, 0)
        accounts.append({
            "user_id": uid,
            "email": u.get("email"),
            "created_at": u.get("created_at"),
            "last_sign_in_at": u.get("last_sign_in_at"),
            "shop_name": shop_by_user.get(uid),
            "subscription_status": sub_status_by_user.get(uid),
            "has_data": bool(rpp_count or monthly_count),
            "rpp_rows": rpp_count,
            "monthly_rows": monthly_count,
        })

    accounts.sort(key=lambda a: a["created_at"] or "", reverse=True)
    return {"accounts": accounts, "configured": True, "count": len(accounts)}


class StartViewSessionRequest(BaseModel):
    target_user_id: str


def _session_out(session: AdminViewSession) -> dict:
    return {
        "id": session.id,
        "admin_email": session.admin_email,
        "target_user_id": session.target_user_id,
        "target_email": session.target_email,
        "started_at": session.started_at,
        "ended_at": session.ended_at,
        "expires_at": session.expires_at,
    }


@router.post("/view-sessions")
def start_view_session(
    body: StartViewSessionRequest,
    request: Request,
    admin: AuthUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """閲覧セッションを開始する。

    - 対象アカウントが Supabase Auth 側に実在するかを確認する（実在しない/削除済みなら404）。
    - 同じ管理者の既存の未終了セッションは自動終了する（1管理者につき同時に1セッションのみ。
      複数タブでの多重閲覧による混乱を避ける。§4-2 手順4）。
    - 生トークンはこのレスポンスでのみ返す。DBにはハッシュしか残らない。
    """
    if not supabase_admin.admin_configured():
        raise HTTPException(
            status_code=501,
            detail="Supabase Admin API が未設定のため閲覧セッションを開始できません。",
        )

    target = supabase_admin.get_user(body.target_user_id)
    if not target:
        raise HTTPException(status_code=404, detail="対象アカウントが見つかりません。")

    now = datetime.utcnow()
    # 自分（この管理者）が開始した未終了セッションを自動終了する
    # （AdminViewSession は UserScopedMixin なので tenancy が「自分の行」に自動絞込する）。
    open_sessions = db.query(AdminViewSession).filter(AdminViewSession.ended_at.is_(None)).all()
    for s in open_sessions:
        s.ended_at = now

    raw_token = admin_view.new_token()
    session = AdminViewSession(
        admin_email=admin.email,
        target_user_id=body.target_user_id,
        target_email=target.get("email"),
        session_token_hash=admin_view.hash_token(raw_token),
        started_at=now,
        expires_at=now + admin_view.SESSION_DURATION,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    logger.info(
        "管理者閲覧セッション開始: admin=%s target=%s session_id=%s",
        admin.email, target.get("email"), session.id,
    )

    return {**_session_out(session), "session_token": raw_token}


@router.post("/view-sessions/{session_id}/end")
def end_view_session(
    session_id: int,
    admin: AuthUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """閲覧セッションを終了する。自分（管理者自身）が開始したセッションのみ対象。

    tenancy により他の管理者が開始したセッションはそもそも見えない（404になる）。
    """
    session = db.query(AdminViewSession).filter(AdminViewSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="閲覧セッションが見つかりません。")
    if session.ended_at is None:
        session.ended_at = datetime.utcnow()
        db.commit()
        db.refresh(session)
        logger.info(
            "管理者閲覧セッション終了: admin=%s target=%s session_id=%s",
            admin.email, session.target_email, session.id,
        )
    return _session_out(session)


@router.get("/view-sessions")
def list_view_sessions(
    _admin: AuthUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """閲覧セッションの履歴（監査ログの確認用）。自分（管理者自身）が開始したものだけ。

    要件2「閲覧の開始・終了・対象を監査ログとしてDBに記録する」を人間が確認できる
    最低限のGET一覧（優先度は低いが用意する。§4-2 手順6）。
    """
    sessions = (
        db.query(AdminViewSession)
        .order_by(AdminViewSession.started_at.desc())
        .limit(200)
        .all()
    )
    return {"sessions": [_session_out(s) for s in sessions]}
