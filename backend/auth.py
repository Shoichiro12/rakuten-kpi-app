"""Supabase JWT 認証。

フロントエンドは Supabase Auth でログインし、取得したアクセストークン(JWT)を
`Authorization: Bearer <token>` で送る。バックエンドは Supabase プロジェクトの
JWT シークレット(HS256)で検証する。

ローカル開発では SUPABASE_JWT_SECRET を設定しないことで認証を無効化し、
従来どおり（ログイン無し）で動かせる。本番(Render)ではシークレットを設定して有効化する。

将来のマルチテナント化に向けて、各リクエストのユーザーは get_current_user で一元的に
取得できるようにしてある（現状はデータをユーザーで絞らない＝共有）。
"""
import os
from typing import Optional

from fastapi import HTTPException, Request

_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "").strip()
AUTH_ENABLED = bool(_JWT_SECRET)


class AuthUser:
    """認証済みユーザー。auth無効時は id/email が None のゲスト。"""

    def __init__(self, user_id: Optional[str], email: Optional[str]):
        self.id = user_id
        self.email = email


def get_current_user(request: Request) -> AuthUser:
    # 認証無効（ローカル開発: SUPABASE_JWT_SECRET 未設定）はゲストとして通す
    if not AUTH_ENABLED:
        return AuthUser(user_id=None, email=None)

    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="認証が必要です。ログインしてください。")
    token = header[7:].strip()

    try:
        import jwt  # PyJWT
        payload = jwt.decode(
            token,
            _JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except Exception:
        raise HTTPException(status_code=401, detail="認証トークンが無効です。再ログインしてください。")

    return AuthUser(user_id=payload.get("sub"), email=payload.get("email"))
