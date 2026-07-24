# -*- coding: utf-8 -*-
"""Stripe 請求API（/api/billing/* と Webユーザー /api/stripe/webhook）。

- /api/billing/status  : 現在の契約状態（プラン・status・トライアル終了・有効フラグ）。
- /api/billing/plans   : 設定済みプラン一覧（画面のカード表示用）。
- /api/billing/checkout: Checkout Session を作成（mode=subscription・14日トライアル付き）。
- /api/billing/portal  : カスタマーポータルのURLを発行。
- /api/stripe/webhook  : Stripeからのイベントで契約状態をDBへ同期（認証なし・署名検証あり）。

マルチテナント注意:
  認証済みエンドポイントは UserContextMiddleware がセットした current_user_id で自動絞込。
  Webhook は認証文脈が無いため、metadata / client_reference_id から user_id を解決し、
  DB操作の直前に current_user_id を明示セットしてテナントを固定する（tenancy.py 参照）。
  秘密鍵・Webhook署名シークレットはフロントへ渡さない。
"""
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

import billing as B
from auth import AuthUser, get_current_user
from database import get_db
from models import Subscription
from tenancy import current_user_id

# 認証あり（フロントからの操作）
router = APIRouter(prefix="/api/billing", tags=["billing"])
# 認証なし（Stripe が叩く Webhook 専用）。main.py で _auth を付けずに登録する。
webhook_router = APIRouter(prefix="/api/stripe", tags=["billing"])

_ACTIVE_STATUSES = ("trialing", "active")


def _sub_dict(s) -> dict:
    if s is None:
        return {"plan": None, "status": None, "trial_end": None,
                "current_period_end": None, "is_active": False}
    return {
        "plan": s.plan,
        "plan_label": B.PLAN_LABELS.get(s.plan, s.plan) if s.plan else None,
        "status": s.status,
        "trial_end": s.trial_end.isoformat() if s.trial_end else None,
        "current_period_end": s.current_period_end.isoformat() if s.current_period_end else None,
        "is_active": s.status in _ACTIVE_STATUSES,
    }


@router.get("/status")
def billing_status(db: Session = Depends(get_db), _u: AuthUser = Depends(get_current_user)):
    """現在のユーザーの契約状態。未契約でも200で {is_active:false} を返す。"""
    s = db.query(Subscription).first()
    # 自己修復: 契約はあるが plan が未解決のときだけ Stripe から引き直して補完する
    # （plan 設定済みなら Stripe API は叩かない）。
    if s and s.stripe_subscription_id and not s.plan and B.BILLING_ENABLED:
        stripe = B.get_stripe()
        if stripe is not None:
            try:
                sub = stripe.Subscription.retrieve(s.stripe_subscription_id)
                _sync_subscription(db, stripe, "customer.subscription.updated", sub)
                s = db.query(Subscription).first()
            except Exception:
                pass
    return {"enabled": B.BILLING_ENABLED, **_sub_dict(s)}


@router.get("/plans")
def billing_plans(_u: AuthUser = Depends(get_current_user)):
    """設定済みプラン一覧（画面カード用）。トライアル日数も返す。"""
    return {"enabled": B.BILLING_ENABLED, "trial_days": B.trial_days(), "plans": B.configured_plans()}


class CheckoutPayload(BaseModel):
    plan: Literal["standard", "consult"]


@router.post("/checkout")
def create_checkout(
    payload: CheckoutPayload,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Checkout Session を作成し、その URL を返す（フロントはそこへ遷移）。"""
    stripe = B.get_stripe()
    if stripe is None:
        raise HTTPException(status_code=501, detail="Stripeが未設定です（STRIPE_SECRET_KEY）。")
    price = B.price_for_plan(payload.plan)
    if not price:
        raise HTTPException(status_code=400, detail=f"プラン「{payload.plan}」の価格IDが未設定です。")

    # 既存のStripe顧客があれば再利用（重複顧客を作らない）
    s = db.query(Subscription).first()
    customer_id = s.stripe_customer_id if s and s.stripe_customer_id else None

    base = B.app_base_url()
    uid = user.id or "local"
    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": price, "quantity": 1}],
            subscription_data={
                "trial_period_days": B.trial_days(),
                "metadata": {"user_id": user.id or "", "plan": payload.plan},
            },
            client_reference_id=uid,
            customer=customer_id,
            success_url=f"{base}/billing?checkout=success&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{base}/billing?checkout=cancel",
            metadata={"user_id": user.id or "", "plan": payload.plan},
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Checkout作成に失敗しました: {e}")

    # plan は checkout 時点で確定しているのでDBへ先に記録する（後段のStripeオブジェクト解析に依存しない）。
    if s is None:
        s = Subscription()
        db.add(s)
    s.plan = payload.plan
    db.commit()
    return {"url": session.url}


class ConfirmPayload(BaseModel):
    session_id: str


@router.post("/confirm")
def confirm_checkout(
    payload: ConfirmPayload,
    db: Session = Depends(get_db),
    _u: AuthUser = Depends(get_current_user),
):
    """Checkout完了で戻ってきた直後に呼ぶ。session_id からセッションを取得して契約状態を確定する。

    Webhook（継続イベント同期）とは独立に、登録直後の状態反映を確実にするための仕組み。
    """
    stripe = B.get_stripe()
    if stripe is None:
        raise HTTPException(status_code=501, detail="Stripeが未設定です。")
    try:
        session = stripe.checkout.Session.retrieve(payload.session_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"セッション取得に失敗しました: {e}")
    _sync_subscription(db, stripe, "checkout.session.completed", session)
    s = db.query(Subscription).first()
    return {"enabled": B.BILLING_ENABLED, **_sub_dict(s)}


@router.post("/portal")
def create_portal(db: Session = Depends(get_db), _u: AuthUser = Depends(get_current_user)):
    """カスタマーポータルの URL を発行する（支払い方法・プラン変更・解約）。"""
    stripe = B.get_stripe()
    if stripe is None:
        raise HTTPException(status_code=501, detail="Stripeが未設定です。")
    s = db.query(Subscription).first()
    if not s or not s.stripe_customer_id:
        raise HTTPException(status_code=400, detail="契約情報が見つかりません。先にプランを登録してください。")
    try:
        session = stripe.billing_portal.Session.create(
            customer=s.stripe_customer_id,
            return_url=f"{B.app_base_url()}/billing",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"ポータル発行に失敗しました: {e}")
    return {"url": session.url}


_HANDLED_EVENTS = (
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
)


@webhook_router.post("/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    """Stripe Webhook。署名検証のうえ、契約状態をDBへ同期する（認証なし）。"""
    stripe = B.get_stripe()
    if stripe is None:
        raise HTTPException(status_code=501, detail="Stripeが未設定です。")

    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    secret = B.webhook_secret()
    try:
        if secret:
            event = stripe.Webhook.construct_event(payload, sig, secret)
        else:
            # 署名シークレット未設定時のローカル簡易受信（本番では必ず設定すること）
            import json
            event = json.loads(payload)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Webhook検証に失敗: {e}")

    etype = event["type"] if isinstance(event, dict) else event.type
    if etype in _HANDLED_EVENTS:
        obj = (event["data"]["object"] if isinstance(event, dict) else event.data.object)
        _sync_subscription(db, stripe, etype, obj)
    return {"received": True}


def _sync_subscription(db: Session, stripe, etype: str, obj) -> None:
    """イベント内容から user_id を解決し、その user のサブスク1件を upsert する。"""
    def g(o, key, default=None):
        # dict / StripeObject どちらでも読めるように
        try:
            return o.get(key, default)
        except AttributeError:
            return getattr(o, key, default)

    uid = None
    customer_id = None
    sub_obj = None

    if etype == "checkout.session.completed":
        meta = g(obj, "metadata") or {}
        uid = (meta.get("user_id") if hasattr(meta, "get") else None) or g(obj, "client_reference_id")
        customer_id = g(obj, "customer")
        sub_id = g(obj, "subscription")
        if sub_id:
            try:
                sub_obj = stripe.Subscription.retrieve(sub_id)
            except Exception:
                sub_obj = None
    else:
        sub_obj = obj
        customer_id = g(obj, "customer")
        meta = g(obj, "metadata") or {}
        uid = meta.get("user_id") if hasattr(meta, "get") else None

    # ローカル（認証無効）で入れた擬似値は user_id NULL 扱いに正規化
    if uid in ("", "local", None):
        uid = None

    # Webhookは認証文脈が無いため、解決した user にテナントを固定してDB操作する
    token = current_user_id.set(uid)
    try:
        s = db.query(Subscription).first()
        if s is None:
            s = Subscription()
            db.add(s)
        if customer_id:
            s.stripe_customer_id = customer_id
        if sub_obj is not None:
            s.stripe_subscription_id = g(sub_obj, "id")
            s.status = g(sub_obj, "status")
            items = (g(sub_obj, "items") or {})
            data = (items.get("data") if hasattr(items, "get") else None) or []
            price_id = None
            if data:
                price = g(data[0], "price") or {}
                price_id = price.get("id") if hasattr(price, "get") else getattr(price, "id", None)
            # plan は checkout 時にサブスクの metadata へ入れているのでそれを優先し、
            # 無ければ price_id から解決する（ポータルでのプラン変更等に備える）。
            # plan は checkout時にサブスクの metadata へ入れている。StripeObject は .get が
            # 効かない版があるため属性アクセスを優先して読む。無ければ price_id から解決。
            sub_meta = g(sub_obj, "metadata")
            plan_from_meta = None
            if sub_meta is not None:
                plan_from_meta = getattr(sub_meta, "plan", None)
                if not plan_from_meta and hasattr(sub_meta, "get"):
                    try:
                        plan_from_meta = sub_meta.get("plan")
                    except Exception:
                        plan_from_meta = None
            resolved_plan = plan_from_meta or B.plan_for_price(price_id)
            if resolved_plan:
                s.plan = resolved_plan
            te = g(sub_obj, "trial_end")
            s.trial_end = datetime.utcfromtimestamp(te) if te else None
            cpe = g(sub_obj, "current_period_end")
            s.current_period_end = datetime.utcfromtimestamp(cpe) if cpe else None
        if etype == "customer.subscription.deleted":
            s.status = "canceled"
        db.commit()
    finally:
        current_user_id.reset(token)
