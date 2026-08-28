"""アカウント管理API（退会＝アカウント削除）。

DELETE /api/account:
  1. 本人の全データ（RPP・月次・目標・チェック・在庫）を削除
  2. Supabase Auth のユーザー本体を Admin API で削除

Supabase ユーザーの削除には service_role キーが必要（環境変数
SUPABASE_SERVICE_ROLE_KEY。Supabase: Settings → API → service_role）。
※ service_role キーは全権限を持つため、必ずサーバー側の環境変数にのみ置くこと。
"""
import logging
import urllib.error
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

import supabase_admin
from auth import AUTH_ENABLED, AuthUser, get_current_user
from database import get_db
from models import (
    ActionCheck,
    InventoryStatus,
    MonthlyAnalysis,
    MonthlyItemSales,
    RppSales,
    RppWeekly,
    Subscription,
    Target,
)

logger = logging.getLogger("account")

router = APIRouter(prefix="/api/account", tags=["account"])

_ALL_MODELS = (RppWeekly, RppSales, MonthlyItemSales, MonthlyAnalysis,
               Target, ActionCheck, InventoryStatus)

# 退会をブロックする契約ステータス。
# - trialing/active: 契約が生きている（このまま消すと課金だけ残る）
# - past_due/unpaid: 支払いトラブル中＝契約は解約されていない（同上）
# 解約はポータル自己完結ではなく問い合わせ経由（CLAUDE.md 申し送り参照）のため、
# 退会前に必ず解約手続きを完了してもらう。
_BLOCKING_SUB_STATUSES = ("trialing", "active", "past_due", "unpaid")


def _active_subscription(db: Session, user_id: str):
    """本人の契約が解約前の状態ならその Subscription を返す（無ければ None）。"""
    return (
        db.query(Subscription)
        .filter(Subscription.user_id == user_id,
                Subscription.status.in_(_BLOCKING_SUB_STATUSES))
        .first()
    )


@router.get("")
def account_info(user: AuthUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """アカウント情報（メール・データ件数）。設定画面の表示用。"""
    counts = {m.__tablename__: db.query(m).count() for m in _ALL_MODELS}
    return {
        "auth_enabled": AUTH_ENABLED,
        "email": user.email,
        "user_id": user.id,
        "data_counts": counts,
        "total_rows": sum(counts.values()),
        # 退会APIが使える構成か（service_role キー設定済みか）
        "can_delete": bool(AUTH_ENABLED and supabase_admin.admin_configured()),
        # 契約が解約前の状態か（trueなら退会前に解約手続きが必要。UIが案内を出す）
        "has_active_subscription": bool(
            user.id and _active_subscription(db, user.id) is not None
        ),
    }


@router.delete("")
def delete_account(user: AuthUser = Depends(get_current_user), db: Session = Depends(get_db)):
    """退会: 本人の全データと Supabase ユーザーを削除する。"""
    if not AUTH_ENABLED or not user.id:
        raise HTTPException(
            status_code=400,
            detail="認証が無効な環境ではアカウント削除は使用できません。",
        )
    if not supabase_admin.admin_configured():
        raise HTTPException(
            status_code=501,
            detail="サーバーに SUPABASE_SERVICE_ROLE_KEY が設定されていないため、"
                   "アカウント削除を実行できません。管理者に連絡してください。",
        )

    # 0. 契約が解約前（trialing/active/past_due/unpaid）なら退会をブロックする。
    #    退会APIはStripeの契約に触れないため、ここで通すと「ログインできないのに
    #    課金だけ続く」事故になる。解約（問い合わせ経由・2〜3営業日）の完了後に退会してもらう。
    if _active_subscription(db, user.id):
        raise HTTPException(
            status_code=409,
            detail="ご契約が有効なため、アカウントを削除できません。"
                   "先に「請求・プラン」画面の「解約について問い合わせる」から解約のご連絡を"
                   "お願いします（ご連絡から2〜3営業日以内に解約手続きが完了します）。"
                   "解約完了後に、あらためて退会のお手続きができます。",
        )

    # 1. 本人のデータを全削除（tenancy によりクエリは本人の行に自動スコープされるが、
    #    念のため明示的にも user_id で絞る）
    deleted = 0
    for model in _ALL_MODELS:
        deleted += db.query(model).filter(model.user_id == user.id).delete()

    # 1.5 有効な無償提供（comp）があれば解除する（計画書
    #    docs/jisso_keikaku_comp_management_2026-08-28.md §4-3・評定Q5）。
    #    comp はStripe契約が存在しないため退会ブロックの対象にしていない
    #    （_BLOCKING_SUB_STATUSES に含めていない）。そのため本人の意思だけで
    #    退会できてしまい、放置すると CompGrant 台帳に「有効な付与」として残り続け、
    #    同じメールで再サインアップした瞬間にcompが復活する事故になる。
    #    CompGrant は付与した管理者の user_id でtenancyスコープされているため、
    #    退会する本人のクエリでは通常のORMでは見えない＝生SQLでtenancyを迂回する。
    db.execute(text(
        "UPDATE comp_grants SET revoked_at = :now, revoked_by_email = :by "
        "WHERE revoked_at IS NULL AND (target_user_id = :uid OR email = :email)"
    ), {
        "now": datetime.utcnow(),
        "by": "system:account_deleted",
        "uid": user.id,
        "email": (user.email or "").strip().lower(),
    })
    db.commit()

    # 2. Supabase Auth のユーザーを削除
    try:
        supabase_admin.delete_user(user.id)
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", "replace")[:300]
        except Exception:
            pass
        logger.error("Supabaseユーザー削除に失敗: HTTP %s %s", exc.code, body)
        raise HTTPException(
            status_code=502,
            detail="データは削除しましたが、アカウント本体の削除に失敗しました。"
                   "時間をおいて再度お試しください。",
        )
    except Exception as exc:
        logger.error("Supabaseユーザー削除に失敗: %s: %s", type(exc).__name__, exc)
        raise HTTPException(
            status_code=502,
            detail="データは削除しましたが、アカウント本体の削除に失敗しました。"
                   "時間をおいて再度お試しください。",
        )

    logger.info("アカウント削除完了: user=%s deleted_rows=%d", user.id, deleted)
    return {"message": "アカウントを削除しました。ご利用ありがとうございました。", "deleted_rows": deleted}
