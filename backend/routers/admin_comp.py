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
import urllib.parse
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

import billing as B
import notifications
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

_MAX_EMAIL_LEN = 200
_MAX_MESSAGE_LEN = 1000

# 招待の連打防止（計画書§8-4）。それ以上厳密な制限は入れない。
_RESEND_MIN_INTERVAL = timedelta(seconds=60)


class CompGrantRequest(BaseModel):
    email: str
    note: str


class InviteRequest(BaseModel):
    email: str
    note: str
    message: Optional[str] = None


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
        "invited_at": g.invited_at,
        "invite_status": g.invite_status,
    }


def _validate_email_note(email: str, note: str) -> tuple[str, str]:
    email = (email or "").strip().lower()
    note = (note or "").strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="メールアドレスの形式が正しくありません。")
    if len(email) > _MAX_EMAIL_LEN:
        raise HTTPException(status_code=400, detail="メールアドレスが長すぎます。")
    if not note:
        raise HTTPException(status_code=400, detail="付与理由（note）を入力してください。")
    return email, note


def _grant_comp(
    db: Session,
    *,
    email: str,
    note: str,
    admin_email: str,
    target_user_id: Optional[str],
) -> tuple[CompGrant, bool]:
    """無償提供を付与するコア処理（付与ロジックの単一の真実）。

    `POST /comp-grants`（既存アカウント向け）と `POST /invites`（招待。計画書
    docs/jisso_keikaku_comp_invite_2026-08-31.md §3-2 手順5）の両方から呼ばれる。
    comp付与のロジック自体は変えない、という同計画書の前提を守るため、
    routers/admin_comp.py に元からあった create_comp_grant() の本体をそのまま
    切り出しただけ（挙動は不変）。

    Returns: (grant, already_granted)
    """
    # 重複付与は冪等に扱う（新しい行を作らず、既存の有効な付与をそのまま返す）。
    existing = (
        db.query(CompGrant)
        .filter(CompGrant.email == email, CompGrant.revoked_at.is_(None))
        .first()
    )
    if existing:
        return existing, True

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
                # user_id を明示的に指定する（UserScopedMixin.before_flush の自動スタンプに
                # 任せない）。自動スタンプは実際のflush/commit時点の current_user_id を見るが、
                # このブロックの commit は下の CompGrant 挿入とまとめて finally より後で
                # 行っており、その時点では current_user_id は既に管理者自身のIDへ戻っている。
                # 任せると新規行が「対象ユーザー」ではなく「付与した管理者自身」のものとして
                # 保存されてしまう（実際に本番デプロイ前の検証で再現した不具合）。
                s = Subscription(user_id=target_user_id)
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
        granted_by_email=admin_email,
        note=note,
    )
    db.add(grant)
    db.commit()
    db.refresh(grant)
    return grant, False


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

    email/note の検証は Pydantic の field_validator ではなく手動チェックで行う
    （routers/consulting.py・feedback.py と同じ方式に統一）。field_validator が
    ValueError を送出すると FastAPI は detail が配列のバリデーションエラー形式で
    422 を返し、フロントの parseJson() がそのまま Error(msg) すると
    「[object Object]」のような壊れた表示になる。手動チェックなら detail は
    常に文字列で、他のAPIと同じエラー表示の扱いができる。
    """
    email, note = _validate_email_note(body.email, body.note)

    target_user_id = None
    if supabase_admin.admin_configured():
        target = supabase_admin.find_user_by_email(email)
        if target:
            target_user_id = target.get("id")

    grant, already_granted = _grant_comp(
        db, email=email, note=note, admin_email=admin.email, target_user_id=target_user_id,
    )

    if not already_granted:
        logger.info(
            "無償提供を付与しました: admin=%s target_email=%s target_user_id=%s note=%s",
            admin.email, email, target_user_id, note,
        )
    return {**_grant_out(grant), "already_granted": already_granted}


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


def _build_invite_link(link_data: dict) -> Optional[str]:
    """generate_link のレスポンスから、自社ドメインの招待リンクを組み立てる。

    2026-09-01 の軍令（`docs/office_map.html` QUESTS「招待メールをHTML化・
    自社ドメインリンク化すること」）により、Supabase がホストする action_link
    （supabase.co ドメインの verify エンドポイント）へ直接誘導するのをやめ、
    `hashed_token` だけを使って自社ドメインのリンク（`{APP_BASE_URL}/invite?t=...`）
    を組み立てる。フロント（App.tsx）はこのリンクを開いたら
    `supabase.auth.verifyOtp({type:'invite', token_hash})` を自分で呼ぶ
    （Supabaseの verify を経由しない）。

    トップレベル優先、無ければ properties 配下（Supabaseのバージョンにより形が違う
    可能性があるための保険。id の平坦化と同じ理由でこちらも対称に対応しておく）。
    """
    hashed_token = link_data.get("hashed_token") or (link_data.get("properties") or {}).get("hashed_token")
    if not hashed_token:
        return None
    return f"{B.app_base_url()}/invite?t={urllib.parse.quote(hashed_token, safe='')}"


def _send_invite_mail(db: Session, grant: CompGrant, *, message: str, admin_email: str, event: str) -> None:
    """招待リンクを発行し、メールを送って結果を grant に記録する。

    計画書 docs/jisso_keikaku_comp_invite_2026-08-31.md §3-2 手順4・6・8。
    アカウント・comp付与（呼び出し元で既に完了済み）は失敗してもロールバックしない
    ——「ユーザーとcompは作成済みのまま502を返し、一覧に『未送信』で残す」という
    設計（手順8）を守るため、ここで例外を握りつぶさず HTTPException として
    呼び出し元へ伝播させる。resend（再送）も同じ関数を通る＝送信ロジックは1本。
    """
    try:
        link_data = supabase_admin.generate_link(
            grant.email, type_="invite", redirect_to=B.app_base_url(),
        )
    except Exception as exc:
        logger.error("招待リンクの発行に失敗しました: target_email=%s: %s", grant.email, exc)
        raise HTTPException(
            status_code=502,
            detail="招待リンクの発行に失敗しました。時間をおいて再度お試しください。",
        )

    # ⚠️ invite_link はログに出さない（開けばログインできるリンクのため）。対象メールと
    # 結果だけをログに残す（supabase_admin.generate_link のdocstring参照）。
    invite_link = _build_invite_link(link_data)
    if not invite_link:
        logger.error(
            "招待リンクのレスポンスに hashed_token がありません: target_email=%s keys=%s",
            grant.email, list(link_data.keys()),
        )
        raise HTTPException(
            status_code=502,
            detail="招待リンクの発行に失敗しました。時間をおいて再度お試しください。",
        )

    try:
        notifications.send_invite(email=grant.email, invite_link=invite_link, message=message)
    except Exception as exc:
        grant.invite_status = "failed"
        db.commit()
        logger.error(
            "招待メールの送信に失敗しました: admin=%s target_email=%s: %s",
            admin_email, grant.email, exc,
        )
        raise HTTPException(
            status_code=502,
            detail="アカウントと無償提供の付与は完了しています。メール送信に失敗したので再送してください。",
        )

    grant.invited_at = datetime.utcnow()
    grant.invite_status = "sent"
    db.commit()
    db.refresh(grant)
    logger.info(
        "招待メールを送信しました(%s): admin=%s target_email=%s user_id=%s",
        event, admin_email, grant.email, grant.target_user_id,
    )


@router.post("/invites")
def create_invite(
    body: InviteRequest,
    admin: AuthUser = Depends(require_admin_write),
    db: Session = Depends(get_db),
):
    """メールアドレスだけで「アカウント作成＋無償提供の付与＋招待メール送信」を行う。

    計画書 docs/jisso_keikaku_comp_invite_2026-08-31.md §3-2。comp付与のロジック
    自体は _grant_comp()（POST /comp-grants と共有）を通す＝ロジックは変えない、
    という同計画書の前提を守る。
    """
    email, note = _validate_email_note(body.email, body.note)
    message = (body.message or "").strip()
    if len(message) > _MAX_MESSAGE_LEN:
        raise HTTPException(status_code=400, detail="メッセージが長すぎます。")

    if not supabase_admin.admin_configured():
        raise HTTPException(
            status_code=501,
            detail="サーバーに SUPABASE_SERVICE_ROLE_KEY が設定されていないため、招待を送信できません。",
        )

    # 3. 既存アカウントの有無を確認する（評定Q2: 既存なら招待ではなく既存アカウントへの
    #    「無償提供を付与」から行ってもらう。自動でcomp付与＋別文面のメールは今回やらない）。
    if supabase_admin.find_user_by_email(email):
        raise HTTPException(
            status_code=409,
            detail="このメールアドレスは登録済みです。無償提供の付与は既存アカウントへの"
                   "「無償提供を付与」から行ってください。",
        )

    # 4. リンク発行（type=invite なので Supabase 側にユーザーが新規作成される）
    try:
        link_data = supabase_admin.generate_link(email, type_="invite", redirect_to=B.app_base_url())
    except Exception as exc:
        logger.error("招待リンクの発行に失敗しました: target_email=%s: %s", email, exc)
        raise HTTPException(
            status_code=502,
            detail="招待リンクの発行に失敗しました。時間をおいて再度お試しください。",
        )

    # ⚠️ 本番で判明（2026-09-01）: Supabase Auth REST の generate_link はユーザー項目を
    # トップレベルに平坦化して返す（{"id": ..., "email": ..., ..., "action_link": ...} のように
    # ユーザーの属性とリンクの属性が同じ階層に混在する）。SDKのドキュメントに載っている
    # {"user": {...}, "action_link": ...} というネスト形ではない。トップレベルの "id" を
    # 優先し、無ければ従来想定していたネスト形（"user"."id"）にフォールバックする。
    target_user_id = link_data.get("id") or (link_data.get("user") or {}).get("id")
    if not target_user_id:
        logger.error(
            "招待リンクのレスポンスに id がありません: target_email=%s keys=%s",
            email, list(link_data.keys()),
        )
        raise HTTPException(
            status_code=502,
            detail="招待リンクの発行に失敗しました。時間をおいて再度お試しください。",
        )

    # 5. 既存のcomp付与ロジックをそのまま通す
    grant, already_granted = _grant_comp(
        db, email=email, note=note, admin_email=admin.email, target_user_id=target_user_id,
    )
    if not already_granted:
        logger.info(
            "無償提供を付与しました（招待経由）: admin=%s target_email=%s target_user_id=%s note=%s",
            admin.email, email, target_user_id, note,
        )

    # 6〜8. 招待メール送信（失敗しても grant は残り、再送で送り直せる）
    _send_invite_mail(db, grant, message=message, admin_email=admin.email, event="invite_sent")

    return {**_grant_out(grant), "already_granted": already_granted}


@router.post("/invites/{grant_id}/resend")
def resend_invite(
    grant_id: int,
    admin: AuthUser = Depends(require_admin_write),
    db: Session = Depends(get_db),
):
    """招待メールを再送する（同じ Supabase アカウントへリンクを発行し直すだけ。作り直さない）。"""
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
    if grant.invited_at is None and grant.invite_status is None:
        raise HTTPException(
            status_code=400,
            detail="この付与は招待メール経由ではありません（既存アカウントへの直接付与のため再送できません）。",
        )

    # 連打防止（計画書§8-4）。それ以上厳密な制限は入れない。
    now = datetime.utcnow()
    if grant.invited_at and (now - grant.invited_at) < _RESEND_MIN_INTERVAL:
        raise HTTPException(
            status_code=429,
            detail="前回の送信から間もないため再送できません。しばらく待ってから再度お試しください。",
        )

    _send_invite_mail(db, grant, message="", admin_email=admin.email, event="invite_resent")
    return _grant_out(grant)
