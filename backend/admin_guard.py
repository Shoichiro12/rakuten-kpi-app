# -*- coding: utf-8 -*-
"""管理者判定（管理者閲覧機能・計画書 docs/jisso_keikaku_admin_viewer_2026-08-26.md 区切り1）。

判定は Supabase ユーザーの UUID（JWTの sub、AuthUser.id）を環境変数 ADMIN_USER_ID に
固定する方式。メールアドレスでは判定しない（2026-08-26 オーナー評定で確定。理由は
オーナーの言葉で「メールアドレスは変更・取り違えの余地がある」。UUIDはSupabase側で
不変のため、admin@ureshiru.com のメールを万一変更してもUUIDをenvに反映し忘れない限り
安全側に倒れる＝古いUUIDのままなら単に管理者権限が無くなるだけで、別人に権限が渡ることはない）。

subscription_guard.py / billing.py の EXEMPT_TEST_EMAILS と同じ「JWT検証済みの値でのみ
判定する」原則を踏襲する（入力値・リクエストボディでは絶対に判定しない）。

運用ルール:
  - 対象UUIDは env ADMIN_USER_ID に1件だけ設定する（既定は空＝誰も管理者にならない）。
    今回の評定は「管理者は admin@ureshiru.com 1名想定・複数オペレーターの権限分離は
    スコープ外」（計画書§0）のため単数形。将来複数管理者に対応するときは
    ADMIN_USER_IDS（カンマ区切り）へ改名する
  - この機能はマルチテナントが効いている環境専用。ローカル開発（認証無効）は全データが
    user_id NULL の単一テナントで「対象アカウントを選んで閲覧する」という概念自体が
    成立しないため、常に403にする。
"""
import os

from fastapi import Depends, HTTPException, Request

from auth import AUTH_ENABLED, AuthUser, get_current_user

_ADMIN_USER_ID = os.environ.get("ADMIN_USER_ID", "").strip()


def is_admin_user_id(user_id) -> bool:
    """このユーザーIDは管理者か（UUID完全一致判定）。"""
    if not user_id or not _ADMIN_USER_ID:
        return False
    return user_id == _ADMIN_USER_ID


def require_admin(user: AuthUser = Depends(get_current_user)) -> AuthUser:
    """管理者専用エンドポイントの依存関係。管理者でなければ403。"""
    if not AUTH_ENABLED:
        raise HTTPException(
            status_code=403,
            detail="この機能は認証が有効な環境専用です（ローカル開発では利用できません）。",
        )
    if not is_admin_user_id(user.id):
        raise HTTPException(status_code=403, detail="管理者権限がありません。")
    return user


def require_admin_write(
    request: Request,
    admin: AuthUser = Depends(require_admin),
) -> AuthUser:
    """comp管理など、管理者の「書き込み」操作専用のガード。

    計画書 docs/jisso_keikaku_comp_management_2026-08-28.md §2（評定Q4・案A）。

    auth.py の UserContextMiddleware は /api/admin/* を読み取り専用強制の対象外に
    している（閲覧セッション自体の終了APIがデッドロックしないための意図的な除外）。
    この除外は「閲覧セッション管理そのもの」にだけ許されるもので、comp付与のような
    別の書き込み操作まで免除する意図ではない。ここで明示的に閲覧モード中かを
    再チェックする（ミドルウェアとは独立したレイヤーでの二段構え）。
    """
    if request.headers.get("x-admin-view-session"):
        raise HTTPException(
            status_code=403,
            detail="閲覧モード中は無償提供の操作はできません。閲覧を終了してから操作してください。",
        )
    return admin
