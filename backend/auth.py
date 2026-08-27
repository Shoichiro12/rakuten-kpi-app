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

各リクエストのユーザーは get_current_user で一元的に取得できる。
さらに UserContextMiddleware が検証済みユーザーIDを tenancy.current_user_id
（ContextVar）へセットし、全DBクエリがユーザー単位に自動で絞り込まれる
（マルチテナント。詳細は tenancy.py を参照）。

※ ミドルウェアを使う理由: FastAPI の同期依存関係はスレッドプールの
  コンテキストコピー内で実行されるため、依存関係内で ContextVar をセットしても
  エンドポイント本体へ伝播しない。ASGI ミドルウェアなら確実に伝播する。
"""
import logging
import os
from typing import Optional

from fastapi import HTTPException, Request
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

import admin_view
from tenancy import current_user_id

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


def _authenticate_from_header(request: Request) -> AuthUser:
    """Authorization ヘッダのJWTを検証して AuthUser を返す（失敗時は401）。"""
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


def get_current_user(request: Request) -> AuthUser:
    # 認証無効（ローカル開発: シークレット/URL いずれも未設定）はゲストとして通す
    if not AUTH_ENABLED:
        return AuthUser(user_id=None, email=None)

    # 通常は UserContextMiddleware が検証済みの結果を request.state に入れている
    try:
        user = request.state.auth_user
    except AttributeError:
        # ミドルウェア未導入の構成でも動くようフォールバック
        return _authenticate_from_header(request)

    if user is None:
        detail = getattr(request.state, "auth_error", None) or "認証が必要です。ログインしてください。"
        raise HTTPException(status_code=401, detail=detail)
    return user


class UserContextMiddleware:
    """JWTを検証し、ユーザーIDを tenancy.current_user_id（ContextVar）へセットする。

    - 検証結果は scope["state"]（request.state）にも格納し、get_current_user が再検証
      せずに使えるようにする。
    - トークンが無い/無効でもここでは 401 にしない（公開エンドポイントを壊さないため）。
      認可の強制は従来どおり get_current_user（各 /api ルーターの依存関係）が行う。

    管理者閲覧モード（view-as。計画書 docs/jisso_keikaku_admin_viewer_2026-08-26.md 区切り2）:
    - リクエストに X-Admin-View-Session ヘッダがあり、かつ Authorization の本人が
      現時点でも管理者（admin_guard.is_admin_user_id）であれば、そのヘッダの
      トークンに対応する有効な閲覧セッションを検索する。
    - 見つかれば、GET/HEAD/OPTIONS 以外は 403（読み取り専用）で即座に終了し、
      アプリ本体を一切呼ばない。GET/HEAD/OPTIONS なら current_user_id を
      「管理者自身のID」ではなく「対象ユーザーのID」に上書きする。これにより
      既存の _paid エンドポイント群（ダッシュボード・GAP分析等）は無改修のまま、
      対象アカウントのデータを返すようになる。
    - トークンが不正・期限切れ・管理者資格の喪失等で解決できなければ 401（サイレントに
      管理者自身のデータへフォールバックしない。フロントが「閲覧セッションが切れました」
      と案内できるようにするため）。
    - 管理者自身の管理系エンドポイント（/api/admin/*。セッションの発行・終了・履歴）は
      この上書きの対象外にする。閲覧モード中でも「閲覧を終了」操作自体がブロックされる
      デッドロックを避けるため（フロントの X-Admin-View-Session ヘッダは自動付与のため、
      対象を絞らないと自分自身の管理操作まで読み取り専用扱いになってしまう）。
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not AUTH_ENABLED:
            await self.app(scope, receive, send)
            return

        user: Optional[AuthUser] = None
        error = "認証が必要です。ログインしてください。"

        raw_auth = b""
        raw_view_session = b""
        for key, value in scope.get("headers") or []:
            if key == b"authorization":
                raw_auth = value
            elif key == b"x-admin-view-session":
                raw_view_session = value
        header = raw_auth.decode("latin-1")
        if header.startswith("Bearer "):
            token = header[7:].strip()
            try:
                # JWKS取得（初回のみHTTP）を含む同期処理なのでスレッドプールで実行
                payload = await run_in_threadpool(_decode_token, token)
                user = AuthUser(user_id=payload.get("sub"), email=payload.get("email"))
            except Exception as exc:
                logger.warning("JWT検証に失敗: %s: %s", type(exc).__name__, exc)
                error = "認証トークンが無効です。再ログインしてください。"

        state = scope.setdefault("state", {})
        state["auth_user"] = user
        state["auth_error"] = None if user else error

        effective_user_id = user.id if user else None

        view_token = raw_view_session.decode("latin-1").strip()
        path = scope.get("path", "")
        if view_token and not path.startswith("/api/admin"):
            from admin_guard import is_admin_user_id  # 循環import回避（admin_guardはauthに依存）

            if user is None or not is_admin_user_id(user.id):
                # 管理者資格を偽ってヘッダだけ付けても通さない。サイレントに
                # 通常ユーザーとしてフォールバックもしない（意図が読み取れないため401）。
                await JSONResponse(
                    {"detail": "認証が必要です。ログインしてください。" if user is None
                               else "管理者権限がありません。"},
                    status_code=401 if user is None else 403,
                )(scope, receive, send)
                return

            target_user_id = await run_in_threadpool(
                admin_view.resolve_target_user_id, user.id, view_token
            )
            if target_user_id is None:
                await JSONResponse(
                    {"detail": "閲覧セッションが無効です。再度開始してください。"},
                    status_code=401,
                )(scope, receive, send)
                return

            method = scope.get("method", "GET")
            if method not in ("GET", "HEAD", "OPTIONS"):
                await JSONResponse(
                    {"detail": "閲覧モードは読み取り専用です。保存・削除はできません。"},
                    status_code=403,
                )(scope, receive, send)
                return

            effective_user_id = target_user_id

        ctx_token = current_user_id.set(effective_user_id)
        try:
            await self.app(scope, receive, send)
        finally:
            current_user_id.reset(ctx_token)
