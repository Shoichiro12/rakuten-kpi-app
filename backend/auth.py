"""Supabase JWT 認証。

フロントエンドは Supabase Auth でログインし、取得したアクセストークン(JWT)を
`Authorization: Bearer <token>` で送る。バックエンドはそれを検証する。

検証方式は **トークンの署名アルゴリズムに応じて自動で切り替える**:
- HS256（レガシー共有シークレット方式）… `SUPABASE_JWT_SECRET` で検証。
- ES256 / RS256（新方式の非対称署名鍵）… Supabase の JWKS エンドポイントから
  公開鍵を取得して検証。Supabase は 2025 以降、新規プロジェクトで非対称鍵を既定に
  したため、HS256 固定だと正規トークンでも常に 401 になる。両対応で吸収する。

ローカル開発では SUPABASE_JWT_SECRET / SUPABASE_URL いずれも未設定にすることで
認証を無効化し、従来どおり（ログイン無し）で動かせる。

将来のマルチテナント化に向けて、各リクエストのユーザーは get_current_user で一元的に
取得できるようにしてある（現状はデータをユーザーで絞らない＝共有）。
"""
import logging
import os
from typing import Optional

from fastapi import HTTPException, Request

logger = logging.getLogger("auth")

# レガシー HS256 検証用の共有シークレット（Supabase: Settings → API → JWT Secret）
_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "").strip()

# 非対称鍵（ES256/RS256）検証用。Supabase プロジェクトURLから JWKS を引く。
# バックエンド専用の SUPABASE_URL があればそれを、無ければフロント用の VITE_SUPABASE_URL を使う。
_SUPABASE_URL = (
    os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or ""
).strip().rstrip("/")
_JWKS_URL = f"{_SUPABASE_URL}/auth/v1/.well-known/jwks.json" if _SUPABASE_URL else ""

# シークレットか JWKS のどちらかが用意できていれば認証を有効化する
AUTH_ENABLED = bool(_JWT_SECRET or _JWKS_URL)

# 期待する audience。Supabase のアクセストークンは aud="authenticated"。
_AUDIENCE = "authenticated"
# 時刻ずれ（サーバーレス環境のクロックスキュー）による exp/iat 起因の 401 を防ぐ
_LEEWAY = 30

_jwks_client = None  # PyJWKClient は HTTP フェッチ＋鍵キャッシュを持つので遅延初期化する


def _get_jwks_client():
    global _jwks_client
    if _jwks_client is None and _JWKS_URL:
        from jwt import PyJWKClient

        _jwks_client = PyJWKClient(_JWKS_URL)
    return _jwks_client


def _decode_token(token: str) -> dict:
    """トークンの alg に応じて HS256（共有シークレット）か非対称鍵（JWKS）で検証する。"""
    import jwt  # PyJWT

    alg = jwt.get_unverified_header(token).get("alg", "")

    if alg.startswith("HS"):
        if not _JWT_SECRET:
            raise RuntimeError(
                "HS256 トークンを受信したが SUPABASE_JWT_SECRET が未設定です。"
            )
        return jwt.decode(
            token,
            _JWT_SECRET,
            algorithms=["HS256"],
            audience=_AUDIENCE,
            leeway=_LEEWAY,
        )

    # 非対称署名（ES256 / RS256）→ JWKS の公開鍵で検証
    client = _get_jwks_client()
    if client is None:
        raise RuntimeError(
            f"{alg or '非対称'} 署名のトークンを受信したが JWKS を引けません。"
            " SUPABASE_URL（または VITE_SUPABASE_URL）を設定してください。"
        )
    signing_key = client.get_signing_key_from_jwt(token).key
    return jwt.decode(
        token,
        signing_key,
        algorithms=[alg] if alg else ["ES256", "RS256"],
        audience=_AUDIENCE,
        leeway=_LEEWAY,
    )


class AuthUser:
    """認証済みユーザー。auth無効時は id/email が None のゲスト。"""

    def __init__(self, user_id: Optional[str], email: Optional[str]):
        self.id = user_id
        self.email = email


def get_current_user(request: Request) -> AuthUser:
    # 認証無効（ローカル開発: シークレット/URL いずれも未設定）はゲストとして通す
    if not AUTH_ENABLED:
        return AuthUser(user_id=None, email=None)

    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="認証が必要です。ログインしてください。")
    token = header[7:].strip()

    try:
        payload = _decode_token(token)
    except Exception as exc:
        # 実際の失敗理由をログに残す（トークン本体は出さない）。
        # 例: 署名不一致＝シークレット/プロジェクト不一致、ExpiredSignatureError＝期限切れ、
        #     InvalidAlgorithmError＝cryptography 未導入で ES256 を検証できない等。
        logger.warning("JWT検証に失敗: %s: %s", type(exc).__name__, exc)
        raise HTTPException(status_code=401, detail="認証トークンが無効です。再ログインしてください。")

    return AuthUser(user_id=payload.get("sub"), email=payload.get("email"))
