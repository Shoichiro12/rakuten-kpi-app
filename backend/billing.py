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

# ── プランは単一（2026-07 の料金方針変更） ─────────────────────────
# ウレシル本体は月額サブスク1本のみ。コンサルはアプリの課金に乗せず、
# 問い合わせ → ヒアリング → ボリューム別見積りの個別契約に変更した。
# （旧「コンサル付きプラン」は Stripe 側でアーカイブ済み。ここからも参照しない）
STANDARD_PLAN = "standard"

# plan（内部識別子）→ Stripe price ID（env）
_PLAN_PRICE = {
    STANDARD_PLAN: os.environ.get("STRIPE_PRICE_STANDARD", "").strip(),
}
_PRICE_PLAN = {v: k for k, v in _PLAN_PRICE.items() if v}

# 画面表示用のプラン名（金額は Stripe Checkout 側で確定表示される）
# "consult" は課金プランとしては廃止したが、旧契約レコードの表示のために残す。
PLAN_LABELS = {
    STANDARD_PLAN: "ウレシル 月額プラン",
    "consult": "コンサル付きプラン（提供終了）",
}

# カード表示用の金額文字列。実際の請求額は Stripe の price が正なので、
# 価格改定時に env だけで追随できるようにしておく。
#
# ⚠️ 総額表示義務（消費税転嫁対策特別措置法の失効後、税込の総額表示が義務）のため、
#    税込金額を主表記から外さないこと。税抜だけの表示にしない。
#    税抜・税込は並列で、同じ視認性で見せる。
PLAN_AMOUNT_LABEL = os.environ.get(
    "PLAN_AMOUNT_LABEL", "¥20,000（税抜） / ¥22,000（税込）"
).strip()

# 想定金額。診断で Stripe の Price と突き合わせるために持つ。
#
# ⚠️ 円は Stripe の zero-decimal currency なので unit_amount は「円そのまま」。
#    ドル等のように 100倍（セント単位）にしないこと。¥22,000 → unit_amount=22000。
#
# 現在の構成（2026-07 に方針変更）: Stripe Tax は使わず、
#   Price を【税込 ¥22,000】の固定額で登録する（unit_amount=22000）。
#   Stripe 側に税額を計算させないので automatic_tax は渡さない。
#
# ⚠️ PLAN_AMOUNT_EXCL_TAX_JPY（税抜）は【表示のための手計算値】であって、
#    Stripe の設定から導かれる値ではない（22000 ÷ 1.1 = 20000 を手で出している）。
#    消費税率が変わったら、Stripe の Price 金額・この2つの定数・PLAN_AMOUNT_LABEL・
#    特商法ページ・利用規約を【すべて手で】直す必要がある。自動追従しない。
PLAN_AMOUNT_JPY = int(os.environ.get("PLAN_AMOUNT_JPY", "22000") or 22000)          # 税込総額（Stripeのpriceと一致）
PLAN_AMOUNT_EXCL_TAX_JPY = int(os.environ.get("PLAN_AMOUNT_EXCL_TAX_JPY", "20000") or 20000)  # 税抜（表示用の手計算値）
TAX_RATE = float(os.environ.get("TAX_RATE", "0.10") or 0.10)                        # 消費税率（表示の整合性チェック用）

# ── 消費税の内訳表示（手動の税率 / Tax rates）────────────────────
# Stripe Tax（自動計算）は取引ごと 0.5% の手数料がかかるので使わない。
# 代わりに Stripe の「税率」(Tax rates) を手動で1つ作り、サブスクに
# default_tax_rates として付ける。これは無料の機能で、請求書に
# 「消費税 10% ¥2,000（内税）」の内訳が出る。
#
# 適格請求書発行事業者（インボイス登録済み）なので、顧客が仕入税額控除を
# 受けられるよう税額の内訳が請求書に必要。登録番号(T+13桁)は Stripe の
# 請求書テンプレート側に設定する（コードからは扱わない）。
#
# ⚠️ default_tax_rates と automatic_tax は併用できない。
#    Stripe Tax を有効にしたままだと Checkout 作成でエラーになる。
# 未設定（空）なら税率を付けずに作成する＝請求書に内訳が出ない。
STRIPE_TAX_RATE_ID = os.environ.get("STRIPE_TAX_RATE_ID", "").strip()


def tax_rate_id() -> Optional[str]:
    return STRIPE_TAX_RATE_ID or None

BILLING_ENABLED = bool(_SECRET)

# ── テスト・デモ用アカウントのカード登録除外（2026-07-30） ──────────
# 社内の検証・レビュー用アカウントはカード登録（Stripe Checkout）を通さず、
# trialing のサブスクリプションを直接作成できるようにする。
#
# 運用ルール:
#   - 対象メールはカンマ区切りで env EXEMPT_TEST_EMAILS に設定する（大文字小文字は無視）。
#   - env を「空文字」に設定すると除外は完全に無効になる（未設定なら既定値が生きる）。
#   - 判定には必ず【JWT検証済みの認証ユーザーのメール】を使うこと。
#     リクエストボディ等のユーザー入力値で判定すると、誰でも名乗るだけで
#     課金をバイパスできてしまう。
#
# ⚠️ セキュリティ注意: ここに載せたメールアドレスの受信箱を持つ人は、
#    そのメールでアカウント登録するだけで無料で全機能を使える。
#    自社が所有・管理しているメールアドレスだけを載せること。
_EXEMPT_TEST_EMAILS = frozenset(
    e.strip().lower()
    for e in os.environ.get("EXEMPT_TEST_EMAILS", "test@gmail.com").split(",")
    if e.strip()
)


def is_exempt_test_email(email: Optional[str]) -> bool:
    """認証ユーザーのメールがカード登録除外の対象か（テスト・デモ用アカウント判定）。"""
    if not email:
        return False
    return email.strip().lower() in _EXEMPT_TEST_EMAILS


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


def key_is_live() -> Optional[bool]:
    """設定されている秘密鍵が本番(sk_live_)か（未設定なら None）。

    テスト鍵で本番のPrice IDは使えない（逆も同様）ため、
    設定ミスの切り分けに使う。鍵そのものは返さない。
    """
    if not _SECRET:
        return None
    return not _SECRET.startswith("sk_test_")


def configured_plans() -> list:
    """price ID が設定されているプランだけ、表示用に返す。

    プランは単一なので実質 0件（未設定）か 1件（standard）のいずれか。
    """
    return [
        {"plan": p, "label": PLAN_LABELS.get(p, p), "price_label": PLAN_AMOUNT_LABEL}
        for p, price in _PLAN_PRICE.items()
        if price
    ]
