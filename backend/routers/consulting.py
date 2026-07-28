# -*- coding: utf-8 -*-
"""コンサル問い合わせAPI（/api/consulting）。

料金方針（2026-07）: ウレシル本体は月額サブスク1本のみ。ECコンサルはアプリの
課金に乗せず、問い合わせ → ヒアリング → ボリューム別見積り（¥150,000〜）の
個別契約にする。ここはその入口。

方針:
  - 保存が成功したら 200 を返す。通知メールの失敗でユーザーの送信を失敗させない
    （送信できたのに「エラー」と出るのが一番まずい）。
  - 閲覧用の管理画面は作らない。一次チャネルは NOTIFY_EMAIL 宛のメール。
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import notifications
from database import get_db
from models import ConsultingInquiry

logger = logging.getLogger("consulting")

router = APIRouter(prefix="/api/consulting", tags=["consulting"])


class InquiryPayload(BaseModel):
    name: str
    company_name: str
    scale_hint: Optional[str] = None
    contact_email: str
    contact_phone: Optional[str] = None
    message: Optional[str] = None


def _clean(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    v = v.strip()
    return v or None


@router.post("/inquiries")
def create_inquiry(payload: InquiryPayload, db: Session = Depends(get_db)):
    """コンサル問い合わせを保存し、通知メールを送る。"""
    name = _clean(payload.name)
    company = _clean(payload.company_name)
    email = _clean(payload.contact_email)

    missing = [
        label
        for label, value in (("お名前", name), ("会社名", company), ("連絡先メール", email))
        if not value
    ]
    if missing:
        raise HTTPException(status_code=400, detail=f"{'・'.join(missing)}は必須です。")
    if "@" not in (email or ""):
        raise HTTPException(status_code=400, detail="連絡先メールの形式が正しくありません。")

    inquiry = ConsultingInquiry(
        name=name,
        company_name=company,
        scale_hint=_clean(payload.scale_hint),
        contact_email=email,
        contact_phone=_clean(payload.contact_phone),
        message=_clean(payload.message),
        status="new",
    )
    db.add(inquiry)
    db.commit()
    db.refresh(inquiry)

    # 通知はベストエフォート。失敗してもレスポンスは ok。
    try:
        notifications.send_inquiry_notification(inquiry)
    except Exception as e:
        logger.error("問い合わせ通知の呼び出しで例外: %s", e, exc_info=True)

    return {"ok": True}
