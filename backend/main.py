import os

# ローカル開発用に backend/.env を読み込む（本番=Render では実 env が既に設定済みで、
# load_dotenv は既存の環境変数を上書きしないため無害。dotenv 未導入でも握り潰す）。
# auth/database が import 時に os.environ を読むので、それらの import より前で実行する。
try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except ImportError:
    pass

from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import engine, get_db, SessionLocal
import models
from models import RppWeekly, MonthlyItemSales, MonthlyAnalysis, Target, RppSales, InventoryStatus, Shop
from sample_data import generate_sample_data
from routers import dashboard, import_csv, targets, gap_analysis, products, actions, evaluation, export, account, rpp_diagnosis, recommendations, costs, masters, inventory
from auth import get_current_user, AuthUser, UserContextMiddleware
from migrations import run_migrations

models.Base.metadata.create_all(bind=engine)
# 既存DBへの user_id 列追加・ユニーク制約の張り替え等（冪等）
run_migrations(engine)

# 初回起動時のデフォルト店舗投入。
# マルチテナントでは「全体で1行」ではなく「ユーザーごとに1行」なので、本番（認証あり）では
# 各ユーザーの初回アクセス時に遅延生成する（masters.get_or_create_default_shop）。
# ローカル/開発（SUPABASE_JWT_SECRET 未設定＝認証無効＝全データ user_id NULL の単一テナント）
# のときだけ、起動時に user_id NULL の店舗を1行だけ入れておく。
if not os.environ.get("SUPABASE_JWT_SECRET"):
    _db = SessionLocal()
    try:
        if _db.query(Shop).count() == 0:
            _db.add(Shop(name="メイン店舗", mall_type="rakuten"))
            _db.commit()
    except Exception:
        _db.rollback()
    finally:
        _db.close()

# 本番では API ドキュメント（/docs, /redoc, /openapi.json）を公開しない。
# 既定は無効。ローカル等で見たいときだけ ENABLE_DOCS=1 を設定する。
# 公開されていると全 API パス構造が誰でも閲覧でき、攻撃の起点になるため塞ぐ。
_ENABLE_DOCS = os.environ.get("ENABLE_DOCS") == "1"
app = FastAPI(
    title="楽天KPI管理API",
    version="1.0.0",
    docs_url="/docs" if _ENABLE_DOCS else None,
    redoc_url="/redoc" if _ENABLE_DOCS else None,
    openapi_url="/openapi.json" if _ENABLE_DOCS else None,
)


# 全レスポンスにセキュリティヘッダーを付与する。
# クリックジャッキング・MIMEスニッフィング・リファラ漏洩・旧来のXSS等を緩和し、
# HTTPS を強制する。Stripe 審査の「セキュアコーディング」項目のエビデンスにもなる。
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

# 同一サービスでフロントを配信する構成では本来CORS不要だが、フロントを別ドメインに
# 置く場合に備え環境変数 ALLOW_ORIGINS（カンマ区切り）で追加できるようにする。
_default_origins = ["http://localhost:5173", "http://localhost:3000"]
_extra_origins = [o.strip() for o in os.environ.get("ALLOW_ORIGINS", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_default_origins + _extra_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# JWT検証結果を request.state と tenancy.current_user_id（ContextVar）へ伝える。
# これにより全DBクエリがログインユーザーのデータに自動で絞り込まれる（tenancy.py）。
app.add_middleware(UserContextMiddleware)

# 全 /api ルーターをログイン必須にする（SUPABASE_JWT_SECRET 未設定時は素通り＝ローカル開発）
_auth = [Depends(get_current_user)]
app.include_router(dashboard.router, dependencies=_auth)
app.include_router(import_csv.router, dependencies=_auth)
app.include_router(targets.router, dependencies=_auth)
app.include_router(gap_analysis.router, dependencies=_auth)
app.include_router(products.router, dependencies=_auth)
app.include_router(actions.router, dependencies=_auth)
app.include_router(rpp_diagnosis.router, dependencies=_auth)
app.include_router(evaluation.router, dependencies=_auth)
app.include_router(recommendations.router, dependencies=_auth)
app.include_router(export.router, dependencies=_auth)
app.include_router(account.router, dependencies=_auth)
app.include_router(costs.router, dependencies=_auth)
app.include_router(masters.router, dependencies=_auth)
app.include_router(masters.shops_router, dependencies=_auth)
app.include_router(inventory.router, dependencies=_auth)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
    )


@app.get("/api")
def api_root():
    body = {"message": "楽天KPI管理API"}
    if _ENABLE_DOCS:
        body["docs"] = "/docs"
    return body


@app.post("/api/sample-data")
def create_sample_data(db: Session = Depends(get_db), _user: AuthUser = Depends(get_current_user)):
    generate_sample_data(db)
    return {"message": "サンプルデータを生成しました（10商品 × 8週間、RPP診断デモ付き）"}


@app.get("/api/security-status")
def security_status(db: Session = Depends(get_db), _user: AuthUser = Depends(get_current_user)):
    """RLS（行レベルセキュリティ）の適用状況を返す。

    起動時の migrations._enforce_rls_pg で自動適用しているが、万一失敗しても
    気付けるように可視化する。unprotected が空でなければ、Data API経由で
    そのテーブルのデータが外部から読み書きできる状態＝要即対応。
    """
    from sqlalchemy import text as _text

    if engine.dialect.name != "postgresql":
        return {"dialect": engine.dialect.name, "applicable": False,
                "protected": [], "unprotected": [], "ok": True}

    rows = db.execute(_text(
        "SELECT tablename, rowsecurity FROM pg_tables "
        "WHERE schemaname = 'public' ORDER BY tablename"
    )).fetchall()
    protected = [r[0] for r in rows if r[1]]
    unprotected = [r[0] for r in rows if not r[1]]
    return {
        "dialect": "postgresql",
        "applicable": True,
        "protected": protected,
        "unprotected": unprotected,
        "ok": len(unprotected) == 0,
    }


@app.get("/api/data-status")
def data_status(db: Session = Depends(get_db), _user: AuthUser = Depends(get_current_user)):
    """セットアップ進捗の判定に使うデータ登録状況。フロントのガイド表示に利用。"""
    rpp_rows = db.query(func.count(RppWeekly.id)).scalar() or 0
    rpp_weeks = db.query(func.count(func.distinct(RppWeekly.week_start))).scalar() or 0
    latest_rpp = db.query(func.max(RppWeekly.week_start)).scalar()

    monthly_rows = db.query(func.count(MonthlyItemSales.id)).scalar() or 0
    monthly_months = db.query(func.count(func.distinct(MonthlyItemSales.year_month))).scalar() or 0
    latest_monthly = db.query(func.max(MonthlyItemSales.year_month)).scalar()

    monthly_legacy = db.query(func.count(MonthlyAnalysis.id)).scalar() or 0
    targets_count = db.query(func.count(Target.id)).scalar() or 0

    has_rpp = rpp_rows > 0
    has_monthly = monthly_rows > 0 or monthly_legacy > 0
    has_data = has_rpp or has_monthly

    # オンボーディングのチェックリスト（順番に達成させたい3ステップ）
    steps = [
        {"key": "rpp", "done": has_rpp},
        {"key": "monthly", "done": has_monthly},
        {"key": "targets", "done": targets_count > 0},
    ]

    return {
        # 仕様準拠のフラットなサマリー（進捗表示 N/3 を駆動）
        "rpp_weeks": rpp_weeks,
        "monthly_months": monthly_months,
        "has_goal": targets_count > 0,
        # フロントの詳細表示用（後方互換）
        "has_data": has_data,
        "rpp": {
            "rows": rpp_rows,
            "weeks": rpp_weeks,
            "latest": latest_rpp.isoformat() if latest_rpp else None,
        },
        "monthly": {
            "rows": monthly_rows,
            "months": monthly_months,
            "latest": latest_monthly,
        },
        "targets": targets_count,
        "steps": steps,
    }


@app.post("/api/reset-data")
def reset_data(db: Session = Depends(get_db), _user: AuthUser = Depends(get_current_user)):
    """登録済みデータを削除してまっさらな状態に戻す（サンプル→実データ切替などで使用）。

    目標（Target）はユーザー設定のため保持する。
    """
    deleted = 0
    for model in (RppWeekly, RppSales, MonthlyItemSales, MonthlyAnalysis, InventoryStatus):
        deleted += db.query(model).delete()
    db.commit()
    return {"message": "登録済みデータを削除しました（目標設定は保持）", "deleted": deleted}


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ─── ビルド済みフロントエンドの配信（本番／単一サービス構成） ──────────────
# `npm run build` で生成される frontend/dist が存在する場合のみ配信する。
# ローカルでバックエンド単体起動するときは dist が無いのでこのブロックは無効。
# 注意: このルートは必ず全API・/docs の登録より後に置くこと（最後にフォールバック）。
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_FRONTEND_DIST = os.path.join(_BASE_DIR, "..", "frontend", "dist")

if os.path.isdir(_FRONTEND_DIST):
    _ASSETS_DIR = os.path.join(_FRONTEND_DIST, "assets")
    if os.path.isdir(_ASSETS_DIR):
        app.mount("/assets", StaticFiles(directory=_ASSETS_DIR), name="assets")

    # index.html は絶対にキャッシュさせない。
    # ビルドのたびに /assets/index-<hash>.js のファイル名が変わり、古いハッシュの
    # ファイルはデプロイで消える。index.html がブラウザにキャッシュされていると、
    # 「古いindex.html → 存在しないJSを参照 → 404 → 画面が真っ白」になる。
    # assets 側はファイル名にハッシュが入っているので長期キャッシュで問題ない。
    _NO_STORE = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    }

    def _index_response() -> FileResponse:
        return FileResponse(
            os.path.join(_FRONTEND_DIST, "index.html"), headers=_NO_STORE
        )

    @app.get("/")
    def _serve_index():
        return _index_response()

    @app.get("/{full_path:path}")
    def _serve_spa(full_path: str):
        # /api と /assets は上で処理済み。実ファイルがあればそれを、無ければ
        # SPA のクライアントルーティング用に index.html を返す。
        candidate = os.path.join(_FRONTEND_DIST, full_path)
        if full_path and os.path.isfile(candidate):
            return FileResponse(candidate)
        return _index_response()
