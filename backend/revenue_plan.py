# -*- coding: utf-8 -*-
"""売上予算プラン（アクション提案ロジック第4段階v2＋追加指示書2026-08-02）。

年間売上予算 → 月次按分（季節指数・手動補正） → 12ヶ月分の必要アクセス・目標CVR・
目標客単価・想定広告費 → 基準月のギャップ逆算、というマネージャー層の
「年間予算の月次落とし込み」を一気通貫で支援するロジックの本体。

設計方針（実装計画書 jisso_keikaku_uriage_gap_2026-08-02.md / jisso_keikaku_12m_planner_2026-08-02.md）:
  - 季節指数の元データは MonthlyItemSales の店舗全体合算（site_uu 軸）を正とする。
    「有効実績月」= 月次母数ゲート（min_access_for("monthly")=430）通過月のみ算入。
  - 商品分析未取込の店舗は RppWeekly 月次集計（rpp_click 軸）で代用（confidence上限medium、
    1つの指数計算の中で両ソースを混在させない）。
  - 指数・按分値・逆算値は保存せず都度算出する。
  - 月次売上予算は Target.target_sales_budget で月単位の手動補正ができる（null=自動按分）。
    手動補正は他月へ再配分しない（オーナー承認済み。12ヶ月合計は年間予算とズレうる）。
  - 12ヶ月フル逆算の目標CVR・客単価は「基準月ロジックの対象月一般化」:
      現状値 = その月以前の直近実績月（未来月は自動的に最新実績月で固定になる）
      前年値 = その月の前年同月実績
      目標 = MIN(現状値, 前年値)。Target手入力がある月は指標ごとにそれが常に勝つ
    前年同月を経由して季節性が目標値に反映される（月によって目標が変わるのは仕様）。
  - CPCは各月のRPP実績、無い月（未来月など）は直近実績月の値で一律
    （CPCの季節性はスコープ外。フロントで注記する）。
  - 広告費の自動配分・上限管理はしない（オーナー確定 2026-08-02）。

パフォーマンス:
  12ヶ月分の逆算を素朴に月ループすると1リクエスト約80クエリになるため、
  プリフェッチ方式にしている。DBアクセスは原則次の3回だけ:
    ①MonthlyItemSales の年月別合算（sales/uu/cv） ②RppWeekly の年月別合算
    （gross/ct/ad_cost） ③予算年度12ヶ月分の Target。
  以降は純Python計算。新しい月別ロジックを足すときもこの原則を守ること
  （ループ内で db.query を呼ばない）。

しきい値定数は calculations.py（SEASONAL_HIGH_MONTHS 等）が単一の真実。
"""
from typing import Literal, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import MonthlyItemSales, RppWeekly, Target
from access_definitions import min_access_for
from calculations import SEASONAL_HIGH_MONTHS, SEASONAL_MIN_MONTHS

IndexSource = Literal["item_sales", "rpp"]


# ─── 年月ユーティリティ ──────────────────────────────────────────────────────

def shift_month(ym: str, n: int) -> str:
    """YYYY-MM に n ヶ月を加算した YYYY-MM を返す（n は負も可）。"""
    year, month = int(ym[:4]), int(ym[5:7])
    total = year * 12 + (month - 1) + n
    return f"{total // 12}-{total % 12 + 1:02d}"


def _prev_year_ym(ym: str) -> str:
    return f"{int(ym[:4]) - 1}-{ym[5:7]}"


def budget_year_months(base_ym: str, start_month: int) -> list[str]:
    """base_ym を含む予算年度（start_month 起点の12ヶ月）の YYYY-MM リストを返す。

    例: base_ym=2026-02, start_month=4 → 2025-04 〜 2026-03。
    """
    start_month = min(max(int(start_month or 1), 1), 12)
    year, month = int(base_ym[:4]), int(base_ym[5:7])
    start_year = year if month >= start_month else year - 1
    first = f"{start_year}-{start_month:02d}"
    return [shift_month(first, i) for i in range(12)]


# ─── 月次実績の収集（プリフェッチ。DBアクセスはここに集約） ──────────────────

def _collect_item_sales_months(db: Session) -> dict:
    """MonthlyItemSales を年月ごとに店舗合算する（site_uu 軸）。

    Returns: {ym: {"sales": float, "denominator": int(UU), "cv": int}}
    denominator は母数ゲート判定用のアクセスUU合計。cv は目標CVR・客単価の算出用。
    """
    rows = (
        db.query(
            MonthlyItemSales.year_month,
            func.coalesce(func.sum(MonthlyItemSales.sales), 0.0),
            func.coalesce(func.sum(MonthlyItemSales.access_uu), 0),
            func.coalesce(func.sum(MonthlyItemSales.cv), 0),
        )
        .group_by(MonthlyItemSales.year_month)
        .all()
    )
    return {
        ym: {"sales": float(sales or 0), "denominator": int(uu or 0), "cv": int(cv or 0)}
        for ym, sales, uu, cv in rows
    }


def _collect_rpp_months(db: Session) -> dict:
    """RppWeekly を week_start の月で店舗合算する（rpp_click 軸）。

    指数のフォールバック元＋各月のCPC算出に使う。
    月跨ぎ週は week_start の月に丸められる既知の制約つき。SQLite/Postgres 両対応の
    ため strftime は使わず、Python 側で月キーに変換する。
    Returns: {ym: {"sales": float(gross), "denominator": int(ct), "ad_cost": float}}
    """
    rows = (
        db.query(
            RppWeekly.week_start,
            func.coalesce(func.sum(RppWeekly.gross), 0.0),
            func.coalesce(func.sum(RppWeekly.ct), 0),
            func.coalesce(func.sum(RppWeekly.ad_cost), 0.0),
        )
        .group_by(RppWeekly.week_start)
        .all()
    )
    agg: dict = {}
    for week_start, gross, ct, ad_cost in rows:
        ym = week_start.strftime("%Y-%m")
        a = agg.setdefault(ym, {"sales": 0.0, "denominator": 0, "ad_cost": 0.0})
        a["sales"] += float(gross or 0)
        a["denominator"] += int(ct or 0)
        a["ad_cost"] += float(ad_cost or 0)
    return agg


def build_context(db: Session, months: list[str]) -> dict:
    """予算年度の計算に必要なデータを一括プリフェッチする（クエリ3回）。"""
    return {
        "item_months": _collect_item_sales_months(db),
        "rpp_months": _collect_rpp_months(db),
        "targets_by_ym": {
            t.year_month: t
            for t in db.query(Target).filter(Target.year_month.in_(months)).all()
        },
    }


# ─── 月別販売指数（季節指数） ────────────────────────────────────────────────

def monthly_sales_index(db: Session, item_months: Optional[dict] = None,
                        rpp_months: Optional[dict] = None) -> dict:
    """店舗全体の月別販売指数（季節指数）を算出する。

    item_months / rpp_months はプリフェッチ済みの集計を渡す（省略時は自分で収集）。

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
    if item_months is None:
        item_months = _collect_item_sales_months(db)
    if rpp_months is None:
        rpp_months = _collect_rpp_months(db)

    candidates = []
    for source, axis, data in (
        ("item_sales", "site_uu", item_months),
        ("rpp", "rpp_click", rpp_months),
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


# ─── 月別の目標CVR・客単価・CPC（純Python。ctx以外に触らない） ────────────────

def _cvr_av_from_agg(agg: Optional[dict]) -> Optional[dict]:
    """月次合算 {sales, denominator(UU), cv} から CVR(%)・客単価を出す（site_uu 軸）。"""
    if not agg:
        return None
    uu = agg["denominator"]
    cv = agg.get("cv", 0)
    sales = agg["sales"]
    if uu <= 0 and cv <= 0:
        return None
    return {
        "cvr": round(cv / uu * 100, 2) if uu > 0 else 0,
        "av": round(sales / cv, 0) if cv > 0 else 0,
    }


def _latest_item_ym(item_months: dict, at_or_before: Optional[str] = None) -> Optional[str]:
    """実績のある直近の年月キー。at_or_before 指定時はその月以前を優先し、無ければ全体の最新。"""
    keys = sorted(item_months.keys())
    if not keys:
        return None
    if at_or_before is not None:
        prior = [k for k in keys if k <= at_or_before]
        if prior:
            return prior[-1]
    return keys[-1]


def resolve_month_targets(ctx: dict, ym: str) -> Optional[dict]:
    """指定月の目標CVR・客単価を解決する（12ヶ月フル逆算の中核）。

    優先順位（オーナー承認済み）:
      1. その月の Target に手入力の target_cvr / target_av があれば指標ごとに優先
      2. 確定公式 MIN(現状値, 前年値)。
         現状値 = その月以前の直近実績月の店舗合算（未来月は最新実績月で固定になる）
         前年値 = その月の前年同月の店舗合算
    Returns: {target_cvr, target_av, basis, cvr_basis, av_basis, basis_detail,
              cvr_ceiling_candidates} | None（実績も手入力も無い）
    """
    item_months = ctx["item_months"]
    manual = ctx["targets_by_ym"].get(ym)
    manual_cvr = manual.target_cvr if manual and (manual.target_cvr or 0) > 0 else None
    manual_av = manual.target_av if manual and (manual.target_av or 0) > 0 else None

    cur_ym = _latest_item_ym(item_months, at_or_before=ym)
    cur = _cvr_av_from_agg(item_months.get(cur_ym)) if cur_ym else None
    py_ym = _prev_year_ym(ym)
    py = _cvr_av_from_agg(item_months.get(py_ym))

    cvr_cands = []
    av_cands = []
    if cur and cur["cvr"] > 0:
        cvr_cands.append(("現状値", cur_ym, cur["cvr"]))
    if py and py["cvr"] > 0:
        cvr_cands.append(("前年値", py_ym, py["cvr"]))
    if cur and cur["av"] > 0:
        av_cands.append(("現状値", cur_ym, cur["av"]))
    if py and py["av"] > 0:
        av_cands.append(("前年値", py_ym, py["av"]))

    details = []
    if manual_cvr is not None:
        target_cvr, cvr_basis = manual_cvr, "manual"
        details.append(f"目標CVR={target_cvr}%（目標設定画面の手入力を採用）")
    elif cvr_cands:
        pick = min(cvr_cands, key=lambda x: x[2])
        target_cvr, cvr_basis = pick[2], "rule"
        details.append(f"目標CVR={target_cvr}%（{pick[0]} {pick[1]}を採用。MIN(現状, 前年)）")
    else:
        return None

    if manual_av is not None:
        target_av, av_basis = manual_av, "manual"
        details.append(f"目標客単価=¥{int(target_av):,}（目標設定画面の手入力を採用）")
    elif av_cands:
        pick = min(av_cands, key=lambda x: x[2])
        target_av, av_basis = pick[2], "rule"
        details.append(f"目標客単価=¥{int(target_av):,}（{pick[0]} {pick[1]}を採用。MIN(現状, 前年)）")
    else:
        return None

    if cvr_basis == "manual" and av_basis == "manual":
        basis = "manual"
    elif cvr_basis == "rule" and av_basis == "rule":
        basis = "rule"
    else:
        basis = "mixed"

    return {
        "target_cvr": round(float(target_cvr), 2),
        "target_av": round(float(target_av), 0),
        "basis": basis,
        "cvr_basis": cvr_basis,
        "av_basis": av_basis,
        "basis_detail": "／".join(details),
        # ギャップ逆算のCVR上限に使う: 過去に実際に到達した水準
        "cvr_ceiling_candidates": [c[2] for c in cvr_cands],
    }


def resolve_month_cpc(ctx: dict, ym: str) -> Optional[dict]:
    """指定月のRPP実績CPC。その月に実績が無ければ直近実績月へフォールバック。

    Returns: {"cpc", "source_month", "is_fallback"} | None（RPPデータが全く無い）
    """
    rpp_months = ctx["rpp_months"]

    def _cpc_of(target_ym: str) -> Optional[float]:
        a = rpp_months.get(target_ym)
        if a and a["denominator"] > 0:
            return round(a["ad_cost"] / a["denominator"], 1)
        return None

    cpc = _cpc_of(ym)
    if cpc is not None:
        return {"cpc": cpc, "source_month": ym, "is_fallback": False}

    for latest in sorted(rpp_months.keys(), reverse=True):
        cpc = _cpc_of(latest)
        if cpc is not None:
            return {"cpc": cpc, "source_month": latest, "is_fallback": True}
    return None


def build_month_cascade(ctx: dict, ym: str, sales_budget: Optional[float]) -> dict:
    """1ヶ月分のカスケード（必要アクセス→想定広告費）を算出する（3章）。

    months配列の各月に足すフィールド一式を返す。算出できない月も行を隠さず、
    null＋basis_detail で「まだわからないこと」を明示する。
    """
    empty = {
        "required_access": None,
        "target_cvr": None,
        "target_cvr_basis": None,
        "target_av": None,
        "target_av_basis": None,
        "basis_detail": None,
        "actual_access": None,
        "actual_access_month": None,
        "shortfall_access": None,
        "cpc": None,
        "cpc_source_month": None,
        "cpc_is_fallback": None,
        "est_ad_cost": None,
    }
    if not sales_budget or sales_budget <= 0:
        return empty

    rates = resolve_month_targets(ctx, ym)
    if rates is None or rates["target_cvr"] <= 0 or rates["target_av"] <= 0:
        empty["basis_detail"] = "実績・手入力が無いため算出できません（実績の蓄積後に自動算出されます）"
        return empty

    required = round(sales_budget / rates["target_av"] / (rates["target_cvr"] / 100.0), 0)

    # 現状アクセス: その月の実績UUがあればそれ、無ければ直近実績月のUUを「見込み」に使う
    item_months = ctx["item_months"]
    own = item_months.get(ym)
    if own and own["denominator"] > 0:
        actual_access = own["denominator"]
        access_month = ym
    else:
        latest = _latest_item_ym(item_months)
        actual_access = item_months[latest]["denominator"] if latest else None
        access_month = latest

    shortfall = max(0.0, required - (actual_access or 0))
    cpc_info = resolve_month_cpc(ctx, ym)
    est = (
        round(shortfall * cpc_info["cpc"], 0) if cpc_info and shortfall > 0
        else (0.0 if shortfall == 0 else None)
    )

    return {
        "required_access": required,
        "target_cvr": rates["target_cvr"],
        "target_cvr_basis": rates["cvr_basis"],
        "target_av": rates["target_av"],
        "target_av_basis": rates["av_basis"],
        "basis_detail": rates["basis_detail"],
        "actual_access": actual_access,
        "actual_access_month": access_month,
        "shortfall_access": round(shortfall, 0),
        "cpc": cpc_info["cpc"] if cpc_info else None,
        "cpc_source_month": cpc_info["source_month"] if cpc_info else None,
        "cpc_is_fallback": cpc_info["is_fallback"] if cpc_info else None,
        "est_ad_cost": est,
    }


def build_current_breakdown(ctx: dict, base_ym: str, sales_budget: Optional[float]) -> Optional[dict]:
    """基準月の一気通貫ブロック（区切り2からの既存レスポンス形を維持）。

    12ヶ月カスケードと同じ計算（build_month_cascade）を基準月に適用し、
    ダッシュボードパネル用の note・basis 集約を付けて返す。
    """
    cascade = build_month_cascade(ctx, ym=base_ym, sales_budget=sales_budget)
    if not sales_budget or sales_budget <= 0 or cascade["required_access"] is None:
        return None
    rates = resolve_month_targets(ctx, base_ym)  # 純Python再解決（クエリなし）

    return {
        "year_month": base_ym,
        "sales_budget": round(sales_budget, 0),
        "target_cvr": cascade["target_cvr"],
        "target_av": cascade["target_av"],
        "target_basis": rates["basis"],
        "target_basis_detail": cascade["basis_detail"],
        "required_access": cascade["required_access"],
        "access_axis": "site_uu",
        "actual_access": cascade["actual_access"],
        "actual_access_month": cascade["actual_access_month"],
        "shortfall_access": cascade["shortfall_access"],
        "cpc": cascade["cpc"],
        "cpc_source_month": cascade["cpc_source_month"],
        "cpc_is_fallback": cascade["cpc_is_fallback"],
        "est_ad_cost": cascade["est_ad_cost"],
        "note": (
            "必要アクセスはページ全体アクセス(UU)、広告費試算はRPPのCPC実績で"
            "不足分を広告クリック1:1で埋める近似（既存アクセス逆算プランと同じ前提の試算値）"
        ),
        "_cvr_ceiling_candidates": rates["cvr_ceiling_candidates"],
    }


# ─── ギャップ逆算（基準月のみ） ──────────────────────────────────────────────

def build_gap_options(
    db: Session,
    current: dict,
    allowable_ad_cost: float,
    cvr_ceiling_candidates: list,
) -> dict:
    """許容広告費を超える不足分を、CVR・客単価のどちらでどれだけ埋めるかを逆算する。

    順序型（オーナー承認済み 2026-08-02。evaluation.KPI_PRIORITY = access→cvr→av を踏襲):
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
    """年間売上予算の月次按分＋12ヶ月フル逆算プランを構築する。

    Args:
        shop: masters.get_or_create_default_shop() で解決済みの店舗行
        base_ym: 基準月 YYYY-MM（この月を含む予算年度を対象にする）

    Returns: routers/revenue_plan.py のレスポンス骨格（status / months / current / gap 等）。
    """
    annual_budget = shop.annual_sales_budget
    start_month = shop.budget_year_start_month or 1
    months = budget_year_months(base_ym, start_month)

    ctx = build_context(db, months)
    index = monthly_sales_index(db, ctx["item_months"], ctx["rpp_months"])
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
            "sales_budget_source": "index" if budget is not None else None,
            "actual_sales": round(actual, 0) if actual is not None else None,
            "achievement_rate": (
                round(actual / budget * 100, 1)
                if budget and budget > 0 and actual is not None else None
            ),
        })

    # ── 月次売上予算の手動補正（2章）: 補正がある月はその値を優先する ──────────
    # 上書きした月以外の自動按分値は変えない（再配分しない。オーナー承認済み）。
    # そのため12ヶ月合計は年間予算とズレうる（フロントで差分を情報表示する）。
    for row in month_rows:
        t = ctx["targets_by_ym"].get(row["year_month"])
        ov = t.target_sales_budget if t and t.target_sales_budget and t.target_sales_budget > 0 else None
        if ov is None:
            continue
        row["sales_budget"] = round(float(ov), 0)
        row["sales_budget_source"] = "manual"
        actual = index["monthly_sales"].get(row["year_month"])
        row["achievement_rate"] = (
            round(actual / ov * 100, 1) if actual is not None else None
        )

    # ── 12ヶ月フル逆算（3章）: 各月に必要アクセス→想定広告費のカスケードを足す ──
    # 過去月にも出す（「あの月は必要アクセスに届いていたか」の事後検証用。オーナー承認済み）
    for row in month_rows:
        row.update(build_month_cascade(ctx, row["year_month"], row["sales_budget"]))

    guide = _build_guide(status, index)

    # ── 基準月の一気通貫ブロック: 予算 → 必要アクセス → 想定広告費 ──
    current = None
    if status in ("ok", "flat"):
        base_row = next((m for m in month_rows if m["year_month"] == base_ym), None)
        base_budget = base_row["sales_budget"] if base_row else None
        current = build_current_breakdown(ctx, base_ym, base_budget)
    cvr_ceiling_candidates = current.pop("_cvr_ceiling_candidates", []) if current else []

    # ── ギャップ逆算: 許容広告費が入力されたときだけ試算する（保存しない）──
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
