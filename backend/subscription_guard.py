# -*- coding: utf-8 -*-
"""機能ロック: 有効な契約（trialing / active）が無いユーザーの主要APIを 402 で拒否する。

なぜ必要か:
  これが無いと「Supabaseでアカウントだけ作った人」が決済を通さず全機能を使えてしまう。
  トライアル14日の意味も、課金する理由も消える。公開前必須（2026-07-29 オーナー決定）。

設計:
  - main.py で主要ルーターの dependencies に `require_active_subscription` を追加する。
    対象外は「契約が無くても使えるべきもの」だけ:
      billing（契約するための画面）/ account（退会は契約なしでもできるべき）/
      consulting・feedback（問い合わせ窓口）/ health / stripe webhook
  - 認証無効（ローカル開発: SUPABASE_JWT_SECRET 未設定）のときは素通し。
    ローカルの開発体験を壊さない。**本番は必ず認証有効なのでロックが効く。**
  - 402 Payment Required を返す。フロントは 402 を受けたら /billing へ誘導する
    （frontend/src/lib/api.ts の parseJson 参照）。
  - past_due / unpaid も 402 になる（is_active と同じ判定）。Billing.tsx が
    「支払い確認が取れていません」＋ポータル導線を出す。
  - Subscription の参照は tenancy により自動でログインユーザーの行に絞られる。
"""
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from auth import AUTH_ENABLED, AuthUser, get_current_user
from database import get_db
from models import Subscription

# routers/billing.py の _ACTIVE_STATUSES と同義。循環importを避けるためここに持つ
ACTIVE_STATUSES = ("trialing", "active")


def require_active_subscription(
    db: Session = Depends(get_db),
    _user: AuthUser = Depends(get_current_user),
) -> None:
    """有効な契約が無ければ 402。ローカル（認証無効）は素通し。"""
    if not AUTH_ENABLED:
        return

    s = db.query(Subscription).first()  # tenancy で本人の行に自動スコープ
    status = s.status if s else None
    if status in ACTIVE_STATUSES:
        return

    if status in ("past_due", "unpaid"):
        # 支払い失敗。未契約とは区別してフロントで案内を変える
        raise HTTPException(
            status_code=402,
            detail="お支払いの確認が取れていません。請求・プラン画面からお支払い方法をご確認ください。",
        )
    raise HTTPException(
        status_code=402,
        detail="ご利用には登録が必要です。請求・プラン画面から14日間の無料トライアルを開始してください。",
    )
