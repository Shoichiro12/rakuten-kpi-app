# -*- coding: utf-8 -*-
"""Supabase Auth Admin API の共通クライアント。

routers/account.py（退会＝ユーザー削除）にあった鍵形式判定ロジックをここに切り出し、
管理者閲覧機能（backend/routers/admin.py）のユーザー一覧取得と共用する
（計画書 docs/jisso_keikaku_admin_viewer_2026-08-26.md 区切り1）。

service_role キーは全権限を持つため、必ずサーバー側の環境変数にのみ置くこと。
フロントへは絶対に渡さない。
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

SUPABASE_URL = (
    os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or ""
).strip().rstrip("/")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()


def admin_configured() -> bool:
    """Admin API を呼べる構成か（URL・service_role キーとも設定済みか）。"""
    return bool(SUPABASE_URL and SERVICE_ROLE_KEY)


def _headers() -> dict:
    """キー形式で送り方を変える。

    - 旧形式（service_role JWT, eyJ... で始まる）… apikey + Authorization: Bearer の両方
    - 新形式（sb_secret_... で始まる）… apikey のみ。Authorization: Bearer に入れると
      JWTとして解釈され「Invalid JWT / Invalid API key」で拒否される（Supabase仕様）。
    """
    headers = {
        "apikey": SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
    }
    if not SERVICE_ROLE_KEY.startswith("sb_secret_"):
        headers["Authorization"] = f"Bearer {SERVICE_ROLE_KEY}"
    return headers


def delete_user(user_id: str) -> int:
    """Supabase Auth のユーザーを削除する（account.py の退会処理から利用）。"""
    req = urllib.request.Request(
        f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
        method="DELETE",
        headers=_headers(),
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        return res.status


def get_user(user_id: str) -> Optional[dict]:
    """単一ユーザーを取得する（存在しなければ None）。

    管理者閲覧セッション開始時（区切り2）に、対象アカウントの実在確認に使う。
    """
    req = urllib.request.Request(
        f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
        method="GET",
        headers=_headers(),
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as res:
            body = json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise
    # Supabase の get-user レスポンスは {"user": {...}} 形式（バージョンにより
    # トップレベル直下のこともあるため両対応する）。
    return body.get("user") or body


def find_user_by_email(email: str) -> Optional[dict]:
    """メールアドレス完全一致でユーザーを探す（無償提供＝comp管理で利用）。

    Supabase Admin API はバージョンによりメールでの直接フィルタが使えないため、
    list_users() で全件取得して Python 側で照合する（comp付与は低頻度の管理操作
    のため、この程度のコストは許容する。account.py の退会と違い高頻度パスではない）。
    """
    target = (email or "").strip().lower()
    if not target:
        return None
    for u in list_users():
        if (u.get("email") or "").strip().lower() == target:
            return u
    return None


def list_users(per_page: int = 1000) -> list:
    """Supabase Auth の全ユーザーを取得する（1000件超はページングして続ける）。

    各要素は Supabase の User オブジェクト（id / email / created_at /
    last_sign_in_at / email_confirmed_at 等）をそのまま返す。
    """
    users = []
    page = 1
    while True:
        qs = urllib.parse.urlencode({"page": page, "per_page": per_page})
        req = urllib.request.Request(
            f"{SUPABASE_URL}/auth/v1/admin/users?{qs}",
            method="GET",
            headers=_headers(),
        )
        with urllib.request.urlopen(req, timeout=15) as res:
            body = json.loads(res.read().decode("utf-8"))
        page_users = body.get("users") or []
        users.extend(page_users)
        if len(page_users) < per_page:
            break
        page += 1
    return users
