# -*- coding: utf-8 -*-
"""商品単位の「今日やるべきこと」生成（Phase 1 の深掘り）。

店舗全体のKPIだけでは「CVRを上げましょう」までしか言えない。
docs/VISION.md が目指すのは AIストアマネージャーなので、
「どの商品の」「何を」直すかまで落とす必要がある。このモジュールがその役割。

入力は商品分析レポート（MonthlyItemSales）1ヶ月分。RPP広告データが無くても動く。

設計原則:
  1. 100UUルール（evaluation.MIN_ACCESS_SAMPLE）を守る。母数が小さい商品の
     CVR・客単価は統計的に信用できないため、判定対象から外す。
  2. 優先順位は「深刻さ」ではなく「金額インパクト」で決める。
     売上への効きが大きい商品から順に手を付けるのが最短ルート。
  3. 各提案には必ず根拠の数値と、その商品名を添える。
"""

from typing import Optional

from access_definitions import MIN_ACCESS_SAMPLE, is_reliable  # noqa: F401

# レビュー評価の警戒ライン（楽天の平均的な水準を踏まえた保守的な閾値）
LOW_REVIEW_SCORE = 3.5
# スコア判定に必要な最低レビュー件数（少数の低評価で誤判定しないため）
MIN_REVIEWS_FOR_SCORE = 5
# 店舗平均CVRに対して「明らかに低い」とみなす比率（ActionPanel の既存ルールと統一）
CVR_LOW_RATIO = 0.85
# 店舗平均CVRに対して「明らかに高い＝伸ばす価値あり」とみなす比率
CVR_HIGH_RATIO = 1.15
# 在庫がこの日数分を切ったら「欠品前に発注」を促す（先読み発注アラート）
RESTOCK_ALERT_DAYS = 14


def _name(row) -> str:
    """商品名を表示用に短縮する。楽天の商品名は非常に長いことが多い。"""
    n = (row.product_name or row.management_no or "商品").strip()
    return n if len(n) <= 28 else n[:28] + "…"


def _yen(v: Optional[float]) -> str:
    if v is None:
        return "—"
    return f"¥{int(round(v)):,}"


def _rule_stock_out(row, shop, days_in_month: int) -> Optional[dict]:
    """在庫切れ日数がある＝買える状態になかった日がある。

    買えなければ他の施策は全て無意味なので、既存 ActionPanel と同じく最優先。
    機会損失は「稼働日あたりの売上 × 在庫切れ日数」で概算する。
    """
    zero_days = row.zero_stock_days or 0
    sales = row.sales or 0
    if zero_days <= 0 or sales <= 0:
        return None

    active_days = max(1, days_in_month - zero_days)
    loss = (sales / active_days) * zero_days

    return {
        "key": f"stock_out:{row.management_no}",
        "priority": "critical",
        "metric": "stock",
        "product_name": _name(row),
        "management_no": row.management_no,
        "title": f"「{_name(row)}」の在庫を補充する",
        "reason": (
            f"当月 {zero_days}日 在庫切れでした（売上 {_yen(sales)}）。"
            "在庫が無い日は広告もページ改善も効きません。"
        ),
        "impact": f"機会損失 約{_yen(loss)}",
        "impact_value": loss,
        "effort": "10分",
        "badges": [f"在庫切れ {zero_days}日"],
        "link": "/products",
    }


def _rule_low_stock(row, shop, days_in_month: int) -> Optional[dict]:
    """在庫僅少の先読み発注アラート（欠品「前」）。

    _rule_stock_out が「既に欠品した」事後アラートなのに対し、こちらは
    まだ在庫はあるが販売ペースからすると近く欠品する商品を、欠品する前に拾う。
    欠品してからでは広告費が無駄打ちになり検索順位も落ちるため、先回りが効く。

    残り日数の推定: 在庫数 ÷ 1日あたり販売点数（当月の点数 ÷ 当月日数）。
    需要が無い商品（販売ゼロ）は発注不要なので対象外。既に欠品している商品
    （zero_stock_days>0 または stock_count<=0）は _rule_stock_out に任せる。
    """
    stock = row.stock_count or 0
    zero_days = row.zero_stock_days or 0
    if stock <= 0 or zero_days > 0:
        return None

    # 販売ペース: 点数（sales_qty）優先、無ければ件数（cv）で代替
    qty = (row.sales_qty or 0) or (row.cv or 0)
    if qty <= 0:
        return None
    per_day = qty / max(1, days_in_month)
    if per_day <= 0:
        return None

    # 発注アラート閾値は店舗設定（shop['restock_days']）を優先。未設定は既定14日。
    threshold = (shop or {}).get("restock_days") or RESTOCK_ALERT_DAYS
    days_left = stock / per_day
    if days_left >= threshold:
        return None

    cv = row.cv or 0
    av = (row.sales or 0) / cv if cv > 0 else (row.avg_price or 0)
    # 欠品すると止まる売上規模（当月ペースを月換算）。優先順位付けの金額インパクト。
    value_at_risk = per_day * av * days_in_month
    weekly = per_day * 7 * av
    days_left_i = int(days_left)

    return {
        "key": f"low_stock:{row.management_no}",
        "priority": "recommended",
        "metric": "stock",
        "product_name": _name(row),
        "management_no": row.management_no,
        "title": f"「{_name(row)}」を発注する（在庫僅少）",
        "reason": (
            f"在庫 {stock:,}点、直近の販売ペースだと約{days_left_i}日で欠品します。"
            "欠品すると広告費が無駄打ちになり検索順位も落ちるため、今のうちに発注してください。"
        ),
        "impact": f"欠品すると週あたり約{_yen(weekly)}の売上が止まります",
        "impact_value": value_at_risk,
        "effort": "10分",
        "badges": [f"残り約{days_left_i}日", f"在庫{stock:,}点"],
        "link": "/products",
    }


def _rule_low_cvr(row, shop, days_in_month: int) -> Optional[dict]:
    """アクセスはあるのに売れていない商品＝商品ページ側に原因がある。

    「どの商品のページを直すか」を特定する中核ルール。
    改善インパクトは「店舗平均CVRまで戻した場合の増加売上」で見積もる。
    """
    access = row.access_uu or 0
    if not is_reliable(access):
        return None
    shop_cvr = (shop or {}).get("cvr") or 0
    cvr = row.cvr or 0
    if shop_cvr <= 0 or cvr <= 0 or cvr >= shop_cvr * CVR_LOW_RATIO:
        return None

    cv = row.cv or 0
    av = (row.sales or 0) / cv if cv > 0 else (row.avg_price or 0)
    # 店舗平均CVRまで回復した場合の増分（客単価は現状維持と仮定）
    gain = (shop_cvr - cvr) / 100 * access * av
    if gain <= 0:
        return None

    return {
        "key": f"cvr_page:{row.management_no}",
        "priority": "recommended",
        "metric": "cvr",
        "product_name": _name(row),
        "management_no": row.management_no,
        "title": f"「{_name(row)}」の商品ページを見直す",
        "reason": (
            f"アクセス {access:,}人に対しCVR {cvr}%（店舗平均 {shop_cvr}%）。"
            "見られているのに買われていません。価格・送料表記・商品説明・画像の順に確認してください。"
        ),
        "impact": f"店舗平均まで戻せば +{_yen(gain)}",
        "impact_value": gain,
        "effort": "30分",
        "badges": [f"CVR {cvr}% / 平均 {shop_cvr}%"],
        "link": "/products",
    }


def _rule_no_review(row, shop, days_in_month: int) -> Optional[dict]:
    """アクセスがあるのにレビューが無い商品。レビューはCVRの主要因。"""
    access = row.access_uu or 0
    if not is_reliable(access) or (row.review_count or 0) > 0:
        return None
    sales = row.sales or 0
    if sales <= 0:
        return None
    return {
        "key": f"review_zero:{row.management_no}",
        "priority": "recommended",
        "metric": "review",
        "product_name": _name(row),
        "management_no": row.management_no,
        "title": f"「{_name(row)}」のレビューを集める",
        "reason": (
            f"アクセス {access:,}人・売上 {_yen(sales)} に対しレビュー0件です。"
            "レビューが無い商品は初回購入のハードルが高く、CVRが伸びません。"
        ),
        "impact": "購入者へのレビュー依頼が最短です",
        # レビュー施策は効果が読みにくいため、売上規模で優先度をつける
        "impact_value": sales * 0.05,
        "effort": "15分",
        "badges": ["レビュー0件"],
        "link": "/products",
    }


def _rule_low_review_score(row, shop, days_in_month: int) -> Optional[dict]:
    """低評価レビューが付いている商品。放置するとCVRが下がり続ける。"""
    score = row.review_score or 0
    count = row.review_count or 0
    if count < MIN_REVIEWS_FOR_SCORE or score <= 0 or score >= LOW_REVIEW_SCORE:
        return None
    sales = row.sales or 0
    return {
        "key": f"review_low:{row.management_no}",
        "priority": "recommended",
        "metric": "review",
        "product_name": _name(row),
        "management_no": row.management_no,
        "title": f"「{_name(row)}」の低評価レビューに返信する",
        "reason": (
            f"レビュー評価 {score}（{count}件）。{LOW_REVIEW_SCORE}未満は購入の障壁になります。"
            "内容を確認し、返信と商品説明の修正で誤解由来の低評価を減らせます。"
        ),
        "impact": "CVR改善に直結します",
        "impact_value": sales * 0.08,
        "effort": "30分",
        "badges": [f"評価 {score}"],
        "link": "/products",
    }


def _rule_high_potential(row, shop, days_in_month: int) -> Optional[dict]:
    """CVRは高いのにアクセスが少ない商品＝広告を寄せれば伸びる。

    「弱点を直す」だけでなく「勝ち筋を伸ばす」提案も出す。
    """
    access = row.access_uu or 0
    shop_cvr = (shop or {}).get("cvr") or 0
    cvr = row.cvr or 0
    if shop_cvr <= 0 or cvr <= 0:
        return None
    # 母数が極端に小さい商品はCVRが偶然高く出るため除外する
    if not is_reliable(access):
        return None
    if cvr < shop_cvr * CVR_HIGH_RATIO:
        return None
    shop_access = (shop or {}).get("access") or 0
    # 店舗全体から見てアクセスが小さい商品に限る（既に主力のものは対象外）
    if shop_access <= 0 or access > shop_access * 0.10:
        return None

    cv = row.cv or 0
    av = (row.sales or 0) / cv if cv > 0 else (row.avg_price or 0)
    # アクセスが1.5倍になった場合の増分（CVR・客単価は現状維持と仮定）
    gain = access * 0.5 * (cvr / 100) * av
    if gain <= 0:
        return None

    return {
        "key": f"boost:{row.management_no}",
        "priority": "check",
        "metric": "access",
        "product_name": _name(row),
        "management_no": row.management_no,
        "title": f"「{_name(row)}」に広告を寄せる",
        "reason": (
            f"CVR {cvr}%（店舗平均 {shop_cvr}%）と高いのに、アクセスは {access:,}人にとどまっています。"
            "売れる状態は既にできているので、露出を増やすだけで伸びる可能性が高い商品です。"
        ),
        "impact": f"アクセス1.5倍で +{_yen(gain)}",
        "impact_value": gain,
        "effort": "10分",
        "badges": [f"CVR {cvr}%"],
        "link": "/rpp",
    }


def _rule_low_sample_hold(row, shop, days_in_month: int) -> Optional[dict]:
    """低母数（reliable=false）商品の「判定保留・データ蓄積待ち」（要件No.10 / No.6）。

    他ルールは母数不足の商品を is_reliable ゲートで除外する＝何も提案が出ない。
    それだと「なぜこの商品には何も出ないのか」が分からず、誤って現状のCVR・客単価で
    判断してしまう。そこで「まだ判断しない・アクセスを積む」ことを明示アクションとして出す。
    データが全く無い商品（アクセス0）には出さない（多少のアクセスがある低母数のみ）。
    """
    access = row.access_uu or 0
    if access <= 0 or is_reliable(access):
        return None
    sales = row.sales or 0
    return {
        "key": f"low_sample_hold:{row.management_no}",
        "priority": "check",
        "metric": "access",
        "product_name": _name(row),
        "management_no": row.management_no,
        "title": f"「{_name(row)}」は判定保留（データ蓄積待ち）",
        "reason": (
            f"アクセス {access:,}人で母数が{MIN_ACCESS_SAMPLE}未満です。この人数ではCVR・客単価が"
            "統計的に信用できません。今の数値で価格やページを判断せず、まずアクセスを積んで"
            "母数を確保してから見直してください。"
        ),
        "impact": "誤った判断を避けるための保留です",
        # 並び順のためだけの極小値（保留は最下位に置く）
        "impact_value": sales * 0.001,
        "effort": "—",
        "badges": [f"母数 {access:,}（<{MIN_ACCESS_SAMPLE}）", "参考値"],
        "link": "/products",
    }


_PRODUCT_RULES = [
    _rule_stock_out,
    _rule_low_stock,
    _rule_low_cvr,
    _rule_no_review,
    _rule_low_review_score,
    _rule_high_potential,
    _rule_low_sample_hold,
]

_PRIORITY_ORDER = {"critical": 0, "recommended": 1, "check": 2}


def build_product_recommendations(
    items,
    shop: Optional[dict] = None,
    days_in_month: int = 30,
    done_keys: Optional[set] = None,
    limit: int = 3,
    restock_days: int = RESTOCK_ALERT_DAYS,
) -> list:
    """商品別の推奨アクションを金額インパクト順に返す。

    同一商品から複数の課題が出た場合は、最もインパクトの大きい1件に絞る。
    1商品について複数の指示を同時に出すと、結局どれも実行されないため。

    restock_days は在庫僅少の発注アラート閾値（店舗設定由来）。
    """
    done = done_keys or set()
    by_product: dict = {}
    # 各ルールが参照できるよう、閾値を shop dict に載せる（shop=None でも渡せるように）
    shop = dict(shop) if shop else {}
    shop.setdefault("restock_days", restock_days)

    for row in items or []:
        for rule in _PRODUCT_RULES:
            try:
                item = rule(row, shop, days_in_month)
            except Exception:
                # 1商品・1ルールの失敗で全体を止めない
                continue
            if not item or item["key"] in done:
                continue
            key = item.get("management_no") or item["key"]
            cur = by_product.get(key)
            # 同一商品内では「優先度が高い」→「インパクトが大きい」順で1件だけ残す
            if cur is None or (
                _PRIORITY_ORDER.get(item["priority"], 9),
                -item.get("impact_value", 0),
            ) < (
                _PRIORITY_ORDER.get(cur["priority"], 9),
                -cur.get("impact_value", 0),
            ):
                by_product[key] = item

    result = list(by_product.values())
    result.sort(
        key=lambda x: (
            _PRIORITY_ORDER.get(x["priority"], 9),
            -x.get("impact_value", 0),
        )
    )
    return result[:limit] if limit and limit > 0 else result


# ── アクション種別のラベル（action_key の接頭辞 → 表示名）─────────────────────
ACTION_LABELS = {
    "stock_out": "在庫切れ（欠品）",
    "low_stock": "在庫僅少（先読み発注）",
    "cvr_page": "商品ページ改善（CVR低下）",
    "review_zero": "レビュー獲得（レビュー0件）",
    "review_low": "低評価レビュー対応",
    "boost": "広告強化（伸び代あり）",
    "low_sample_hold": "判定保留（データ蓄積待ち）",
    "cost_review": "原価・価格見直し",
}


def build_cost_review_actions(
    rpp_products,
    individual_cost_mnos,
    done_keys: Optional[set] = None,
    limit: int = 0,
) -> list:
    """原価見直しアクション（要件No.10 / 4P: Price）。

    「個別原価率が設定されている」かつ「限界CPO超過（cpo > limit_cpo）」の商品に対し、
    原価・価格・入札のいずれかで採算ラインへ戻すよう促す。データ源は RPP（限界CPOはRPP由来）。

    rpp_products: [{management_no, product_name, cpo, limit_cpo, cv}, ...]（当月のRPP集計）。
    individual_cost_mnos: 個別原価率(ProductCost)が設定済みの management_no 集合。
    既存に price_review 系アクションは無いため重複しない。
    """
    done = done_keys or set()
    out: list = []
    for p in rpp_products or []:
        mno = p.get("management_no")
        if not mno or mno not in individual_cost_mnos:
            continue
        cpo = p.get("cpo") or 0
        limit_cpo = p.get("limit_cpo") or 0
        if limit_cpo <= 0 or cpo <= limit_cpo:
            continue
        key = f"cost_review:{mno}"
        if key in done:
            continue
        over = cpo - limit_cpo
        cv = p.get("cv") or 0
        name = p.get("product_name") or mno
        out.append({
            "key": key,
            "priority": "recommended",
            "metric": "price",
            "product_name": name,
            "management_no": mno,
            "title": f"「{name}」の原価・価格を見直す",
            "reason": (
                f"個別原価率を設定済みですが、CPO {_yen(cpo)} が限界CPO {_yen(limit_cpo)} を超過しています。"
                "この広告効率では1件売るごとに粗利が削られます。原価の再交渉・値上げ・"
                "広告入札の見直しのいずれかで採算ラインへ戻してください。"
            ),
            "impact": f"超過分 約{_yen(over)}/件",
            "impact_value": over * cv,
            "effort": "30分",
            "badges": [f"CPO {_yen(cpo)} / 限界 {_yen(limit_cpo)}"],
            "link": "/products",
        })
    out.sort(key=lambda x: -x.get("impact_value", 0))
    return out[:limit] if limit and limit > 0 else out


def merge_and_limit(*action_lists, limit: int = 3) -> list:
    """複数のアクションリストを商品単位でまとめ、優先度→金額インパクト順で limit 件返す。

    1商品から複数系統（例: 商品ルール由来の cvr_page と RPP由来の cost_review）が
    出た場合は、最も優先すべき1件に絞る（1商品1指示の原則を保つ）。
    """
    by_product: dict = {}
    for lst in action_lists:
        for item in lst or []:
            key = item.get("management_no") or item["key"]
            cur = by_product.get(key)
            if cur is None or (
                _PRIORITY_ORDER.get(item["priority"], 9), -item.get("impact_value", 0),
            ) < (
                _PRIORITY_ORDER.get(cur["priority"], 9), -cur.get("impact_value", 0),
            ):
                by_product[key] = item
    result = list(by_product.values())
    result.sort(key=lambda x: (_PRIORITY_ORDER.get(x["priority"], 9), -x.get("impact_value", 0)))
    return result[:limit] if limit and limit > 0 else result


def summarize_actions(
    items,
    shop: Optional[dict] = None,
    days_in_month: int = 30,
    restock_days: int = RESTOCK_ALERT_DAYS,
    extra_actions: Optional[list] = None,
) -> list:
    """スコープ（店舗全体 or 特定ジャンル）内の全商品に課題検出ルールを走らせ、
    action_key（種別）別に該当商品数・影響額を集計してランキングで返す（要件No.3）。

    build_product_recommendations が「1商品1アクション」に絞るのに対し、こちらは
    「どの課題がどれだけ広がっているか」を見るため、全ルール・全該当を種別で束ねる。
    extra_actions には RPP由来の cost_review など、商品ルール外のアクションを渡せる。
    戻り値: [{action_key, label, metric, priority, affected_count, impact_estimate, sample_products}]
    """
    shop = dict(shop) if shop else {}
    shop.setdefault("restock_days", restock_days)
    agg: dict = {}

    def _add(item: dict):
        atype = item["key"].split(":")[0]
        g = agg.setdefault(atype, {
            "action_key": atype,
            "label": ACTION_LABELS.get(atype, atype),
            "metric": item.get("metric"),
            "priority": item.get("priority", "recommended"),
            "affected": [],
            "impact_estimate": 0.0,
        })
        g["affected"].append({
            "management_no": item.get("management_no"),
            "product_name": item.get("product_name"),
            "impact_value": item.get("impact_value", 0) or 0,
        })
        g["impact_estimate"] += item.get("impact_value", 0) or 0

    for row in items or []:
        for rule in _PRODUCT_RULES:
            try:
                it = rule(row, shop, days_in_month)
            except Exception:
                continue
            if it:
                _add(it)
    for it in extra_actions or []:
        _add(it)

    result = []
    for atype, g in agg.items():
        affected = sorted(g["affected"], key=lambda x: -(x["impact_value"] or 0))
        result.append({
            "action_key": atype,
            "label": g["label"],
            "metric": g["metric"],
            "priority": g["priority"],
            "affected_count": len(affected),
            "impact_estimate": round(g["impact_estimate"], 0),
            "sample_products": [
                {"management_no": a["management_no"], "product_name": a["product_name"]}
                for a in affected[:3]
            ],
        })
    result.sort(key=lambda x: (_PRIORITY_ORDER.get(x["priority"], 9), -x["impact_estimate"]))
    return result
