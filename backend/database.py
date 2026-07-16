import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# 既定はローカルのSQLite。デプロイ時は環境変数 DATABASE_URL で上書きする。
#   - 永続ディスク付きSQLite: sqlite:////data/rakuten_kpi.db （先頭スラッシュ4つ=絶対パス）
#   - 外部Postgres:           postgresql+psycopg://USER:PASS@HOST:5432/DBNAME
DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./rakuten_kpi.db")

# SQLite のときだけ check_same_thread を無効化（Postgres等では不要）。
engine_kwargs = {}
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    # 本番Postgres(Supabase): アイドルで切れた古い接続を掴んで遅延/エラーになるのを防ぐ。
    # pool_pre_ping は毎回 SELECT 1 の往復が増えて逆に遅くなるため使わず、一定時間で
    # 接続を作り直す pool_recycle を使う（往復を増やさずに張り直しを回避）。
    engine_kwargs["pool_recycle"] = 300

engine = create_engine(DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
