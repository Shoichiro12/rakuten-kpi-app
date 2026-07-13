"""ユーザー別データ分離（マルチテナント）の中核。

仕組み:
- `UserScopedMixin` を継承したモデルは `user_id` 列（Supabase Auth のユーザーUUID）を持つ。
- リクエストごとに `current_user_id`（ContextVar）へユーザーIDをセットする
  （auth.py の UserContextMiddleware が行う）。
- SQLAlchemy の `do_orm_execute` イベントで、全ての SELECT / UPDATE / DELETE に
  `user_id = <現在のユーザー>` の絞り込みを自動付与する（with_loader_criteria）。
  列のみの集計クエリ（func.count 等）や Query.delete() にも適用される。
- `before_flush` イベントで、INSERT される行に user_id を自動スタンプする。

これにより各ルーターのクエリを個別に書き換えることなく、全データアクセスが
ユーザー単位に分離される。認証無効（ローカル開発）時は user_id が NULL の行だけを
対象にするため、従来どおり単一ユーザーで動作する。

注意: 新しいモデルを追加するときは必ず `UserScopedMixin` を継承すること。
継承しないモデルは全ユーザー共有になる。
"""
from contextvars import ContextVar
from typing import Optional

from sqlalchemy import Column, String, event
from sqlalchemy.orm import declared_attr, with_loader_criteria

from database import SessionLocal

# 現在のリクエストのユーザーID（Supabase の sub）。未ログイン/認証無効なら None。
current_user_id: ContextVar[Optional[str]] = ContextVar("current_user_id", default=None)


class UserScopedMixin:
    """user_id 列を持ち、クエリが自動的にユーザー単位へ絞られるモデルの共通ミックスイン。"""

    @declared_attr
    def user_id(cls):
        # 既存データ（マルチテナント化以前の行）は NULL のまま残るため nullable。
        # NULL 行はどのログインユーザーからも見えない（LEGACY_DATA_USER_ID で移行可能）。
        return Column(String, nullable=True, index=True)


@event.listens_for(SessionLocal, "do_orm_execute")
def _apply_user_scope(execute_state):
    """全 ORM クエリに user_id の絞り込みを自動付与する。"""
    if not (
        execute_state.is_select
        or execute_state.is_update
        or execute_state.is_delete
    ):
        return
    # リレーション/列の遅延ロードには適用しない（本体クエリで絞り込み済み）
    if execute_state.is_column_load or execute_state.is_relationship_load:
        return

    uid = current_user_id.get()
    if uid is None:
        # 認証無効（ローカル開発）: user_id IS NULL の行のみ対象。
        # 「== None」はバインドパラメータ化されて常に偽になるため is_(None) を使う。
        criteria = with_loader_criteria(
            UserScopedMixin,
            lambda cls: cls.user_id.is_(None),
            include_aliases=True,
        )
    else:
        criteria = with_loader_criteria(
            UserScopedMixin,
            lambda cls: cls.user_id == uid,
            include_aliases=True,
            track_closure_variables=True,
        )
    execute_state.statement = execute_state.statement.options(criteria)


@event.listens_for(SessionLocal, "before_flush")
def _stamp_user_id(session, flush_context, instances):
    """INSERT される行に現在のユーザーIDを自動セットする。"""
    uid = current_user_id.get()
    for obj in session.new:
        if isinstance(obj, UserScopedMixin) and obj.user_id is None:
            obj.user_id = uid
