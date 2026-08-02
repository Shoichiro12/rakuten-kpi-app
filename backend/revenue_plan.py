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

from models import MonthlyItemSales, RppWeekly
from access_definitions import min_access_for
from calculations import SEASONAL_HIGH_MONTHS, SEASONAL_MIN_MONTHS

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


# ─── 予算プランの構築 ────────────────────────────────────────────────────────

def build_budget_plan(db: Session, shop, base_ym: str) -> dict:
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
