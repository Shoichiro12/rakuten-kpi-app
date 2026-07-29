# -*- coding: utf-8 -*-
"""アプリ内フィードバックAPI（/api/feedback）。

利用者から不具合報告・要望を受け取る窓口。設計方針はコンサル問い合わせと同じ:
  - 保存が成功したら 200。通知メールの失敗で送信を失敗させない
  - 管理画面は作らない。一次チャネルは NOTIFY_EMAIL 宛のメール
  - user_email はフロントから受け取らず、JWT（AuthUser.email）から入れる
    （なりすまし防止と入力の手間削減の両方のため）
"""
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

import notifications
from auth import AuthUser, get_current_user
from database import get_db
from models import Feedback

logger = logging.getLogger("feedback")

router = APIRouter(prefix="/api/feedback", tags=["feedback"])

_MAX_MESSAGE_LEN = 5000


class FeedbackPayload(BaseModel):
    category: Literal["bug", "request", "other"] = "bug"
    message: str
    page: Optional[str] = None


@router.post("")
def create_feedback(
    payload: FeedbackPayload,
    request: Request,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """フィードバックを保存し、通知メールを送る。"""
    message = (payload.message or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="内容を入力してください。")
    if len(message) > _MAX_MESSAGE_LEN:
        raise HTTPException(
            status_code=400,
            detail=f"内容が長すぎます（{_MAX_MESSAGE_LEN}文字以内にしてください）。",
        )

    feedback = Feedback(
        category=payload.category,
        message=message,
        page=(payload.page or "").strip()[:200] or None,
        user_email=user.email,
        user_agent=(request.headers.get("user-agent") or "")[:300] or None,
        status="new",
    )
    db.add(feedback)
    db.commit()
    db.refresh(feedback)

    # 通知はベストエフォート。失敗してもレスポンスは ok。
    try:
        notifications.send_feedback_notification(feedback)
    except Exception as e:
        logger.error("フィードバック通知の呼び出しで例外: %s", e, exc_info=True)

    return {"ok": True}
