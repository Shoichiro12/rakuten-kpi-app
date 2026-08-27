# -*- coding: utf-8 -*-
"""管理者閲覧モード（view-asセッション）の共通ロジック。

backend/routers/admin.py（開始・終了・一覧API）と backend/auth.py
（UserContextMiddleware でのリクエストごとの検証）の両方から使う。
計画書 docs/jisso_keikaku_admin_viewer_2026-08-26.md 区切り2。

- 生トークンはDBに保存しない。sha256ハッシュだけを保存し、照合もハッシュで行う
  （万一DBが漏れてもトークンは再現できない。§4-2 手順4）。
- 有効期限は開始から2時間（オーナー評定Q1で確定。閉じ忘れても自動で切れる安全網）。
"""
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional

SESSION_DURATION = timedelta(hours=2)


def new_token() -> str:
    """閲覧セッション開始時に発行する生トークン。レスポンスで一度だけ返す。"""
    return secrets.token_urlsafe(32)


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def resolve_target_user_id(admin_user_id: str, raw_token: str) -> Optional[str]:
    """X-Admin-View-Session ヘッダのトークンから対象ユーザーIDを解決する。

    有効な閲覧セッション（この管理者が開始・未終了・未失効）が無ければ None を返す。
    UserContextMiddleware から run_in_threadpool 経由で呼ばれる（同期DBアクセスのため）。

    tenancy 越しにクエリするため、呼び出し中だけ current_user_id を admin_user_id に
    set する。これにより AdminViewSession への絞り込みが「この管理者自身が開始した
    セッションか」を自動的に保証する（admin_view_sessions.user_id は UserScopedMixin
    により開始した管理者のID。他の管理者が発行したトークンを万一渡されても、
    tenancyの絞り込みでこの管理者の行しか見えないため一致しない）。
    """
    from database import SessionLocal
    from models import AdminViewSession
    from tenancy import current_user_id

    token_hash = hash_token(raw_token)
    ctx_token = current_user_id.set(admin_user_id)
    db = SessionLocal()
    try:
        session = (
            db.query(AdminViewSession)
            .filter(
                AdminViewSession.session_token_hash == token_hash,
                AdminViewSession.ended_at.is_(None),
                AdminViewSession.expires_at > datetime.utcnow(),
            )
            .first()
        )
        return session.target_user_id if session else None
    finally:
        db.close()
        current_user_id.reset(ctx_token)
