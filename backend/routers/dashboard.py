from datetime import date, timedelta
from typing import Literal, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from models import RppWeekly, Target
from calculations import calc_kpis, calc_change_rate
from evaluation import MIN_ACCESS_SAMPLE
from shop_metrics import get_shop_monthly

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _prev_month(ym: str) -> str:
    """YYYY-MM 文字列から前月の YYYY-MM を返す。年跨ぎ（01月→前年12月）も正しく処理する。"""
    year, month = int(ym[:4]), int(ym[5:7])
    if month == 1:
        return f"{year - 1}-12"
    return f"{year}-{month - 1:02d}"


def _month_bounds(ym: str) -> tuple[date, date]:
    """'YYYY-MM' から [月初, 翌月初) の半開区間を返す。

    月次フィルタは元々 func.strftime("%Y-%m", week_start) を使っていたが、strftime は
    SQLite 専用のSQL関数で PostgreSQL(本番=Supabase)には存在せず実行時エラー→500になる。
    week_start は Date 型なので、この半開区間で範囲フィルタすれば SQLite / Postgres
    双方で同一に動く（月跨ぎ週は week_start の月に丸める従来仕様も維持される）。
    """
    year, month = int(ym[:4]), int(ym[5:7])
    start = date(year, month, 1)
    end = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, end


def get_week_start(d: date) -> date:
    """Get the Sunday of the week containing d."""
    weekday = d.isoweekday() % 7  # Sunday=0, Monday=1, ...
    return d - timedelta(days=weekday)


def _weighted_ctr(rows) -> float:
    total_ct = sum(r.ct for r in rows)
    if total_ct == 0:
        return 0.0
    return sum(r.ctr * r.ct for r in rows) / total_ct


def aggregate_rpp(db: Session, week_start: date) -> dict:
    rows = db.query(RppWeekly).filter(RppWeekly.week_start == week_start).all()
    if not rows:
        return None
    return {
        "gross": sum(r.gross for r in rows),
        "cost_of_sales": sum(r.cost_of_sales for r in rows),
        "ad_cost": sum(r.ad_cost for r in rows),
        "cv": sum(r.cv for r in rows),
        "ct": sum(r.ct for r in rows),
        "ctr": _weighted_ctr(rows),
    }


def aggregate_rpp_monthly(db: Session, year_month: str) -> dict:
    m_start, m_end = _month_bounds(year_month)
    rows = db.query(RppWeekly).filter(
        RppWeekly.week_start >= m_start, RppWeekly.week_start < m_end
    ).all()
    if not rows:
        return None
    return {
        "gross": sum(r.gross for r in rows),
        "cost_of_sales": sum(r.cost_of_sales for r in rows),
        "ad_cost": sum(r.ad_cost for r in rows),
        "cv": sum(r.cv for r in rows),
        "ct": sum(r.ct for r in rows),
        "ctr": _weighted_ctr(rows),
    }


@router.get("")
def get_dashboard(
    period: Literal["weekly", "monthly"] = Query("weekly"),
    date_str: Optional[str] = Query(None, alias="date"),
    db: Session = Depends(get_db),
):
    today = date.today()

    if period == "weekly":
        if date_str:
            target_date = date.fromisoformat(date_str)
        else:
            target_date = today
        current_week = get_week_start(target_date)
        prev_week = current_week - timedelta(weeks=1)
        prev_year_week = current_week - timedelta(weeks=52)

        current_raw = aggregate_rpp(db, current_week)
        prev_raw = aggregate_rpp(db, prev_week)
        prev_year_raw = aggregate_rpp(db, prev_year_week)

        year_month = current_week.strftime("%Y-%m")
        period_label = f"{current_week} 〜 {current_week + timedelta(days=6)}"
        prev_label = f"{prev_week} 〜 {prev_week + timedelta(days=6)}"

    else:  # monthly
        if date_str:
            year_month = date_str[:7]
        else:
            year_month = today.strftime("%Y-%m")

        # 前月は year_month から導出する（today 依存を排除し、過去月指定時も正しく動作）
        prev_ym = _prev_month(year_month)
        prev_year_ym = f"{int(year_month[:4]) - 1}-{year_month[5:]}"

        current_raw = aggregate_rpp_monthly(db, year_month)
        prev_raw = aggregate_rpp_monthly(db, prev_ym)
        prev_year_raw = aggregate_rpp_monthly(db, prev_year_ym)

        period_label = year_month
        prev_label = prev_ym

    target = db.query(Target).filter(Target.year_month == year_month).first()
    expense_rate = target.expense_rate if target else 0.15
    target_sales = target.target_sales if target else 0

    # KGI売上は商品分析レポート（店舗全体売上）を正とする（月次のみ）。
    # RPP経由売上はRPP広告実績として別掲。データが無い月はRPP売上へフォールバック。
    shop = get_shop_monthly(db, year_month) if period == "monthly" else None

    if not current_raw:
        achievement_rate = (
            round(shop["sales"] / target_sales * 100, 1)
            if shop and target_sales > 0 else None
        )
        return {
            "period": period,
            "period_label": period_label,
            "kpis": None,
            "shop": shop,
            "target_sales": target_sales,
            "achievement_rate": achievement_rate,
            "changes": {},
        }

    kpis = calc_kpis(**current_raw, expense_rate=expense_rate)

    # 前期比・YoYとも評価に使う全KPIへ算出する（要件No.7: YoY対象KPIの拡大）
    COMPARE_KEYS = [
        "gross", "gp", "ad_cost", "rev", "roi", "roas",
        "cpo", "cvr", "ctr", "cpc", "cv", "ct", "av",
    ]

    changes = {}
    if prev_raw:
        prev_kpis = calc_kpis(**prev_raw, expense_rate=expense_rate)
        for key in COMPARE_KEYS:
            changes[f"{key}_wow"] = calc_change_rate(kpis[key], prev_kpis[key])

    if prev_year_raw:
        prev_year_kpis = calc_kpis(**prev_year_raw, expense_rate=expense_rate)
        for key in COMPARE_KEYS:
            changes[f"{key}_yoy"] = calc_change_rate(kpis[key], prev_year_kpis[key])

    kgi_sales = shop["sales"] if shop else kpis["gross"]
    achievement_rate = round(kgi_sales / target_sales * 100, 1) if target_sales > 0 else None

    return {
        "period": period,
        "period_label": period_label,
        "prev_label": prev_label,
        "kpis": kpis,
        "shop": shop,
        "target_sales": target_sales,
        "achievement_rate": achievement_rate,
        "changes": changes,
    }


@router.get("/alerts")
def get_alerts(
    period: Literal["weekly", "monthly"] = Query("weekly"),
    date_str: Optional[str] = Query(None, alias="date"),
    db: Session = Depends(get_db),
):
    today = date.today()
    alerts = []

    if period == "weekly":
        target_date = date.fromisoformat(date_str) if date_str else today
        current_week = get_week_start(target_date)
        prev_week = current_week - timedelta(weeks=1)
        prev_year_week = current_week - timedelta(weeks=52)

        current_raw = aggregate_rpp(db, current_week)
        prev_raw = aggregate_rpp(db, prev_week)
        prev_year_raw = aggregate_rpp(db, prev_year_week)
        target_ym = current_week.strftime("%Y-%m")
    else:
        year_month = date_str[:7] if date_str else today.strftime("%Y-%m")
        # 前月は year_month から導出する（today 依存を排除）
        prev_ym = _prev_month(year_month)
        prev_year_ym = f"{int(year_month[:4]) - 1}-{year_month[5:]}"
        current_raw = aggregate_rpp_monthly(db, year_month)
        prev_raw = aggregate_rpp_monthly(db, prev_ym)
        prev_year_raw = aggregate_rpp_monthly(db, prev_year_ym)
        target_ym = year_month

    if not current_raw:
        return {"alerts": []}

    target = db.query(Target).filter(
        Target.year_month == target_ym
    ).first()
    expense_rate = target.expense_rate if target else 0.15

    kpis = calc_kpis(**current_raw, expense_rate=expense_rate)
    prev_kpis = calc_kpis(**prev_raw, expense_rate=expense_rate) if prev_raw else None
    prev_year_kpis = calc_kpis(**prev_year_raw, expense_rate=expense_rate) if prev_year_raw else None

    # --- データ整合性チェック（二重計上の常時監視） ---
    # 週次×月次RPPレポート混在による二重計上を検出したら最優先で警告する。
    # 数値がすべて信用できなくなるため、他のどのアラートよりも重要。
    from routers.import_csv import detect_rpp_double_count
    integrity_issues = detect_rpp_double_count(db, year_month=target_ym)
    for issue in integrity_issues:
        alerts.append({
            "type": "danger",
            "metric": "データ二重計上",
            "message": f"⚠️ {issue['detail']} データ取込み画面から修復できます。",
        })

    # --- 統一判定ロジック（目標比×YoY）に基づくアラート（要件No.2） ---
    # 従来の前期比・固定しきい値アラートに加え、目標とYoYの両軸で評価する。
    target_sales = target.target_sales if target and target.target_sales > 0 else None
    if target_sales:
        achieve = kpis["gross"] / target_sales * 100
        # 週次は月次目標に対する進捗のため、ここでは月次のみ判定する
        if period == "monthly" and achieve < 100:
            alerts.append({
                "type": "danger" if achieve < 70 else "warning",
                "metric": "売上目標",
                "message": f"売上目標が未達です（達成率: {achieve:.1f}% / 目標: ¥{target_sales:,.0f}）",
            })

    # 100UUルール（要件No.6）: アクセス母数が閾値未満の期間は、CVR・客単価の
    # 評価・アラートを保留する（母数不足で統計的に信用できないため）。
    low_sample = kpis["ct"] < MIN_ACCESS_SAMPLE
    if low_sample:
        alerts.append({
            "type": "warning",
            "metric": "アクセス母数不足",
            "message": (
                f"アクセス（クリック数）が{MIN_ACCESS_SAMPLE}未満です"
                f"（現在: {kpis['ct']:,}）。母数不足のためCVR・客単価の評価を保留しています。"
                "まずアクセス対策で母数を確保しましょう。"
            ),
        })

    if prev_year_kpis:
        yoy_keys = [("gross", "売上")] if low_sample else [
            ("gross", "売上"), ("cvr", "CVR"), ("av", "客単価"),
        ]
        for key, label in yoy_keys:
            if prev_year_kpis[key] > 0 and kpis[key] < prev_year_kpis[key]:
                yoy = kpis[key] / prev_year_kpis[key] * 100
                alerts.append({
                    "type": "warning",
                    "metric": f"{label}（YoY）",
                    "message": f"{label}が前年同期を下回っています（YoY: {yoy:.1f}%）",
                })

    if kpis["ctr"] < 1.0:
        alerts.append({
            "type": "warning",
            "metric": "CTR",
            "message": f"CTRが1%未満です（現在: {kpis['ctr']}%）",
        })

    if kpis["roi"] < 100:
        alerts.append({
            "type": "danger",
            "metric": "ROI",
            "message": f"ROIが100%未満です（現在: {kpis['roi']}%）— 広告投資が利益を超えています",
        })

    if prev_kpis:
        if kpis["cpc"] > prev_kpis["cpc"] * 1.05:
            alerts.append({
                "type": "warning",
                "metric": "CPC",
                "message": f"CPCが上昇トレンドです（前期: ¥{prev_kpis['cpc']:,.0f} → 現在: ¥{kpis['cpc']:,.0f}）",
            })

        # CVR低下アラートも母数不足時は保留（100UUルール）
        if not low_sample and kpis["cvr"] < prev_kpis["cvr"] * 0.95:
            alerts.append({
                "type": "warning",
                "metric": "CVR",
                "message": f"CVRが低下しています（前期: {prev_kpis['cvr']}% → 現在: {kpis['cvr']}%）",
            })

    return {"alerts": alerts}



@router.get("/trend")
def get_trend(
    weeks: int = Query(8, ge=1, le=52),
    db: Session = Depends(get_db),
):
    today = date.today()
    current_week = get_week_start(today)

    result = []
    for i in range(weeks - 1, -1, -1):
        week_start = current_week - timedelta(weeks=i)
        raw = aggregate_rpp(db, week_start)
        if raw:
            kpis = calc_kpis(**raw)
            result.append({
                "week": week_start.isoformat(),
                "label": f"{week_start.month}/{week_start.day}",
                **{k: kpis[k] for k in ["gross", "gp", "ad_cost", "rev", "roi", "roas", "cvr", "cpc", "ctr", "cv", "ct"]},
            })
        else:
            result.append({
                "week": week_start.isoformat(),
                "label": f"{week_start.month}/{week_start.day}",
                "gross": 0, "gp": 0, "ad_cost": 0, "rev": 0,
                "roi": 0, "roas": 0, "cvr": 0, "cpc": 0, "ctr": 0, "cv": 0, "ct": 0,
            })

    return {"trend": result}
