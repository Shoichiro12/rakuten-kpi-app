# -*- coding: utf-8 -*-
"""Phase 2: 学習ループの効果測定。

docs/VISION.md の Phase 2「提案 → 実施結果 → 売上変化 → 学習」を回す土台。

考え方:
  実施時点のKPIは ActionLog にスナップショットされている（後から遡って復元できない）。
  そこへ「実施した月の次の月の実績」を突き合わせれば、施策ごとの前後比較ができる。

正直さの原則（VISION.md「データが無いときこそ意思決定を止めない」の裏返し）:
  - 次の月のデータがまだ無いものは "pending"（測定待ち）として明示する。
    勝手に「効果あり」と言わない。
  - 効果は相関であって因果ではない。季節要因や他施策の影響を分離できないため、
    UI・文言では「実施後の変化」と表現し「この施策の効果」と断定しない。
  - サンプル数を必ず併記する。1件の結果を根拠に提案順位を大きく動かさない。
"""

from typing import Optional

# 提案キー（コロンより前）と、効果を測るべきKPIの対応。
# 商品単位の提案は "rule:management_no" 形式なのでプレフィックスで判定する。
_METRIC_BY_RULE = {
    "access_budget": "access",
    "ctr_creative": "access",      # クリック改善はアクセス増として現れる
    "cvr_page": "cvr",
    "cvr_yoy_down": "cvr",
    "av_bundle": "av",
    "roi_negative": "sales",
    "cpc_rising": "access",
    "set_target": None,            # 設定作業なので効果測定の対象外
    "import_rpp": None,            # データ取込みも同様
    # --- 商品単位 ---
    "stock_out": "sales",
    "review_zero": "cvr",
    "review_low": "cvr",
    "boost": "access",
}

_METRIC_LABEL = {
    "sales": "売上",
    "access": "アクセス",
    "cvr": "CVR",
    "av": "客単価",
}


def _rule_of(action_key: str) -> str:
    return (action_key or "").split(":")[0]


def _target_of(action_key: str) -> Optional[str]:
    """商品単位の提案なら management_no を返す。店舗全体なら None。"""
    parts = (action_key or "").split(":", 1)
    return parts[1] if len(parts) > 1 else None


def _next_month(ym: str) -> str:
    year, month = int(ym[:4]), int(ym[5:7])
    return f"{year + 1}-01" if month == 12 else f"{year}-{month + 1:02d}"


def _shop_metrics(db, ym: str) -> Optional[dict]:
    """指定月の店舗全体実績。shop_metrics と同じ定義を使う。"""
    from shop_metrics import get_shop_monthly

    return get_shop_monthly(db, ym)


def _product_metrics(db, ym: str, management_no: str) -> Optional[dict]:
    """指定月・指定商品の実績。"""
    from models import MonthlyItemSales

    row = (
        db.query(MonthlyItemSales)
        .filter(
            MonthlyItemSales.year_month == ym,
            MonthlyItemSales.management_no == management_no,
        )
        .first()
    )
    if row is None:
        return None
    access = row.access_uu or 0
    cv = row.cv or 0
    sales = row.sales or 0
    return {
        "sales": sales,
        "access": access,
        "cv": cv,
        "cvr": round(cv / access * 100, 2) if access > 0 else 0,
        "av": round(sales / cv, 0) if cv > 0 else 0,
    }


def measure_action(db, log) -> dict:
    """1件の実施記録について、実施月と翌月の実績を比較する。

    Returns:
        status : 'measured'（測定できた） / 'pending'（翌月データ待ち）
                 / 'not_applicable'（効果測定の対象外の施策）
        metric / metric_label / before / after / delta_pct
    """
    rule = _rule_of(log.action_key)
    metric = _METRIC_BY_RULE.get(rule)

    base = {
        "action_key": log.action_key,
        "title": log.title,
        "period_key": log.period_key,
        "status_label": log.status,
        "product_name": None,
        "metric": metric,
        "metric_label": _METRIC_LABEL.get(metric or "", None),
        "before": None,
        "after": None,
        "delta_pct": None,
        "next_period": None,
    }

    if metric is None:
        base["status"] = "not_applicable"
        return base

    # 週次で実施された記録は period_key が日付。効果測定は月次で行う。
    ym = log.period_key[:7]
    nxt = _next_month(ym)
    base["next_period"] = nxt

    mgmt = _target_of(log.action_key)
    if mgmt:
        before = _product_metrics(db, ym, mgmt)
        after = _product_metrics(db, nxt, mgmt)
        if before is None and after is None:
            base["status"] = "pending"
            return base
    else:
        before = _shop_metrics(db, ym)
        after = _shop_metrics(db, nxt)

    # 実施時点のスナップショットを優先する（実施後に当月データが更新されても、
    # 「実施したときに見えていた数字」を起点にするのが正しい比較になる）
    snap = {
        "sales": log.snapshot_sales,
        "access": log.snapshot_access,
        "cvr": log.snapshot_cvr,
        "av": log.snapshot_av,
    }
    before_val = snap.get(metric)
    if before_val is None and before:
        before_val = before.get(metric)

    after_val = after.get(metric) if after else None

    if after_val is None:
        # 翌月のデータがまだ無い＝これから測る段階。勝手に効果ありとは言わない。
        base["status"] = "pending"
        base["before"] = before_val
        return base

    base["before"] = before_val
    base["after"] = after_val
    if before_val:
        base["delta_pct"] = round((after_val - before_val) / before_val * 100, 1)
    base["status"] = "measured"
    return base


# 提案順位に効果実績を反映しはじめる最低サンプル数。
# 1〜2件の結果で提案順を動かすと、季節要因や偶然を「学習」してしまう。
MIN_SAMPLE_FOR_WEIGHT = 3
# 反映の上限。実績が良くても順位を大きく飛ばさない（他の根拠を潰さないため）。
MAX_WEIGHT = 0.5


def measure_all(db, limit: int = 20) -> list:
    """実施記録を新しい順に測定して返す。"""
    from models import ActionLog

    logs = (
        db.query(ActionLog)
        .filter(ActionLog.status == "done")
        .order_by(ActionLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [measure_action(db, log) for log in logs]


def summarize_outcomes(db) -> dict:
    """施策の種類（ルール）ごとに、実施後の変化を集計する。

    Returns:
        { rule: {"count": n, "avg_delta_pct": x, "metric": "cvr", "positive": n} }
    """
    results = measure_all(db, limit=200)
    agg: dict = {}
    for r in results:
        if r["status"] != "measured" or r["delta_pct"] is None:
            continue
        rule = _rule_of(r["action_key"])
        a = agg.setdefault(
            rule, {"count": 0, "sum_delta": 0.0, "positive": 0, "metric": r["metric"]}
        )
        a["count"] += 1
        a["sum_delta"] += r["delta_pct"]
        if r["delta_pct"] > 0:
            a["positive"] += 1

    for rule, a in agg.items():
        a["avg_delta_pct"] = round(a["sum_delta"] / a["count"], 1) if a["count"] else None
        a.pop("sum_delta", None)
        a["metric_label"] = _METRIC_LABEL.get(a.get("metric") or "", None)
    return agg


def outcome_weights(db) -> dict:
    """過去の実績から、提案順位への調整値を作る（-MAX_WEIGHT 〜 +MAX_WEIGHT）。

    「効果が出た施策を上に、出なかった施策を下に」を控えめに反映する。
    サンプル数が MIN_SAMPLE_FOR_WEIGHT 未満のルールは調整しない（0を返す）。
    これは統計的な学習ではなく、あくまで順位の微調整。効果の断定はしない。
    """
    weights = {}
    for rule, a in summarize_outcomes(db).items():
        if a["count"] < MIN_SAMPLE_FOR_WEIGHT:
            continue
        avg = a.get("avg_delta_pct") or 0
        # 平均変化率 ±10% を上限値に対応させる（10%改善で +0.5）
        w = max(-MAX_WEIGHT, min(MAX_WEIGHT, avg / 20.0))
        weights[rule] = round(w, 3)
    return weights
