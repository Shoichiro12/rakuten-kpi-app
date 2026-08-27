import os

# ローカル開発用に backend/.env を読み込む（本番=Render では実 env が既に設定済みで、
# load_dotenv は既存の環境変数を上書きしないため無害。dotenv 未導入でも握り潰す）。
# auth/database が import 時に os.environ を読むので、それらの import より前で実行する。
try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except ImportError:
    pass

# アプリ側ロガー（notifications 等）の INFO ログを本番（Render）でも出す。
# uvicorn はルートロガーにハンドラを付けないため、これが無いと WARNING 未満は
# 「最終手段ハンドラ」に落ちて捨てられ、メール送信成功などの INFO ログが残らない。
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

from fastapi import FastAPI, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import engine, get_db, SessionLocal
import models
from models import RppWeekly, MonthlyItemSales, MonthlyAnalysis, Target, RppSales, InventoryStatus, Shop
from sample_data import generate_sample_data, delete_sample_data
from routers import dashboard, import_csv, targets, gap_analysis, products, actions, evaluation, export, account, rpp_diagnosis, recommendations, costs, masters, inventory, billing, consulting, feedback, item_targets, revenue_plan, admin
from auth import get_current_user, AuthUser, UserContextMiddleware
from subscription_guard import require_active_subscription
from admin_guard import require_admin
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


# Content-Security-Policy の connect-src に足す先。フロントが実際にfetch/XHR/WSする
# 外部オリジンは Supabase（認証API・Realtime）のみ（棚卸し済み: Stripeはリダイレクト
# のみでscript-src不要、Google Fontsはstyle-src/font-srcで別途許可）。
# バックエンド専用の SUPABASE_URL があればそれを、無ければフロント用の VITE_SUPABASE_URL を
# 使う（auth.py / routers/account.py と同じ優先順位）。ローカル開発（Supabase未設定）でも
# 空文字列を除外するので壊れない。
def _supabase_connect_src() -> list[str]:
    raw = (os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or "").strip()
    if not raw:
        return []
    from urllib.parse import urlparse

    parsed = urlparse(raw)
    if not parsed.scheme or not parsed.netloc:
        return []
    return [f"https://{parsed.netloc}", f"wss://{parsed.netloc}"]


# 棚卸しで想定していない追加の接続先が後から必要になった場合の逃げ道（カンマ区切り）。
# 既定は未設定＝追加なし。
_CSP_EXTRA_CONNECT = [
    o.strip() for o in os.environ.get("CSP_CONNECT_SRC", "").split(",") if o.strip()
]

_CSP_CONNECT_SRC = " ".join(["'self'"] + _supabase_connect_src() + _CSP_EXTRA_CONNECT)

_CONTENT_SECURITY_POLICY = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        # Google Fonts のスタイルシートを読むためだけに許可（フォント本体は font-src 側）。
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data:",
        "font-src 'self' https://fonts.gstatic.com",
        f"connect-src {_CSP_CONNECT_SRC}",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ]
)

# ENABLE_DOCS=1 時の /docs /redoc はSwagger UI/ReDocをCDN（jsdelivr等）から読み込むため、
# 上記の自己ホスト前提ポリシーとは相容れない。ドキュメント経路だけCSPを外す
# （既定でドキュメント自体が無効なので実害は無い。有効化はローカル/デバッグ限定の運用）。
_CSP_EXEMPT_PATHS = {"/docs", "/redoc", "/openapi.json"}


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
    if request.url.path not in _CSP_EXEMPT_PATHS:
        response.headers["Content-Security-Policy"] = _CONTENT_SECURITY_POLICY
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
# 機能ロック: 有効な契約（trialing/active）が無ければ 402（subscription_guard.py 参照）。
# ⚠️ 新しいルーターを足すときは、契約なしで使えるべき例外（billing/account/
#    consulting/feedback）でない限り、必ず _paid を付けること。_auth だけだと
#    未契約者に機能を無料開放してしまう。
_paid = _auth + [Depends(require_active_subscription)]
app.include_router(dashboard.router, dependencies=_paid)
app.include_router(import_csv.router, dependencies=_paid)
app.include_router(targets.router, dependencies=_paid)
app.include_router(item_targets.router, dependencies=_paid)
app.include_router(revenue_plan.router, dependencies=_paid)
app.include_router(gap_analysis.router, dependencies=_paid)
app.include_router(products.router, dependencies=_paid)
app.include_router(actions.router, dependencies=_paid)
app.include_router(rpp_diagnosis.router, dependencies=_paid)
app.include_router(evaluation.router, dependencies=_paid)
app.include_router(recommendations.router, dependencies=_paid)
app.include_router(export.router, dependencies=_paid)
app.include_router(account.router, dependencies=_auth)      # 退会は契約なしでも可能に
app.include_router(costs.router, dependencies=_paid)
app.include_router(masters.router, dependencies=_paid)
app.include_router(masters.shops_router, dependencies=_paid)
app.include_router(inventory.router, dependencies=_paid)
app.include_router(billing.router, dependencies=_auth)      # 契約するための画面なのでロック外
app.include_router(consulting.router, dependencies=_auth)   # 問い合わせは未契約でも可能に
app.include_router(feedback.router, dependencies=_auth)     # フィードバックも同様
# Stripe Webhook は Stripe サーバーが叩くため認証を付けない（署名検証で正当性を担保）
app.include_router(billing.webhook_router)

# 管理者専用（_paid にも _auth 単体にも属さない第3のグループ。契約状態と無関係）。
# require_admin は内部で get_current_user に依存するため実質 _auth と同じ検証を含むが、
# 他のグループ（_paid 等）と同じ「_auth + 追加ガード」の形に揃えておく
# （FastAPI は同一 callable への依存を1リクエスト内でキャッシュするため二重評価にはならない）。
_admin = _auth + [Depends(require_admin)]
app.include_router(admin.router, dependencies=_admin)


# 例外の詳細をクライアントに返すかどうか（セキュリティ報告書 2026-08-03）。
# 本番では例外メッセージにDB構造・内部パス等が漏れうるため、既定では定型文だけを
# 返し、詳細はサーバーログにのみ出す。ローカル/デバッグで詳細を見たいときだけ
# EXPOSE_ERROR_DETAIL=1 を設定する（ENABLE_DOCS と同じ考え方の切替）。
_EXPOSE_ERROR_DETAIL = os.environ.get("EXPOSE_ERROR_DETAIL") == "1"


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # 詳細は必ずログに残す（本番で原因を追えるようにする）。
    logging.getLogger("main").exception(
        "未処理の例外: %s %s", request.method, request.url.path
    )
    detail = str(exc) if _EXPOSE_ERROR_DETAIL else "サーバーエラーが発生しました"
    return JSONResponse(status_code=500, content={"detail": detail})


@app.get("/api")
def api_root():
    body = {"message": "楽天KPI管理API"}
    if _ENABLE_DOCS:
        body["docs"] = "/docs"
    return body


@app.post("/api/sample-data")
def create_sample_data(db: Session = Depends(get_db), _user: AuthUser = Depends(get_current_user),
        _sub: None = Depends(require_active_subscription)):
    """サンプルデータの生成。サンプル分（is_sample=True）だけを入れ替え、実データは触らない。"""
    result = generate_sample_data(db) or {}
    skipped = result.get("skipped_mnos") or []
    msg = "サンプルデータを生成しました（10商品 × 8週間、RPP診断デモ付き）。実データはそのままです"
    if skipped:
        msg += f"。実データと管理番号が重複する {len(skipped)}件（{', '.join(skipped)}）は生成をスキップしました"
    return {"message": msg, "skipped_mnos": skipped}


@app.delete("/api/sample-data")
def remove_sample_data(db: Session = Depends(get_db), _user: AuthUser = Depends(get_current_user),
        _sub: None = Depends(require_active_subscription)):
    """サンプルデータ（is_sample=True の行）だけを削除する。実データ・利用者の設定は触らない。

    2026-08-20 オーナー指摘: 従来の全削除しかない状態だと、実データ取込み後に
    サンプルを消したいだけで実データまで消える。アイテム別目標・商品マスタの
    サンプル残骸（重複の原因）もここで一緒に消える。
    """
    deleted = delete_sample_data(db)
    total = sum(deleted.values())
    return {"message": f"サンプルデータを削除しました（{total}行）。実データと設定は保持しています",
            "deleted": deleted, "total": total}


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
def data_status(db: Session = Depends(get_db), _user: AuthUser = Depends(get_current_user),
        _sub: None = Depends(require_active_subscription)):
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

    # サンプルデータの有無（「サンプルだけ削除」ボタンの表示制御に使う）
    has_sample = (
        db.query(RppWeekly.id).filter(RppWeekly.is_sample.is_(True)).first() is not None
        or db.query(MonthlyItemSales.id).filter(MonthlyItemSales.is_sample.is_(True)).first() is not None
    )

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
        "has_sample": has_sample,
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
def reset_data(db: Session = Depends(get_db), _user: AuthUser = Depends(get_current_user),
        _sub: None = Depends(require_active_subscription)):
    """登録済みの実績データを全削除してまっさらな状態に戻す。

    - 目標（Target）・アイテム別目標・商品マスタは、**実データ分は保持**する（ユーザー設定のため）
    - サンプル由来（is_sample=True）の行は目標・マスタ含めて一掃する
      （従来はサンプルのアイテム別目標・商品マスタが残り、重複の原因になっていた。2026-08-20）
    - サンプルだけ消したい場合は DELETE /api/sample-data を使う（実績データも保持される）
    """
    deleted = 0
    for model in (RppWeekly, RppSales, MonthlyItemSales, MonthlyAnalysis, InventoryStatus):
        deleted += db.query(model).delete()
    sample_deleted = delete_sample_data(db, commit=False)
    db.commit()
    return {
        "message": "登録済みデータを削除しました（実データの目標設定・商品マスタは保持、サンプル残骸は一掃）",
        "deleted": deleted + sum(sample_deleted.values()),
    }


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ─── ビルド済みフロントエンドの配信（本番／単一サービス構成） ──────────────
# `npm run build` で生成される frontend/dist が存在する場合のみ配信する。
# ローカルでバックエンド単体起動するときは dist が無いのでこのブロックは無効。
# 注意: このルートは必ず全API・/docs の登録より後に置くこと（最後にフォールバック）。
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_FRONTEND_DIST = os.path.join(_BASE_DIR, "..", "frontend", "dist")
# パストラバーサル対策の基準パス。realpath でシンボリックリンクまで解決した
# 実体パスを1度だけ確定し、後段の封じ込め判定（startswith）の基準にする。
_FRONTEND_DIST_REAL = os.path.realpath(_FRONTEND_DIST)

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
        #
        # ⚠️ パストラバーサル対策（セキュリティ報告書 2026-08-03）:
        # full_path は認証なしの公開ルートで受け取る任意入力。realpath で実体を
        # 解決したうえで、_FRONTEND_DIST_REAL の配下に収まっている場合だけ配信する。
        # これを外すと %2e%2e エンコード等で dist 外のファイル（/etc/passwd 等）を
        # 読み取られる。os.path.join だけでは防げない（.. を解決しないため）。
        candidate = os.path.realpath(os.path.join(_FRONTEND_DIST, full_path))
        if (
            full_path
            and candidate.startswith(_FRONTEND_DIST_REAL + os.sep)
            and os.path.isfile(candidate)
        ):
            return FileResponse(candidate)
        return _index_response()
