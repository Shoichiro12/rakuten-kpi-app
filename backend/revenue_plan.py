# -*- coding: utf-8 -*-
"""売上予算プラン（アクション提案ロジック第4段階v2）。

年間売上予算 → 月次按分（季節指数） → 必要アクセス数 → 想定広告費 → ギャップ逆算、
というマネージャー層の意思決定を一気通貫で支援するロジックの本体。

設計方針（実装計画書 jisso_keikaku_uriage_gap_2026-08-02.md）:
  - 季節指数の元データは MonthlyItemSales の店舗全体合算（shop_metrics.get_shop_monthly
    と同じ定義・site_uu 軸）を正とする。KGI売上の正（ダッシュボード・評価マトリクス）と
    同じ軸に揃えるため。
  - 「有効実績月」= 月次母数ゲート（min_access_for("monthly")=430）通過月のみ指数に算入。
    閾値の直書きはしない。
  - 商品分析未取込で RppWeekly だけある店舗は RPP 月次集計（rpp_click 軸）で代用する。
    ただし1つの指数計算の中で両ソースを混在させない（有効月数が多い方を採用、同数なら
    item_sales 優先）。RPP経由売上のみの季節形状は店舗全体の代表性が弱いため、
    フォールバック時は confidence の上限を medium に抑える。
  - 指数・按分値は保存せず都度算出する（保存すると予算・指数の更新のたびに
    12行の同期が必要になり「保存値と算出値どちらが正か」問題を作るため）。
  - 広告費の自動配分・上限管理はしない（オーナー確定 2026-08-02）。「いくらまで
    かけられるか」は都度のユーザー入力で、システムは逆算の選択肢を提示するだけ。

信頼区分（confidence）のしきい値は calculations.py（SEASONAL_HIGH_MONTHS 等）が
単一の真実。DBアクセスはこのモジュール内の集計ヘルパーに閉じる。
"""
from typing import Literal, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import MonthlyItemSales, RppWeekly, Target
from access_definitions import min_access_for
from calculations import SEASONAL_HIGH_MONTHS, SEASONAL_MIN_MONTHS
from shop_metrics import get_shop_monthly

IndexSource = Literal["item_sales", "rpp"]


# ─── 年月ユーティリティ ──────────────────────────────────────────────────────

def shift_month(ym: str, n: int) -> str:
    """YYYY-MM に n ヶ月を加算した YYYY-MM を返す（n は負も可）。"""
    year, month = int(ym[:4]), int(ym[5:7])
    total = year * 12 + (month - 1) + n
    return f"{total // 12}-{total % 12 + 1:02d}"


def budget_year_months(base_ym: str, start_month: int) -> list[str]:
    """base_ym を含む予算年度（start_month 起点の12ヶ月）の YYYY-MM リストを返す。

    例: base_ym=2026-02, start_month=4 → 2025-04 〜 2026-03。
    """
    start_month = min(max(int(start_month or 1), 1), 12)
    year, month = int(base_ym[:4]), int(base_ym[5:7])
    start_year = year if month >= start_month else year - 1
    first = f"{start_year}-{start_month:02d}"
    return [shift_month(first, i) for i in range(12)]


# ─── 月次実績の収集（指数の元データ） ────────────────────────────────────────

def _collect_item_sales_months(db: Session) -> dict:
    """MonthlyItemSales を年月ごとに店舗合算する（site_uu 軸）。

    Returns: {ym: {"sales": float, "denominator": int}}
    denominator は母数ゲート判定に使うアクセスUU合計。
    """
    rows = (
        db.query(
            MonthlyItemSales.year_month,
            func.coalesce(func.sum(MonthlyItemSales.sales), 0.0),
            func.coalesce(func.sum(MonthlyItemSales.access_uu), 0),
        )
        .group_by(MonthlyItemSales.year_month)
        .all()
    )
    return {ym: {"sales": float(sales or 0), "denominator": int(uu or 0)} for ym, sales, uu in rows}


def _collect_rpp_months(db: Session) -> dict:
    """RppWeekly を week_start の月で店舗合算する（rpp_click 軸のフォールバック）。

    月跨ぎ週は week_start の月に丸められる既知の制約つき。SQLite/Postgres 両対応の
    ため strftime は使わず、Python 側で月キーに変換する。
    """
    rows = (
        db.query(
            RppWeekly.week_start,
            func.coalesce(func.sum(RppWeekly.gross), 0.0),
            func.coalesce(func.sum(RppWeekly.ct), 0),
        )
        .group_by(RppWeekly.week_start)
        .all()
    )
    agg: dict = {}
    for week_start, gross, ct in rows:
        ym = week_start.strftime("%Y-%m")
        a = agg.setdefault(ym, {"sales": 0.0, "denominator": 0})
        a["sales"] += float(gross or 0)
        a["denominator"] += int(ct or 0)
    return agg


def monthly_sales_index(db: Session) -> dict:
    """店舗全体の月別販売指数（季節指数）を算出する。

    Returns:
        {
          "source": "item_sales" | "rpp",
          "access_axis": "site_uu" | "rpp_click",
          "valid_months": int,            # 母数ゲート通過月の数
          "covered_calendar_months": int, # 通過月がカバーする暦月の種類数（最大12）
          "confidence": "high"|"medium"|"low"|None,  # low=均等按分 / None=データなし
          "shares": {1..12: float} | None,  # 暦月ごとの売上シェア（合計1.0）。lowはNone
          "monthly_sales": {ym: sales},     # 実績表示用（採用ソースの月次売上）
          "period_from"/"period_to": 有効月の範囲（根拠表示用）,
        }

    有効月の判定は access_definitions.min_access_for("monthly") を必ず経由する。
    """
    threshold = min_access_for("monthly")

    candidates = []
    for source, axis, data in (
        ("item_sales", "site_uu", _collect_item_sales_months(db)),
        ("rpp", "rpp_click", _collect_rpp_months(db)),
    ):
        valid = {ym: v for ym, v in data.items() if v["denominator"] >= threshold and v["sales"] > 0}
        candidates.append({"source": source, "axis": axis, "all": data, "valid": valid})

    # 有効月数が多い方を採用（同数なら item_sales 優先＝candidatesの並び順）
    best = max(candidates, key=lambda c: len(c["valid"]))
    source: IndexSource = best["source"]
    valid = best["valid"]
    valid_count = len(valid)

    result = {
        "source": source,
        "access_axis": best["axis"],
        "valid_months": valid_count,
        "covered_calendar_months": 0,
        "confidence": None,
        "shares": None,
        "monthly_sales": {ym: v["sales"] for ym, v in best["all"].items()},
        "period_from": min(valid) if valid else None,
        "period_to": max(valid) if valid else None,
    }
    if valid_count == 0:
        return result

    # 暦月（1〜12）ごとに有効月の売上を平均する
    by_calendar: dict[int, list[float]] = {}
    for ym, v in valid.items():
        by_calendar.setdefault(int(ym[5:7]), []).append(v["sales"])
    covered = len(by_calendar)
    result["covered_calendar_months"] = covered

    # 暦月12種をカバーし、かつ12ヶ月以上の有効月がなければ季節指数は出さない（均等按分）
    if covered < 12 or valid_count < SEASONAL_MIN_MONTHS:
        result["confidence"] = "low"
        return result

    avg_by_month = {m: sum(vals) / len(vals) for m, vals in by_calendar.items()}
    total = sum(avg_by_month.values())
    if total <= 0:
        result["confidence"] = "low"
        return result

    result["shares"] = {m: avg_by_month[m] / total for m in range(1, 13)}
    confidence = "high" if valid_count >= SEASONAL_HIGH_MONTHS else "medium"
    if source == "rpp" and confidence == "high":
        # RPP経由売上のみの季節形状は店舗全体の代表性が弱いため medium 止まり
        confidence = "medium"
    result["confidence"] = confidence
    return result


# ─── 店舗全体の目標CVR・客単価（区切り2） ────────────────────────────────────

def _shop_month_at_or_before(db: Session, ym: str) -> Optional[dict]:
    """対象月以前の直近実績月の店舗合算を返す（無ければ全体の最新実績月）。

    target_calc._actual_at_or_before の店舗全体版。site_uu 軸。
    Returns: {"year_month", "sales", "access", "cv", "cvr", "av"} | None
    """
    latest = (
        db.query(MonthlyItemSales.year_month)
        .filter(MonthlyItemSales.year_month <= ym)
        .order_by(MonthlyItemSales.year_month.desc())
        .limit(1)
        .scalar()
    )
    if not latest:
        latest = (
            db.query(MonthlyItemSales.year_month)
            .order_by(MonthlyItemSales.year_month.desc())
            .limit(1)
            .scalar()
        )
    if not latest:
        return None
    agg = get_shop_monthly(db, latest)
    if not agg:
        return None
    return {"year_month": latest, **agg}


def shop_target_rates(db: Session, base_ym: str) -> Optional[dict]:
    """店舗全体の目標CVR・客単価を解決する（実装計画書1-(a)。案1）。

    優先順位（オーナー承認済み 2026-08-02）:
      1. Target（店舗×月のKGI設定）に手入力の target_cvr / target_av があれば
         指標ごとにそれを優先する（第1段階ベンチマークの「手入力が常に勝つ」原則）
      2. 無ければ確定公式 MIN(現状値, 前年値) を店舗全体に適用する
         （現状値=対象月以前の直近実績月の店舗合算、前年値=前年同月の店舗合算。
          片方欠損は存在する方のみ採用し basis に明記。target_calc.py と同じ規約）

    Returns:
        {"target_cvr", "target_av", "basis", "basis_detail"} | None（実績が全く無い場合）
        basis: 'manual' | 'rule' | 'mixed'（CVRと客単価で出どころが異なる場合）
    """
    manual = db.query(Target).filter(Target.year_month == base_ym).first()
    manual_cvr = manual.target_cvr if manual and (manual.target_cvr or 0) > 0 else None
    manual_av = manual.target_av if manual and (manual.target_av or 0) > 0 else None

    cur = _shop_month_at_or_before(db, base_ym)
    py = get_shop_monthly(db, f"{int(base_ym[:4]) - 1}-{base_ym[5:7]}")

    cvr_cands = []
    av_cands = []
    if cur and cur["cvr"] > 0:
        cvr_cands.append(("現状値", cur["year_month"], cur["cvr"]))
    if py and py["cvr"] > 0:
        cvr_cands.append(("前年値", f"{int(base_ym[:4]) - 1}-{base_ym[5:7]}", py["cvr"]))
    if cur and cur["av"] > 0:
        av_cands.append(("現状値", cur["year_month"], cur["av"]))
    if py and py["av"] > 0:
        av_cands.append(("前年値", f"{int(base_ym[:4]) - 1}-{base_ym[5:7]}", py["av"]))

    details = []
    if manual_cvr is not None:
        target_cvr = manual_cvr
        details.append(f"目標CVR={target_cvr}%（目標設定画面の手入力を採用）")
        cvr_from_manual = True
    elif cvr_cands:
        pick = min(cvr_cands, key=lambda x: x[2])
        target_cvr = pick[2]
        details.append(f"目標CVR={target_cvr}%（{pick[0]} {pick[1]}を採用。MIN(現状, 前年)）")
        cvr_from_manual = False
    else:
        return None

    if manual_av is not None:
        target_av = manual_av
        details.append(f"目標客単価=¥{int(target_av):,}（目標設定画面の手入力を採用）")
        av_from_manual = True
    elif av_cands:
        pick = min(av_cands, key=lambda x: x[2])
        target_av = pick[2]
        details.append(f"目標客単価=¥{int(target_av):,}（{pick[0]} {pick[1]}を採用。MIN(現状, 前年)）")
        av_from_manual = False
    else:
        return None

    if cvr_from_manual and av_from_manual:
        basis = "manual"
    elif not cvr_from_manual and not av_from_manual:
        basis = "rule"
    else:
        basis = "mixed"

    return {
        "target_cvr": round(float(target_cvr), 2),
        "target_av": round(float(target_av), 0),
        "basis": basis,
        "basis_detail": "／".join(details),
        # ギャップ逆算（区切り3）のCVR上限に使う: 過去に実際に到達した水準
        "cvr_ceiling_candidates": [c[2] for c in cvr_cands],
    }


def _rpp_month_cpc(db: Session, ym: str) -> Optional[dict]:
    """指定月のRPP実績CPC（rpp_click 軸）。無ければ直近実績月へフォールバック。

    Returns: {"cpc", "source_month", "is_fallback"} | None（RPPデータが全く無い）
    """
    def _agg_month(target_ym: str) -> Optional[float]:
        y, m = int(target_ym[:4]), int(target_ym[5:7])
        from datetime import date as _date
        start = _date(y, m, 1)
        end = _date(y + 1, 1, 1) if m == 12 else _date(y, m + 1, 1)
        row = db.query(
            func.coalesce(func.sum(RppWeekly.ad_cost), 0.0),
            func.coalesce(func.sum(RppWeekly.ct), 0),
        ).filter(RppWeekly.week_start >= start, RppWeekly.week_start < end).one()
        ad_cost, ct = float(row[0] or 0), int(row[1] or 0)
        return round(ad_cost / ct, 1) if ct > 0 else None

    cpc = _agg_month(ym)
    if cpc is not None:
        return {"cpc": cpc, "source_month": ym, "is_fallback": False}

    # フォールバック: RppWeekly が存在する直近の月
    latest_week = (
        db.query(RppWeekly.week_start)
        .order_by(RppWeekly.week_start.desc())
        .limit(1)
        .scalar()
    )
    if latest_week is None:
        return None
    latest_ym = latest_week.strftime("%Y-%m")
    cpc = _agg_month(latest_ym)
    if cpc is None:
        return None
    return {"cpc": cpc, "source_month": latest_ym, "is_fallback": True}


def build_current_breakdown(db: Session, base_ym: str, sales_budget: Optional[float]) -> Optional[dict]:
    """基準月の一気通貫ブロック: 月次売上予算 → 必要アクセス → 想定広告費。

    既存 /api/evaluation/access-plan と同じ逆算式（必要アクセス = 目標売上 ÷ (CVR×客単価)）を
    使い、実績CVR・客単価の代わりに店舗全体の目標CVR・客単価（shop_target_rates）を使う。
    不足アクセス(UU)を広告クリックで1:1に埋める近似も access-plan を踏襲する（試算である
    旨を note で明示）。
    """
    if not sales_budget or sales_budget <= 0:
        return None
    rates = shop_target_rates(db, base_ym)
    if rates is None:
        return None

    target_cvr = rates["target_cvr"]
    target_av = rates["target_av"]
    if target_cvr <= 0 or target_av <= 0:
        return None

    required_access = round(sales_budget / target_av / (target_cvr / 100.0), 0)

    # 現状アクセス: 基準月の実績UUがあればそれ、無ければ直近実績月のUUを「見込み」として使う
    cur_month = get_shop_monthly(db, base_ym)
    if cur_month:
        actual_access = cur_month["access"]
        access_source_month = base_ym
    else:
        prev = _shop_month_at_or_before(db, base_ym)
        actual_access = prev["access"] if prev else None
        access_source_month = prev["year_month"] if prev else None

    shortfall = max(0.0, required_access - (actual_access or 0))

    cpc_info = _rpp_month_cpc(db, base_ym)
    est_ad_cost = round(shortfall * cpc_info["cpc"], 0) if cpc_info and shortfall > 0 else (0.0 if shortfall == 0 else None)

    return {
        "year_month": base_ym,
        "sales_budget": round(sales_budget, 0),
        "target_cvr": target_cvr,
        "target_av": target_av,
        "target_basis": rates["basis"],
        "target_basis_detail": rates["basis_detail"],
        "required_access": required_access,
        "access_axis": "site_uu",
        "actual_access": actual_access,
        "actual_access_month": access_source_month,
        "shortfall_access": round(shortfall, 0),
        "cpc": cpc_info["cpc"] if cpc_info else None,
        "cpc_source_month": cpc_info["source_month"] if cpc_info else None,
        "cpc_is_fallback": cpc_info["is_fallback"] if cpc_info else None,
        "est_ad_cost": est_ad_cost,
        "note": (
            "必要アクセスはページ全体アクセス(UU)、広告費試算はRPPのCPC実績で"
            "不足分を広告クリック1:1で埋める近似（既存アクセス逆算プランと同じ前提の試算値）"
        ),
        "_cvr_ceiling_candidates": rates["cvr_ceiling_candidates"],
    }


# ─── ギャップ逆算（区切り3） ─────────────────────────────────────────────────

def build_gap_options(
    db: Session,
    current: dict,
    allowable_ad_cost: float,
    cvr_ceiling_candidates: list,
) -> dict:
    """許容広告費を超える不足分を、CVR・客単価のどちらでどれだけ埋めるかを逆算する。

    順序型（オーナー承認済み 2026-08-02。evaluation.KPI_PRIORITY = access→cvr→av を踏襲）:
      1. 許容広告費で買える追加クリックを実CPCで算出 → 到達可能アクセス
      2. 案A: CVR改善のみで埋める場合の必要CVR
         上限 = MAX(現状CVR, 前年CVR)＝過去に実際に到達した水準（目標算出のMINと対の
         決定的ルール）。実績が無い場合はベンチマーク解決値（出どころ明示）
      3. 必要CVRが上限超過の場合のみ 案B: CVRを上限に固定し、残りを客単価で埋める
    案A・案Bは選択肢として並列に返す（自動では何も実行しない。保存もしない）。
    """
    sales_budget = current["sales_budget"]
    target_cvr = current["target_cvr"]
    target_av = current["target_av"]
    actual_access = current["actual_access"] or 0
    cpc = current["cpc"]

    base = {
        "allowable_ad_cost": allowable_ad_cost,
        "within_budget": None,
        "affordable_extra_ct": None,
        "affordable_access": None,
        "remaining_shortfall_access": None,
        "options": [],
        "note": None,
    }

    if cpc is None or cpc <= 0:
        base["note"] = "RPP実績（CPC）が無いため、許容広告費で買える追加アクセスを試算できません。RPPデータを取り込むと利用できます。"
        return base

    est = current["est_ad_cost"]
    if est is not None and allowable_ad_cost >= est:
        base["within_budget"] = True
        base["note"] = (
            f"必要な追加広告費（試算 ¥{est:,.0f}）は許容額の範囲内です。"
            "アクセス補填（広告）だけで月次売上予算に届く計算になります。"
        )
        return base

    base["within_budget"] = False
    affordable_extra_ct = allowable_ad_cost / cpc
    affordable_access = actual_access + affordable_extra_ct
    base["affordable_extra_ct"] = round(affordable_extra_ct, 0)
    base["affordable_access"] = round(affordable_access, 0)
    base["remaining_shortfall_access"] = round(
        max(0.0, current["required_access"] - affordable_access), 0
    )

    if affordable_access <= 0:
        base["note"] = "現状アクセスの実績が無く、許容広告費だけでは到達可能アクセスを算出できません。"
        return base

    # ── CVR改善の上限: 過去に実際に到達した水準（無ければベンチマーク解決値）──
    if cvr_ceiling_candidates:
        ceiling = max(cvr_ceiling_candidates)
        ceiling_source = "過去実績の最高水準（MAX(現状, 前年)）"
    else:
        from benchmarks import resolve_benchmark
        bench = resolve_benchmark(db, "page_cvr")
        ceiling = bench["value"]
        ceiling_source = f"ベンチマーク（{bench['source_label']}）"

    # 案A: アクセスは予算内の到達可能値で固定し、CVR改善のみで埋める
    required_cvr = round(sales_budget / target_av / affordable_access * 100, 2)
    feasible_a = required_cvr <= ceiling
    base["options"].append({
        "type": "cvr",
        "label": "案A: CVR改善で埋める",
        "required_cvr": required_cvr,
        "current_target_cvr": target_cvr,
        "improvement_pct": round((required_cvr / target_cvr - 1) * 100, 1) if target_cvr > 0 else None,
        "ceiling": round(float(ceiling), 2),
        "ceiling_source": ceiling_source,
        "feasible": feasible_a,
        "detail": (
            f"到達可能アクセス {affordable_access:,.0f} UU のまま、CVRを {target_cvr}% → {required_cvr}% に"
            f"改善できれば予算に届きます（上限めやす: {ceiling}%＝{ceiling_source}）"
        ),
    })

    # 案B: 必要CVRが上限を超える場合のみ、CVRを上限に固定して残りを客単価で埋める
    if not feasible_a:
        required_av = round(sales_budget / affordable_access / (ceiling / 100.0), 0)
        base["options"].append({
            "type": "cvr_plus_av",
            "label": "案B: CVR上限＋客単価改善で埋める",
            "cvr_at_ceiling": round(float(ceiling), 2),
            "required_av": required_av,
            "current_target_av": target_av,
            "improvement_pct": round((required_av / target_av - 1) * 100, 1) if target_av > 0 else None,
            "feasible": None,
            "detail": (
                f"CVRを上限めやす {ceiling}% まで改善したうえで、客単価を ¥{target_av:,.0f} → ¥{required_av:,.0f} に"
                "引き上げられれば予算に届きます（セット販売・同梱提案・送料ライン見直し等）"
            ),
        })

    base["note"] = (
        "改善順序は アクセス → CVR → 客単価 のウォーターフォール（設計の固定順）。"
        "いずれも試算値であり、自動では何も実行・保存されません。"
    )
    return base


def item_target_consistency(db: Session, base_ym: str, sales_budget: Optional[float]) -> dict:
    """アイテム別目標（第3段階・手入力）と月次売上予算の整合性チェック（警告のみ）。

    アイテム目標は全商品に入れる運用ではないため、合計が予算を下回るのは正常。
    超過したときだけ警告フラグを立てる（強制同期はしない。オーナー承認済み 2026-08-02）。
    """
    from models import ItemTarget

    rows = db.query(
        func.count(ItemTarget.id),
        func.coalesce(func.sum(ItemTarget.target_sales), 0.0),
    ).filter(ItemTarget.year_month == base_ym).one()
    count, total = int(rows[0] or 0), float(rows[1] or 0)

    coverage = None
    over = False
    if sales_budget and sales_budget > 0 and count > 0:
        coverage = round(total / sales_budget * 100, 1)
        over = total > sales_budget
    return {
        "count": count,
        "sum": round(total, 0),
        "coverage_rate": coverage,
        "over_budget": over,
    }


# ─── 予算プランの構築 ────────────────────────────────────────────────────────

def build_budget_plan(db: Session, shop, base_ym: str,
                      allowable_ad_cost: Optional[float] = None) -> dict:
    """年間売上予算の月次按分プラン（12ヶ月分）を構築する。

    Args:
        shop: masters.get_or_create_default_shop() で解決済みの店舗行
        base_ym: 基準月 YYYY-MM（この月を含む予算年度を対象にする）

    Returns: routers/revenue_plan.py のレスポンス骨格（status / months / guide 等）。
    """
    annual_budget = shop.annual_sales_budget
    start_month = shop.budget_year_start_month or 1
    months = budget_year_months(base_ym, start_month)

    index = monthly_sales_index(db)
    valid_count = index["valid_months"]

    if not annual_budget or annual_budget <= 0:
        status = "no_budget"
    elif valid_count == 0:
        status = "collect_data"
    elif index["shares"] is None:
        status = "flat"
    else:
        status = "ok"

    month_rows = []
    for ym in months:
        cal_m = int(ym[5:7])
        if status == "ok":
            share = index["shares"][cal_m]
        elif status == "flat":
            share = 1.0 / 12.0
        else:
            share = None
        actual = index["monthly_sales"].get(ym)
        budget = round(annual_budget * share, 0) if share is not None else None
        month_rows.append({
            "year_month": ym,
            "index": round(share * 12, 3) if share is not None else None,  # 平均=1.0 の指数
            "sales_budget": budget,
            "actual_sales": round(actual, 0) if actual is not None else None,
            "achievement_rate": (
                round(actual / budget * 100, 1)
                if budget and budget > 0 and actual is not None else None
            ),
        })

    guide = _build_guide(status, index)

    # ── 基準月の一気通貫ブロック（区切り2）: 予算 → 必要アクセス → 想定広告費 ──
    current = None
    if status in ("ok", "flat"):
        base_row = next((m for m in month_rows if m["year_month"] == base_ym), None)
        base_budget = base_row["sales_budget"] if base_row else None
        current = build_current_breakdown(db, base_ym, base_budget)
    cvr_ceiling_candidates = current.pop("_cvr_ceiling_candidates", []) if current else []

    # ── ギャップ逆算（区切り3）: 許容広告費が入力されたときだけ試算する（保存しない）──
    gap = None
    if current is not None and allowable_ad_cost is not None and allowable_ad_cost >= 0:
        gap = build_gap_options(db, current, float(allowable_ad_cost), cvr_ceiling_candidates)

    # ── アイテム別目標との整合性（警告のみ・強制同期なし）──
    base_budget_for_check = None
    if current is not None:
        base_budget_for_check = current["sales_budget"]
    item_check = item_target_consistency(db, base_ym, base_budget_for_check)

    return {
        "status": status,
        "annual_sales_budget": annual_budget,
        "budget_year_start_month": start_month,
        "budget_year": {"from": months[0], "to": months[-1]},
        "base_month": base_ym,
        "seasonal_index": {
            "source": index["source"],
            "access_axis": index["access_axis"],
            "confidence": index["confidence"],
            "valid_months": valid_count,
            "covered_calendar_months": index["covered_calendar_months"],
            "period_from": index["period_from"],
            "period_to": index["period_to"],
            "min_access_per_month": min_access_for("monthly"),
        },
        "months": month_rows,
        "current": current,
        "gap": gap,
        "item_target_check": item_check,
        "guide": guide,
    }


def _build_guide(status: str, index: dict) -> dict:
    """状態に応じた日本語の案内文（フロントはこれをそのまま表示できる）。"""
    valid = index["valid_months"]
    if status == "no_budget":
        return {
            "title": "年間売上予算が未設定です",
            "message": "目標設定画面で年間売上予算を入力すると、過去実績の季節性に応じた月次予算の按分と、達成に必要なアクセス・広告費の逆算が使えるようになります。",
        }
    if status == "collect_data":
        return {
            "title": "まず1ヶ月、データを集めましょう",
            "message": (
                "季節按分に使える実績月がまだありません（月次のアクセス母数が"
                f"{min_access_for('monthly')}以上の月が対象）。まずは商品分析レポート（月次）を"
                "取り込んで1ヶ月分の実績を蓄積してください。実績が貯まると、均等按分 → 季節按分へ"
                "自動的に精度が上がります。それまでの月次目標は目標設定画面の手入力で運用できます。"
            ),
        }
    if status == "flat":
        return {
            "title": "均等按分で表示しています",
            "message": (
                f"季節指数の算出には暦月1周分（12ヶ月）の有効実績が必要です（現在{valid}ヶ月）。"
                "それまでは年間予算を12等分した均等按分で表示します。実績が12ヶ月分貯まると"
                "自動的に季節按分へ切り替わります。"
            ),
        }
    # ok
    note = "同じ暦月を2回以上観測した平均シェアで按分しています。"
    if index["confidence"] == "medium":
        note = (
            "実績1周分のシェアで按分しています（トレンドと季節性はまだ分離できません。"
            "2年分の実績が貯まると精度が上がります）。"
        )
    if index["source"] == "rpp":
        note += "※商品分析レポート未取込のため、RPP経由売上の季節形状で代用しています。"
    return {"title": "季節指数で按分しています", "message": note}
