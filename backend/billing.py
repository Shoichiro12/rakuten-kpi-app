# -*- coding: utf-8 -*-
"""Stripe 請求の共通ヘルパー（テストモード運用）。

env（backend/.env）から鍵・price ID・トライアル日数を読み、plan↔price_id の対応や
Stripe SDK の初期化を1か所に集約する。秘密鍵はここ（バックエンド）だけで扱い、
フロントには絶対に渡さない。STRIPE_SECRET_KEY 未設定なら BILLING_ENABLED=False で
各エンドポイントは 501 を返す（機能が無効なだけでアプリは壊れない）。
"""
import os
from typing import Optional

_SECRET = os.environ.get("STRIPE_SECRET_KEY", "").strip()
_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "").strip()
_TRIAL_DAYS = int(os.environ.get("STRIPE_TRIAL_DAYS", "14") or 14)
_APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:5173").strip().rstrip("/")

# plan（内部識別子）→ Stripe price ID（env）
_PLAN_PRICE = {
    "standard": os.environ.get("STRIPE_PRICE_STANDARD", "").strip(),
    "consult": os.environ.get("STRIPE_PRICE_CONSULT", "").strip(),
}
_PRICE_PLAN = {v: k for k, v in _PLAN_PRICE.items() if v}

# 画面表示用のプラン名（金額は Stripe Checkout 側で確定表示される）
PLAN_LABELS = {
    "standard": "通常プラン",
    "consult": "コンサル付きプラン",
}

BILLING_ENABLED = bool(_SECRET)


def get_stripe():
    """api_key を設定した stripe SDK を返す（未設定/未導入なら None）。"""
    if not _SECRET:
        return None
    try:
        import stripe
    except ImportError:
        return None
    stripe.api_key = _SECRET
    return stripe


def price_for_plan(plan: str) -> Optional[str]:
    return _PLAN_PRICE.get(plan) or None


def plan_for_price(price_id: Optional[str]) -> Optional[str]:
    return _PRICE_PLAN.get(price_id) if price_id else None


def trial_days() -> int:
    return _TRIAL_DAYS


def app_base_url() -> str:
    return _APP_BASE_URL


def webhook_secret() -> str:
    return _WEBHOOK_SECRET


def configured_plans() -> list:
    """price ID が設定されているプランだけ、表示用に返す。"""
    return [
        {"plan": p, "label": PLAN_LABELS.get(p, p)}
        for p, price in _PLAN_PRICE.items()
        if price
    ]
