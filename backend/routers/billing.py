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
    return {"enabled": B.BILLING_ENABLED, **_sub_dict(s)}


@router.post("/refresh")
def refresh_status(db: Session = Depends(get_db), _u: AuthUser = Depends(get_current_user)):
    """Stripe を正としてDBの契約状態を引き直す（プラン変更が反映されない時の手動同期）。

    通常は Webhook で自動同期されるが、Webhook 未設定・取りこぼし時の復旧手段として用意する。
    """
    s = db.query(Subscription).first()
    if not s or not s.stripe_subscription_id:
        return {"enabled": B.BILLING_ENABLED, **_sub_dict(s)}
    stripe = B.get_stripe()
    if stripe is not None:
        try:
            sub = stripe.Subscription.retrieve(s.stripe_subscription_id, expand=["items.data.price"])
            _sync_subscription(db, stripe, "customer.subscription.updated", sub)
            s = db.query(Subscription).first()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"同期に失敗しました: {e}")
    return {"enabled": B.BILLING_ENABLED, **_sub_dict(s)}


@router.get("/plans")
def billing_plans(_u: AuthUser = Depends(get_current_user)):
    """設定済みプラン一覧（画面カード用）。トライアル日数も返す。"""
    return {"enabled": B.BILLING_ENABLED, "trial_days": B.trial_days(), "plans": B.configured_plans()}


class CheckoutPayload(BaseModel):
    """プラン選択は廃止（単一プラン）。互換のため空ボディ／余分なキーを許容する。"""
    pass


@router.post("/checkout")
def create_checkout(
    payload: CheckoutPayload | None = None,
    db: Session = Depends(get_db),
    user: AuthUser = Depends(get_current_user),
):
    """Checkout Session を作成し、その URL を返す（フロントはそこへ遷移）。

    プランは単一（standard）なので分岐しない。トライアルは B.trial_days() 日。
    """
    stripe = B.get_stripe()
    if stripe is None:
        raise HTTPException(status_code=501, detail="Stripeが未設定です（STRIPE_SECRET_KEY）。")
    plan = B.STANDARD_PLAN
    price = B.price_for_plan(plan)
    if not price:
        raise HTTPException(status_code=400, detail="プランの価格IDが未設定です（STRIPE_PRICE_STANDARD）。")

    # 既存のStripe顧客があれば再利用（重複顧客を作らない）
    s = db.query(Subscription).first()
    customer_id = s.stripe_customer_id if s and s.stripe_customer_id else None

    base = B.app_base_url()
    uid = user.id or "local"

    # ⚠️ 消費税について（2026-07 に方針変更）
    #   Stripe Tax（automatic_tax）は使わない。取引ごと 0.5% の手数料がかかるため。
    #   代わりに Price を【税込 ¥22,000】の固定額で登録し、無料の「税率」(Tax rates)を
    #   手動で1つ作って default_tax_rates で付ける。これで請求書に
    #   「消費税 10% ¥2,000（内税）」の内訳が出る（総額は ¥22,000 のまま）。
    #   適格請求書発行事業者なので、顧客の仕入税額控除のために内訳が必要。
    #
    #   automatic_tax は渡さない（既定=無効）。default_tax_rates と併用できないため、
    #   Stripe Tax を有効にしたままだとここでエラーになる。
    #   customer_update[address]=auto も自動税計算のためだけに必要だったので削除した。
    subscription_data = {
        "trial_period_days": B.trial_days(),
        "metadata": {"user_id": user.id or "", "plan": plan},
    }
    tax_rate = B.tax_rate_id()
    if tax_rate:
        subscription_data["default_tax_rates"] = [tax_rate]

    # ⚠️ Managed Payments（Stripeが merchant of record になる仕組み）は無効にする。
    #   Stripeアカウントでは【既定で有効】になっており、有効なままだと
    #   subscription_data.default_tax_rates が Unsupported parameter で拒否される。
    #
    #   なぜ使わないか: Managed Payments は【日本国内取引の税務を代行しない】。
    #   Stripeのドキュメントに、Managed Payments が間接税のコンプライアンスを扱うのは
    #   シンガポール(B2B国内)と日本(すべての国内取引)を【除く】国、と明記されている。
    #   つまり国内向けの当サービスでは消費税の計算・徴収・申告は自分の責任のまま。
    #   その一方で税率の指定と請求書の発行はStripe側に握られるため、
    #   適格請求書（登録番号・税額の内訳）を自分でコントロールできなくなる。
    #   得るものが無く失うものだけあるので、明示的に無効化する。
    #
    #   アカウント設定でも無効にできるが、既定が有効なので【コードで明示】しておく
    #   （設定が戻されても壊れないようにするため）。
    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": price, "quantity": 1}],
            subscription_data=subscription_data,
            managed_payments={"enabled": False},
            client_reference_id=uid,
            customer=customer_id,
            success_url=f"{base}/billing?checkout=success&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{base}/billing?checkout=cancel",
            metadata={"user_id": user.id or "", "plan": plan},
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Checkout作成に失敗しました: {e}")

    # plan は checkout 時点で確定しているのでDBへ先に記録する（後段のStripeオブジェクト解析に依存しない）。
    if s is None:
        s = Subscription()
        db.add(s)
    s.plan = plan
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


@router.get("/diagnose")
def diagnose(db: Session = Depends(get_db), _u: AuthUser = Depends(get_current_user)):
    """【切り分け用】Stripe側の設定・契約状態とDBの状態を突き合わせて返す（判定つき）。"""
    out = _diagnose(db)
    # 途中 return する経路が多いので、ok の算出はここに集約する
    out["ok"] = "error" not in [c["level"] for c in out["checks"]]
    return out


def _diagnose(db: Session) -> dict:
    """診断本体。out["checks"] に判定を積んで返す。

    「サブスクになっていない」「トライアルが効いていない」の原因を、
    ダッシュボードを目で追わずに特定するための診断API。
    シークレットは一切返さない（IDと設定値のみ）。

    見るべき所:
      price.recurring が null（type=one_time）… Priceが一括請求。要作り直し
      config.trial_days が 14 以外          … env STRIPE_TRIAL_DAYS を確認
      livemode_mismatch = true              … テスト鍵で本番Price（または逆）
      subscription.status != trialing        … トライアルが付いていない
      db_vs_stripe に差分                    … Webhook / confirm が届いていない
    """
    out: dict = {"checks": [], "config": {}, "price": None, "subscription": None,
                 "db": None, "db_vs_stripe": []}

    def note(level: str, msg: str):
        out["checks"].append({"level": level, "message": msg})

    price_id = B.price_for_plan(B.STANDARD_PLAN)
    out["config"] = {
        "billing_enabled": B.BILLING_ENABLED,
        "trial_days": B.trial_days(),
        "price_id": price_id,
        "tax_rate_id": B.tax_rate_id(),
        "webhook_secret_set": bool(B.webhook_secret()),
        "app_base_url": B.app_base_url(),
    }
    out["tax_rate"] = None

    if B.trial_days() != 14:
        note("error", f"トライアル日数が {B.trial_days()} 日です（環境変数 STRIPE_TRIAL_DAYS を確認）。")

    # 表示用の税抜金額は手計算（税込 ÷ 1.1）なので、Stripeの設定から自動追従しない。
    # 税込金額だけ直して税抜表示を直し忘れる事故を検出する。
    expected_excl = round(B.PLAN_AMOUNT_JPY / (1 + B.TAX_RATE))
    if B.PLAN_AMOUNT_EXCL_TAX_JPY != expected_excl:
        note("warn",
             f"表示用の税抜金額（¥{B.PLAN_AMOUNT_EXCL_TAX_JPY:,}）が、税込 ¥{B.PLAN_AMOUNT_JPY:,} を"
             f"税率{B.TAX_RATE:.0%}で割り戻した値（¥{expected_excl:,}）と一致しません。"
             "PLAN_AMOUNT_LABEL・特商法ページ・利用規約の表記も合わせて見直してください。")
    if not B.webhook_secret():
        note("warn", "STRIPE_WEBHOOK_SECRET が未設定です。署名検証なしで受信します（本番では必ず設定）。")

    stripe = B.get_stripe()
    if stripe is None:
        note("error", "Stripeが未設定です（STRIPE_SECRET_KEY）。")
        return out
    if not price_id:
        note("error", "STRIPE_PRICE_STANDARD が未設定です。")
        return out

    # ── Price の種別（ここが one_time なら根本原因） ───────────────
    try:
        p = stripe.Price.retrieve(price_id, expand=["product"])
        rec = getattr(p, "recurring", None)
        out["price"] = {
            "id": p.id,
            "type": getattr(p, "type", None),
            "recurring": {
                "interval": getattr(rec, "interval", None),
                "interval_count": getattr(rec, "interval_count", None),
            } if rec else None,
            "unit_amount": getattr(p, "unit_amount", None),
            "currency": getattr(p, "currency", None),
            "active": getattr(p, "active", None),
            "livemode": getattr(p, "livemode", None),
            "product_id": getattr(getattr(p, "product", None), "id", None),
            "product_name": getattr(getattr(p, "product", None), "name", None),
        }
        if not rec:
            note("error",
                 "Priceが一括請求（one_time）です。これが根本原因です。"
                 "Stripeは既存Priceの種別を変更できないため、同じ商品に "
                 f"Recurring（月次・¥{B.PLAN_AMOUNT_JPY:,}）のPriceを新規作成し、"
                 "STRIPE_PRICE_STANDARD を新しいIDに差し替えてください。")
        else:
            iv = getattr(rec, "interval", None)
            ivc = getattr(rec, "interval_count", None)
            if iv != "month" or ivc not in (None, 1):
                note("error", f"請求サイクルが月次ではありません（{ivc or 1} {iv}）。")
            else:
                note("ok", "Priceは継続的請求（月次）です。")
        # ⚠️ 円は zero-decimal currency のため unit_amount は「円そのまま」。
        #    ドル等のセント単位（100倍）と混同して比較しないこと。
        # Stripe Tax は使わない構成なので、unit_amount は【税込総額】そのもの。
        amount = getattr(p, "unit_amount", None)
        currency = (getattr(p, "currency", "") or "").lower()
        tax_behavior = getattr(p, "tax_behavior", None)
        out["price"]["tax_behavior"] = tax_behavior

        if currency != "jpy":
            note("warn", f"通貨が円ではありません（{currency or '不明'}）。")
        elif not isinstance(amount, int):
            note("warn", "金額を取得できませんでした。")
        elif amount == B.PLAN_AMOUNT_JPY:
            note("ok", f"金額は ¥{amount:,}（税込）です。")
        else:
            note("warn", f"金額が ¥{B.PLAN_AMOUNT_JPY:,}（税込）ではありません（¥{amount:,}）。")

        # ── 手動の税率（請求書に消費税の内訳を出すため。Stripe Taxの代替で無料）──
        tr_id = B.tax_rate_id()
        if not tr_id:
            note("warn",
                 "STRIPE_TAX_RATE_ID が未設定です。請求書に消費税の内訳が出ません。"
                 "適格請求書発行事業者として税額の内訳を出すなら、Stripeで税率"
                 "（10%・内税）を作成してこのenvに設定してください。")
        else:
            try:
                tr = stripe.TaxRate.retrieve(tr_id)
                out["tax_rate"] = {
                    "id": getattr(tr, "id", None),
                    "display_name": getattr(tr, "display_name", None),
                    "percentage": getattr(tr, "percentage", None),
                    "inclusive": getattr(tr, "inclusive", None),
                    "active": getattr(tr, "active", None),
                    "country": getattr(tr, "country", None),
                    "livemode": getattr(tr, "livemode", None),
                }
                pct = getattr(tr, "percentage", None)
                inc = getattr(tr, "inclusive", None)
                problems = []
                if pct is not None and abs(float(pct) - B.TAX_RATE * 100) > 0.001:
                    problems.append(f"税率が {pct}%（想定 {B.TAX_RATE * 100:.0f}%）")
                if inc is not True:
                    problems.append("「税を含む（内税）」になっていない（外税だと総額に上乗せされます）")
                if getattr(tr, "active", True) is False:
                    problems.append("税率が無効(archived)")
                if problems:
                    note("error", "税率の設定に問題があります: " + " / ".join(problems) + "。")
                else:
                    note("ok", f"税率は {pct}%・内税で設定されています"
                               f"（請求書に消費税の内訳が出ます。総額は ¥{B.PLAN_AMOUNT_JPY:,} のまま）。")
            except Exception as e:
                note("error", f"税率(STRIPE_TAX_RATE_ID)の取得に失敗しました: {e}")

        # 外税のままだと「税抜額 + 別途消費税」の想定になり、税込表示と食い違う。
        # 今回の設計では内税(inclusive)か未指定(unspecified)が正しい状態。
        if tax_behavior == "exclusive":
            note("warn",
                 "Priceが外税(exclusive)のままです。Stripe Taxを使わない設計に変更したため、"
                 f"税込 ¥{B.PLAN_AMOUNT_JPY:,} の内税(inclusive)または未指定のPriceに"
                 "作り替えてください。外税のまま自動税計算が無効だと、"
                 "税抜額しか請求されません。")
        if getattr(p, "active", True) is False:
            note("error", "Priceが無効（archived）です。")
    except Exception as e:
        note("error", f"Priceの取得に失敗しました: {e}")
        return out

    # ── 鍵と Price のモード一致（テスト鍵で本番Priceは使えない） ──
    key_live = B.key_is_live()
    out["config"]["key_livemode"] = key_live
    if key_live is not None and out["price"] and out["price"]["livemode"] is not None:
        if key_live != out["price"]["livemode"]:
            out["livemode_mismatch"] = True
            note("error",
                 "APIキーとPriceのモードが一致していません"
                 f"（キー: {'本番' if key_live else 'テスト'} / Price: "
                 f"{'本番' if out['price']['livemode'] else 'テスト'}）。")
        else:
            out["livemode_mismatch"] = False

    # ── DBの契約状態 ───────────────────────────────────────────
    s = db.query(Subscription).first()
    out["db"] = _sub_dict(s)
    if s is None:
        note("warn", "DBに契約レコードがありません（まだ登録していない状態）。")
        return out
    out["db"]["stripe_customer_id"] = s.stripe_customer_id
    out["db"]["stripe_subscription_id"] = s.stripe_subscription_id

    if not s.stripe_subscription_id:
        note("warn",
             "DBに subscription ID がありません。Checkoutを開いたが完了していない、"
             "または完了後の同期（/api/billing/confirm・Webhook）が届いていない状態です。")
        return out

    # ── Stripe側の実際の契約状態 ───────────────────────────────
    try:
        sub = stripe.Subscription.retrieve(s.stripe_subscription_id, expand=["items.data.price"])
        item = (getattr(getattr(sub, "items", None), "data", None) or [None])[0]
        item_price = getattr(item, "price", None) if item else None
        item_rec = getattr(item_price, "recurring", None) if item_price else None
        out["subscription"] = {
            "id": sub.id,
            "status": getattr(sub, "status", None),
            "trial_start": _iso(getattr(sub, "trial_start", None)),
            "trial_end": _iso(getattr(sub, "trial_end", None)),
            "cancel_at_period_end": getattr(sub, "cancel_at_period_end", None),
            "price_id": getattr(item_price, "id", None),
            "interval": getattr(item_rec, "interval", None) if item_rec else None,
            "interval_count": getattr(item_rec, "interval_count", None) if item_rec else None,
            # 2025-03-31.basil 以降 current_period_* は item 側にある
            "current_period_end": _iso(getattr(item, "current_period_end", None)) if item else None,
            "automatic_tax_enabled": getattr(getattr(sub, "automatic_tax", None), "enabled", None),
            "default_tax_rate_ids": [
                getattr(t, "id", None) for t in (getattr(sub, "default_tax_rates", None) or [])
            ],
        }

        # 解約済み・期限切れの契約に対して「作り直してください」と言っても無意味なので、
        # 契約単位のチェック（税率・自動税計算）はスキップする。
        # 再登録前の状態でノイズを出さないため。
        st_now = getattr(sub, "status", None)
        contract_live = st_now not in ("canceled", "incomplete_expired")
        if not contract_live:
            note("warn",
                 f"見ている契約は既に終了しています（status={st_now}）。"
                 "契約単位のチェック（税率が付いているか・自動税計算）は省略しました。"
                 "再登録してから、もう一度診断してください。")

        # 契約に税率が付いていないと、その契約の請求書には内訳が出ない。
        # 税率を設定する前に作られた契約を検出する（設定だけ直しても既存契約は直らない）。
        sub_rates = out["subscription"]["default_tax_rate_ids"]
        if tr_id and contract_live:
            if tr_id in sub_rates:
                note("ok", "この契約に税率が付いています（請求書に内訳が出ます）。")
            else:
                note("error",
                     "この契約に税率が付いていません"
                     f"（付いている税率: {sub_rates or 'なし'}）。"
                     "請求書に消費税の内訳が出ないので、契約を作り直してください。"
                     "envに税率を設定しても既存の契約には遡って適用されません。")

        # Stripe Tax を使わない設計に変更したので、automatic_tax は【無効が正しい状態】。
        # ただし影響の大きさは Price の税設定で変わるので、混ぜて書かない:
        #   内税(inclusive) … 税は【上乗せされない】。総額は税込額のままで、
        #                     内訳に税額行が出るだけ。実害は Stripe Tax の手数料。
        #   外税(exclusive) … 税が【上乗せされる】。請求額が税込表示を超える。
        at = out["subscription"]["automatic_tax_enabled"]
        if not contract_live:
            pass  # 終了した契約の税設定は問題ではない（上でまとめて案内済み）
        elif not at:
            note("ok", "自動税計算は無効です（税込Price固定の設計どおり）。")
        elif tr_id:
            # default_tax_rates と automatic_tax は併用できない。
            # 有効なままだと次のCheckout作成がStripeに拒否される。
            note("error",
                 "自動税計算(automatic_tax)が有効なままです。手動の税率(default_tax_rates)"
                 "とは併用できないため、次回のCheckout作成がStripeに拒否されます。"
                 "StripeダッシュボードでStripe Taxを無効化してください。")
        elif tax_behavior == "inclusive":
            note("warn",
                 "この契約は自動税計算(automatic_tax)が有効です。"
                 f"内税のPriceなので請求総額は ¥{B.PLAN_AMOUNT_JPY:,} のままで、"
                 "内訳に税額行が出るだけです（上乗せはされません）。"
                 "ただし Stripe Tax の手数料が発生するため、"
                 "Stripe Tax を無効化したうえで契約を作り直すのが設計どおりの状態です。"
                 "コード側は automatic_tax を渡していないので、"
                 "方針変更前に作られた契約か、Stripe側の設定で有効化されています。")
        else:
            note("error",
                 "この契約は自動税計算(automatic_tax)が有効で、かつPriceが内税ではありません"
                 f"（tax_behavior={tax_behavior}）。消費税が上乗せされ、請求額が"
                 f"表示している税込 ¥{B.PLAN_AMOUNT_JPY:,} を超える恐れがあります。"
                 "Stripe側の税設定を確認してください。")
        st = getattr(sub, "status", None)
        te = getattr(sub, "trial_end", None)
        ts = getattr(sub, "trial_start", None)
        if st == "trialing":
            days = round((te - ts) / 86400) if (te and ts) else None
            note("ok", f"Stripe側はトライアル中（trialing）です。トライアル日数: {days}日")
            if days is not None and days != B.trial_days():
                note("error", f"トライアル日数が設定値({B.trial_days()}日)と一致しません（実際{days}日）。")
        elif st == "active" and not te:
            note("error",
                 "トライアルなしで課金が開始されています（status=active・trial_end無し）。"
                 "trial_period_days が渡らずにCheckoutが作られた契約です。"
                 "この契約は解約し、再度登録して確認してください。")
        else:
            note("warn", f"Stripe側のステータスは {st} です。")

        if out["subscription"]["price_id"] and out["subscription"]["price_id"] != price_id:
            note("warn",
                 "契約中のPriceが現在の STRIPE_PRICE_STANDARD と異なります"
                 f"（契約: {out['subscription']['price_id']} / 設定: {price_id}）。"
                 "Priceを作り直した後の古い契約か、ポータルでのプラン変更後です。")

        # ── DBとStripeの食い違い（Webhook到達確認） ───────────────
        if s.status != st:
            out["db_vs_stripe"].append({"field": "status", "db": s.status, "stripe": st})
        db_te = s.trial_end.isoformat() if s.trial_end else None
        if db_te != out["subscription"]["trial_end"]:
            out["db_vs_stripe"].append({"field": "trial_end", "db": db_te,
                                        "stripe": out["subscription"]["trial_end"]})
        db_cpe = s.current_period_end.isoformat() if s.current_period_end else None
        if db_cpe != out["subscription"]["current_period_end"]:
            out["db_vs_stripe"].append({"field": "current_period_end", "db": db_cpe,
                                        "stripe": out["subscription"]["current_period_end"]})
        if out["db_vs_stripe"]:
            note("warn",
                 "DBとStripeの状態に差分があります。Webhookが届いていない可能性があります"
                 "（ローカル開発ではStripeからlocalhostに届かないため正常）。"
                 "POST /api/billing/refresh で手動同期できます。")
        else:
            note("ok", "DBとStripeの状態は一致しています。")
    except Exception as e:
        note("error", f"Stripeからサブスクの取得に失敗しました: {e}")

    return out


def _iso(ts):
    """unix秒 → ISO文字列（Noneはそのまま）。"""
    return datetime.utcfromtimestamp(ts).isoformat() if ts else None


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


def _current_period_end(sub_obj, items_data, g):
    """次回更新日（unix秒）を取得する。

    ⚠️ Stripe API のバージョン 2025-03-31.basil 以降、`current_period_end` は
    Subscription オブジェクトから【削除され】、Subscription Item 側へ移動した。
    backend/requirements.txt の stripe-python 15.x は新しいAPIバージョンを
    送るため、`subscription.current_period_end` は常に None になる。
    （この対応前は DB の current_period_end が常にNULLで、契約中の画面に
      「次回更新: —」と出ていた）

    新旧どちらのAPIバージョンでも動くように、item → subscription の順で読む。
    """
    if items_data:
        cpe = g(items_data[0], "current_period_end")
        if cpe:
            return cpe
    # 旧APIバージョン（サブスク直下に存在する）向けのフォールバック
    return g(sub_obj, "current_period_end")


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
        # 別契約のイベントで既存契約を上書きしない（要: 他顧客・CLIのテストイベント対策）。
        # 既に契約があり、customer も subscription も一致しないイベントは無視する。
        if s is not None and (s.stripe_customer_id or s.stripe_subscription_id):
            incoming_sub = g(sub_obj, "id") if sub_obj is not None else None
            same_customer = customer_id and s.stripe_customer_id == customer_id
            same_sub = incoming_sub and s.stripe_subscription_id == incoming_sub
            if not (same_customer or same_sub):
                import logging as _lg
                _lg.getLogger("billing").info(
                    "別契約のイベントのため無視: customer=%s sub=%s", customer_id, incoming_sub
                )
                return
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
            # items が空で price を取れないイベントがあるため、サブスクを取得し直して補う
            # （ポータルでのプラン変更を確実に反映するために必要）。
            # 併せて current_period_end も items 側にしか無いため、この再取得で拾う。
            if not price_id or not data:
                sub_id_for_fetch = g(sub_obj, "id")
                if sub_id_for_fetch:
                    try:
                        full = stripe.Subscription.retrieve(sub_id_for_fetch, expand=["items.data.price"])
                        fitems = getattr(full, "items", None)
                        fdata = getattr(fitems, "data", None) or []
                        if fdata:
                            data = fdata
                            fprice = getattr(fdata[0], "price", None)
                            price_id = price_id or getattr(fprice, "id", None)
                    except Exception:
                        pass
            # plan は checkout 時にサブスクの metadata へ入れているのでそれを優先し、
            # 無ければ price_id から解決する（ポータルでのプラン変更等に備える）。
            # plan は「現在の price_id」を最優先で解決する。ポータルでプラン変更されると
            # metadata は作成時のまま古くなるため、metadata はフォールバックに留める。
            # （StripeObject は .get が効かない版があるため属性アクセスを優先して読む）
            sub_meta = g(sub_obj, "metadata")
            plan_from_meta = None
            if sub_meta is not None:
                plan_from_meta = getattr(sub_meta, "plan", None)
                if not plan_from_meta and hasattr(sub_meta, "get"):
                    try:
                        plan_from_meta = sub_meta.get("plan")
                    except Exception:
                        plan_from_meta = None
            resolved_plan = B.plan_for_price(price_id) or plan_from_meta
            if resolved_plan:
                s.plan = resolved_plan
            te = g(sub_obj, "trial_end")
            s.trial_end = datetime.utcfromtimestamp(te) if te else None
            cpe = _current_period_end(sub_obj, data, g)
            s.current_period_end = datetime.utcfromtimestamp(cpe) if cpe else None
        if etype == "customer.subscription.deleted":
            s.status = "canceled"
        db.commit()
    finally:
        current_user_id.reset(token)
