# -*- coding: utf-8 -*-
"""Stripe 請求の共通ヘルパー（テストモード運用）。

env（backend/.env）から鍵・price ID・トライアル日数を読み、plan↔price_id の対応や
Stripe SDK の初期化を1か所に集約する。秘密鍵はここ（バックエンド）だけで扱い、
フロントには絶対に渡さない。STRIPE_SECRET_KEY 未設定なら BILLING_ENABLED=False で
各エンドポイントは 501 を返す（機能が無効なだけでアプリは壊れない）。
"""
import os
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

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
#   - 判定には必ず【JWT検証済みの認証ユーザーのメール】を使うこと。
#     リクエストボディ等のユーザー入力値で判定すると、誰でも名乗るだけで
#     課金をバイパスできてしまう。
#
# ⚠️ セキュリティ注意（報告書 2026-08-03 で既定値を空に変更）:
#    - **既定は空**。env を明示設定しない限り、誰も除外されない（＝全員カード登録が必要）。
#      以前は既定値 test@gmail.com がハードコードされており、本番で env の設定を
#      忘れると誰でもそのメールで無料契約を作れる状態だった。
#    - ここに載せたメールの受信箱を持つ人は、そのメールで登録するだけで無料で全機能を
#      使える。**自社が所有・管理しているメールアドレスだけ**を載せること。
#    - ローカル開発で使う場合は backend/.env.example を参照（例を記載）。
_EXEMPT_TEST_EMAILS = frozenset(
    e.strip().lower()
    for e in os.environ.get("EXEMPT_TEST_EMAILS", "").split(",")
    if e.strip()
)


def is_exempt_test_email(email: Optional[str]) -> bool:
    """認証ユーザーのメールがカード登録除外の対象か（テスト・デモ用アカウント判定）。"""
    if not email:
        return False
    return email.strip().lower() in _EXEMPT_TEST_EMAILS


# ── 【一時措置】カード登録なしでトライアル開始（2026-08-06） ─────────
# なぜ入れたか:
#   Stripe側の決済・入金が一時停止中で、Checkout でのカード登録が機能しない。
#   トライアル運用のテストを止めないため、カード登録を挟まず trialing を
#   DBに直接作成できるようにする（EXEMPT_TEST_EMAILS と同じコードパス）。
#   この期間の課金が必要になった場合は、手動で請求書を発行する運用にする。
#
# ⚠️ Stripeの問題が解決したら env を削除して元に戻すこと。コードは残してよいが、
#    フラグが立っている限りカード登録なしで全機能が使える状態が続く。
#
# 設定:
#   TRIAL_WITHOUT_CARD=true             … 有効化（既定は無効。env を消せば即座に元通り）
#   TRIAL_WITHOUT_CARD_DOMAINS=a.co.jp  … 任意。カンマ区切り。**指定するとそのドメインの
#                                          メールだけ**が対象になる。未指定だと
#                                          【サインアップした全員】が対象になる点に注意
#                                          （self-serveでサインアップできるため、
#                                            期間中は誰でも無料で全機能を使える）。
#
# ⚠️ この経路で作った契約は Stripe 側に存在しない（顧客もサブスクも作らない）。
#    そのため Webhook が来ず、トライアル期限が過ぎても自動で停止しない
#    （status は trialing のまま）。フラグを戻したあと、該当ユーザーの
#    Subscription 行をどうするか（手動で status を変える／契約してもらう）は
#    運用で決めること。
_TRIAL_WITHOUT_CARD = os.environ.get("TRIAL_WITHOUT_CARD", "").strip().lower() in (
    "1", "true", "yes", "on",
)
_TRIAL_WITHOUT_CARD_DOMAINS = frozenset(
    d.strip().lower().lstrip("@")
    for d in os.environ.get("TRIAL_WITHOUT_CARD_DOMAINS", "").split(",")
    if d.strip()
)


def trial_without_card_enabled() -> bool:
    """一時措置のフラグが立っているか（画面・診断の表示用）。"""
    return _TRIAL_WITHOUT_CARD


def trial_without_card_domains() -> list:
    """対象を絞っているドメイン一覧（空＝全ユーザーが対象）。"""
    return sorted(_TRIAL_WITHOUT_CARD_DOMAINS)


def trial_without_card_for(email: Optional[str]) -> bool:
    """このユーザーはカード登録なしでトライアルを開始できるか。

    判定には必ず【JWT検証済みの認証ユーザーのメール】を渡すこと
    （リクエストボディ等の入力値で判定すると誰でも名乗るだけで回避できる）。
    """
    if not _TRIAL_WITHOUT_CARD:
        return False
    if not _TRIAL_WITHOUT_CARD_DOMAINS:
        return True  # ドメイン未指定 = 全ユーザー対象
    if not email or "@" not in email:
        return False
    return email.strip().lower().rsplit("@", 1)[-1] in _TRIAL_WITHOUT_CARD_DOMAINS


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


# ── 無償提供（comp）: 未登録メールへの先行登録を、本人の初回リクエストで確定させる ──
# 計画書 docs/jisso_keikaku_comp_management_2026-08-28.md §6-3。
#
# 呼び出し元は billing_status()（Billing.tsx がマウント時に必ず呼ぶ）と
# create_checkout()（保険としての二重化。billing_status() で解決済みなら何もしない＝冪等）。
# require_active_subscription() には持たせない（全ユーザー・全リクエストへの負荷を
# 避けるため。既存の 402 → /billing リダイレクト導線で十分間に合う）。
def resolve_pending_comp_grant(db: Session, user) -> None:
    """先行登録されたcomp付与を、本人の初回リクエストで確定させる。

    対象は「まだ target_user_id が確定していない、有効な CompGrant」のみ。
    見つからなければ何もしない（毎回のコストは email 完全一致のインデックス
    付きSELECT 1本のみ）。

    CompGrant テーブル自体への読み書きは生SQLで tenancy を迂回する
    （この行は「付与した管理者」の所有物として保存されているため、本人からは
    通常のORMクエリでは見えない）。Subscription 行への書き込みは、実行中の
    リクエストが本人自身のコンテキストであるため tenancy が自動で本人の行に
    絞り込む（§6-2のパターンAのような current_user_id.set() の切り替えは不要）。
    """
    if not getattr(user, "email", None):
        return
    email = user.email.strip().lower()
    row = db.execute(text(
        "SELECT id FROM comp_grants WHERE email = :email "
        "AND revoked_at IS NULL AND target_user_id IS NULL "
        "ORDER BY granted_at DESC LIMIT 1"
    ), {"email": email}).fetchone()
    if row is None:
        return
    grant_id = row[0]
    db.execute(text(
        "UPDATE comp_grants SET target_user_id = :uid WHERE id = :id"
    ), {"uid": user.id, "id": grant_id})

    from models import Subscription  # 遅延import（循環import回避）

    s = db.query(Subscription).first()  # 本人自身のリクエストなので tenancy が自動で本人の行に絞込
    if s is None:
        s = Subscription()
        db.add(s)
    s.plan = STANDARD_PLAN
    s.status = "comp"
    s.trial_end = None
    s.current_period_end = None
    db.commit()
