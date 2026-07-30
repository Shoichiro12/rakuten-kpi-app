"""アカウント管理API（退会＝アカウント削除）。

DELETE /api/account:
  1. 本人の全データ（RPP・月次・目標・チェック・在庫）を削除
  2. Supabase Auth のユーザー本体を Admin API で削除

Supabase ユーザーの削除には service_role キーが必要（環境変数
SUPABASE_SERVICE_ROLE_KEY。Supabase: Settings → API → service_role）。
※ service_role キーは全権限を持つため、必ずサーバー側の環境変数にのみ置くこと。
"""
import json
import logging
import os
import urllib.error
import urllib.request

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

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

_SUPABASE_URL = (
    os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or ""
).strip().rstrip("/")
_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()

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


def _delete_supabase_user(user_id: str):
    """Supabase Admin API でユーザーを削除する。

    キー形式で送り方を変える:
    - 旧形式（service_role JWT, eyJ... で始まる）… apikey + Authorization: Bearer の両方
    - 新形式（sb_secret_... で始まる）… apikey のみ。Authorization: Bearer に入れると
      JWTとして解釈され「Invalid JWT / Invalid API key」で拒否される（Supabase仕様）。
    """
    headers = {
        "apikey": _SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
    }
    if not _SERVICE_ROLE_KEY.startswith("sb_secret_"):
        headers["Authorization"] = f"Bearer {_SERVICE_ROLE_KEY}"
    req = urllib.request.Request(
        f"{_SUPABASE_URL}/auth/v1/admin/users/{user_id}",
        method="DELETE",
        headers=headers,
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return res.status


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
        "can_delete": bool(AUTH_ENABLED and _SUPABASE_URL and _SERVICE_ROLE_KEY),
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
    if not (_SUPABASE_URL and _SERVICE_ROLE_KEY):
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
    db.commit()

    # 2. Supabase Auth のユーザーを削除
    try:
        _delete_supabase_user(user.id)
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
