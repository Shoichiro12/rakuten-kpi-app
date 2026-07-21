# -*- coding: utf-8 -*-
"""「今日やるべきこと」提案の生成ロジック（Phase 1）。

docs/VISION.md の中核。このプロダクトは分析ツールではなく意思決定OSであり、
最終出力は数値ではなく **次のアクション** である。このモジュールはその変換層。

設計原則:
  1. 新規のAI推論に依存しない。既存の判定資産（evaluation.evaluate_matrix の focus、
     アクセス逆算プラン、ダッシュボードのアラート閾値）から機械的に導出する。
  2. 提案には必ず「根拠の数値」を添える。理由なき指示は店舗の判断力を育てない。
  3. 件数を絞る。10件出すと結局どれも実行されない。既定は上位3件。
  4. データ欠損を理由に沈黙しない。取込み不足そのものをアクションとして提示する。

KPIの計算式は calculations.py が唯一の真実。ここでは計算せず、判定と言語化だけ行う。
"""

from typing import Optional

# 優先度。表示順とバッジ色の両方を決める。
PRIORITY_CRITICAL = "critical"      # 最優先
PRIORITY_RECOMMENDED = "recommended"  # 推奨
PRIORITY_CHECK = "check"            # 確認

_PRIORITY_ORDER = {
    PRIORITY_CRITICAL: 0,
    PRIORITY_RECOMMENDED: 1,
    PRIORITY_CHECK: 2,
}

# 既定の提示件数。多すぎる提案は実行されないため意図的に絞る。
DEFAULT_LIMIT = 3

# CTRの優秀ライン（テンプレ_AD準拠。1%未満はダッシュボードのアラート閾値と同一）
CTR_GOOD_LINE = 1.0


def _yen(v: Optional[float]) -> str:
    if v is None:
        return "—"
    return f"¥{int(round(v)):,}"


def _num(v: Optional[float]) -> str:
    if v is None:
        return "—"
    return f"{int(round(v)):,}"


def _rule_no_target(evaluation: Optional[dict]) -> Optional[dict]:
    """目標未設定（評価パターン17）は、まず目標を決めることが最優先アクション。"""
    if not evaluation or evaluation.get("pattern_no") != 17:
        return None
    return {
        "key": "set_target",
        "priority": PRIORITY_CRITICAL,
        "metric": "target",
        "title": "売上目標とKPI目標を設定する",
        "reason": (
            "目標が未設定のため、達成/未達の判定ができません。"
            "何を改善すべきかを機械的に導くには、まず基準が必要です。"
        ),
        "impact": "以降すべての提案の精度が上がります",
        "effort": "5分",
        "badges": [],
        "link": "/targets",
    }


def _rule_import_rpp(kpis: Optional[dict], shop: Optional[dict]) -> Optional[dict]:
    """店舗全体の実績はあるがRPPが未取込 → 広告面が丸ごと盲点になっている。"""
    if kpis is not None or not shop:
        return None
    return {
        "key": "import_rpp",
        "priority": PRIORITY_CHECK,
        "metric": "data",
        "title": "RPP広告データを取り込む",
        "reason": (
            f"店舗全体の売上 {_yen(shop.get('sales'))} は取り込めていますが、"
            "RPP広告データが未取込のため、広告の効率（ROI・ROAS・CPC・CTR）が判定できません。"
        ),
        "impact": "広告の無駄打ちを特定できるようになります",
        "effort": "10分",
        "badges": [],
        "link": "/import",
    }


def _rule_access_budget(evaluation: Optional[dict], plan: Optional[dict]) -> Optional[dict]:
    """アクセスがボトルネックで、逆算プランに不足分がある → 最速レバーは広告予算。

    CVR・客単価が達成できている状態でアクセスだけ足りないケースは、
    打ち手が一意に定まる（＝最も確信度が高い提案）ため最優先で出す。
    """
    if not evaluation or not plan or not plan.get("shortfall_ct"):
        return None
    if "access" not in (evaluation.get("focus") or []):
        return None

    shortfall = plan.get("shortfall_ct") or 0
    if shortfall <= 0:
        return None

    metrics = evaluation.get("metrics") or {}
    access = metrics.get("access") or {}
    cvr = metrics.get("cvr") or {}
    av = metrics.get("av") or {}

    # CVR・客単価が達成済みなら「不足はアクセスだけ」と言い切れる
    others_ok = (cvr.get("achieved") is True) and (av.get("achieved") is True)
    reason = (
        f"アクセスが目標比 {access.get('achieve_rate', '—')}%"
        f"（{_num(access.get('actual'))} / {_num(access.get('target'))}）。"
    )
    if others_ok:
        reason += (
            f"CVR {cvr.get('actual')}%・客単価 {_yen(av.get('actual'))} は達成済みなので、"
            "不足しているのはアクセスだけです。"
        )
    else:
        reason += "売上目標に対してアクセスの母数が足りていません。"

    badges = []
    add_cost = plan.get("est_additional_ad_cost")
    if add_cost:
        badges.append(f"追加費 約{_yen(add_cost)}")
    badges.append(f"不足 {_num(shortfall)}CT")

    gap = (plan.get("target_sales") or 0) - (plan.get("actual_gross") or 0)
    return {
        "key": "access_budget",
        "priority": PRIORITY_CRITICAL,
        "metric": "access",
        "title": "広告予算を上げてアクセスを積む",
        "reason": reason,
        "impact": f"想定効果 {_yen(gap)}" if gap > 0 else None,
        "effort": "5分",
        "badges": badges,
        "link": None,
    }


def _rule_ctr_low(kpis: Optional[dict]) -> Optional[dict]:
    """CTRが優秀ライン未満 → 表示されているのにクリックされていない＝画像・商品名の問題。"""
    if not kpis:
        return None
    ctr = kpis.get("ctr")
    if ctr is None or ctr >= CTR_GOOD_LINE:
        return None

    ct = kpis.get("ct") or 0
    # 想定効果は「CTRが倍になった場合」で示す。優秀ライン(1%)まで一気に戻る前提で
    # 逆算すると、CTRが極端に低い店舗では非現実的な数字（数倍のクリック増）が出てしまい、
    # 提案の信頼性を損なう。1施策で見込める範囲に寄せた保守的な基準を使う。
    gain_ct = ct  # 表示回数が同じならCTR2倍＝クリック2倍＝現在値ぶんの増加

    return {
        "key": "ctr_creative",
        "priority": PRIORITY_RECOMMENDED,
        "metric": "ctr",
        "title": "商品画像と商品名を見直す",
        "reason": (
            f"CTR {ctr}%（優秀ライン {CTR_GOOD_LINE:.0f}〜2%）。"
            "広告は表示されているのにクリックされていません。1枚目画像と商品名が最有力の原因です。"
        ),
        "impact": f"CTRが倍になれば +{_num(gain_ct)}CT" if gain_ct > 0 else None,
        "effort": "30分",
        "badges": [],
        "link": "/products",
    }


def _rule_roi_low(kpis: Optional[dict]) -> Optional[dict]:
    """ROI100%未満＝広告費が粗利を超過。放置すると売るほど赤字になる。"""
    if not kpis:
        return None
    roi = kpis.get("roi")
    if roi is None or roi >= 100:
        return None
    return {
        "key": "roi_negative",
        "priority": PRIORITY_CRITICAL,
        "metric": "roi",
        "title": "赤字商品の広告を止めるか入札を下げる",
        "reason": (
            f"ROI {roi}%（100%未満）。広告費 {_yen(kpis.get('ad_cost'))} が"
            f"売上総利益 {_yen(kpis.get('gp'))} を超えており、売るほど損が出ている状態です。"
        ),
        "impact": "赤字の止血が最優先です",
        "effort": "15分",
        "badges": [],
        "link": "/rpp",
    }


def _rule_cpc_rising(kpis: Optional[dict], changes: Optional[dict]) -> Optional[dict]:
    """CPCが前期比で上昇＝入札が競り上がっている。同じ予算で取れるアクセスが減る。"""
    if not kpis or not changes:
        return None
    cpc_wow = changes.get("cpc_wow")
    if cpc_wow is None or cpc_wow <= 5:
        return None
    return {
        "key": "cpc_rising",
        "priority": PRIORITY_CHECK,
        "metric": "cpc",
        "title": "入札単価を見直す",
        "reason": (
            f"CPCが前期比 +{round(cpc_wow, 1)}%（現在 {_yen(kpis.get('cpc'))}）。"
            "競合の入札が上がっている可能性があります。同じ予算で取れるアクセスが減ります。"
        ),
        "impact": None,
        "effort": "15分",
        "badges": [],
        "link": "/rpp",
    }


def _rule_cvr_yoy_down(evaluation: Optional[dict]) -> Optional[dict]:
    """目標比は達成でもYoYが前年割れ → 単一指標では見落とすシグナル。"""
    if not evaluation:
        return None
    cvr = (evaluation.get("metrics") or {}).get("cvr") or {}
    if cvr.get("excluded"):
        return None
    yoy = cvr.get("yoy_rate")
    if yoy is None or yoy >= 100:
        return None
    # 目標も未達なら後段の _rule_cvr_low が扱うので、ここは「目標は達成しているのに前年割れ」限定
    if cvr.get("achieved") is not True:
        return None
    return {
        "key": "cvr_yoy_down",
        "priority": PRIORITY_CHECK,
        "metric": "cvr",
        "title": "CVRが前年を下回った原因を確認する",
        "reason": (
            f"CVR YoY {yoy}%（現在 {cvr.get('actual')}%）。"
            "目標比では達成していますが前年から落ちています。"
            "レビュー・価格・在庫表示のいずれかが疑わしいです。"
        ),
        "impact": None,
        "effort": "15分",
        "badges": [],
        "link": None,
    }


def _rule_cvr_low(evaluation: Optional[dict]) -> Optional[dict]:
    """CVRが目標未達（＝focusに入っている）→ 商品ページ側の改善。"""
    if not evaluation or "cvr" not in (evaluation.get("focus") or []):
        return None
    cvr = (evaluation.get("metrics") or {}).get("cvr") or {}
    if cvr.get("excluded"):
        return None
    return {
        "key": "cvr_page",
        "priority": PRIORITY_RECOMMENDED,
        "metric": "cvr",
        "title": "商品ページとレビューを改善する",
        "reason": (
            f"CVRが目標比 {cvr.get('achieve_rate', '—')}%（現在 {cvr.get('actual')}%）。"
            "アクセスは来ているのに買われていません。"
            "レビュー返信・商品説明・送料表記を確認してください。"
        ),
        "impact": None,
        "effort": "30分",
        "badges": [],
        "link": "/products",
    }


def _rule_av_low(evaluation: Optional[dict]) -> Optional[dict]:
    """客単価が目標未達 → セット販売・同梱提案・送料無料ラインの設計。"""
    if not evaluation or "av" not in (evaluation.get("focus") or []):
        return None
    av = (evaluation.get("metrics") or {}).get("av") or {}
    if av.get("excluded"):
        return None
    return {
        "key": "av_bundle",
        "priority": PRIORITY_RECOMMENDED,
        "metric": "av",
        "title": "セット販売と送料無料ラインを見直す",
        "reason": (
            f"客単価が目標比 {av.get('achieve_rate', '—')}%（現在 {_yen(av.get('actual'))}）。"
            "1注文あたりの単価を上げると、アクセスを増やさずに売上を伸ばせます。"
        ),
        "impact": None,
        "effort": "30分",
        "badges": [],
        "link": "/products",
    }


# 適用する順序。同一優先度内ではこの順で並ぶ。
_RULES = [
    ("set_target", lambda ctx: _rule_no_target(ctx["evaluation"])),
    ("roi_negative", lambda ctx: _rule_roi_low(ctx["kpis"])),
    ("access_budget", lambda ctx: _rule_access_budget(ctx["evaluation"], ctx["plan"])),
    ("ctr_creative", lambda ctx: _rule_ctr_low(ctx["kpis"])),
    ("cvr_page", lambda ctx: _rule_cvr_low(ctx["evaluation"])),
    ("av_bundle", lambda ctx: _rule_av_low(ctx["evaluation"])),
    ("cvr_yoy_down", lambda ctx: _rule_cvr_yoy_down(ctx["evaluation"])),
    ("cpc_rising", lambda ctx: _rule_cpc_rising(ctx["kpis"], ctx["changes"])),
    ("import_rpp", lambda ctx: _rule_import_rpp(ctx["kpis"], ctx["shop"])),
]


def build_recommendations(
    evaluation: Optional[dict] = None,
    plan: Optional[dict] = None,
    kpis: Optional[dict] = None,
    shop: Optional[dict] = None,
    changes: Optional[dict] = None,
    done_keys: Optional[set] = None,
    limit: int = DEFAULT_LIMIT,
    weights: Optional[dict] = None,
) -> list:
    """各シグナルから提案を生成し、優先度順に上位 limit 件を返す。

    Args:
        evaluation : evaluation.evaluate_matrix() の結果
        plan       : アクセス逆算プラン（/api/evaluation/access-plan の plan）
        kpis       : calculations.calc_kpis() の結果（RPP未取込なら None）
        shop       : shop_metrics.get_shop_monthly() の結果
        changes    : ダッシュボードの前期比・YoY 変化率
        done_keys  : 実施済み/スヌーズ済みの action_key。除外する。
        limit      : 返す最大件数

    Returns:
        提案dictのリスト。0件もありうる（＝今やるべき緊急事項が無い健全な状態）。
    """
    ctx = {
        "evaluation": evaluation,
        "plan": plan,
        "kpis": kpis,
        "shop": shop,
        "changes": changes or {},
    }
    done = done_keys or set()

    items = []
    for order, (key, rule) in enumerate(_RULES):
        if key in done:
            continue
        try:
            item = rule(ctx)
        except Exception:
            # 1つのルールの失敗で全体を落とさない（提案は無いより少ない方がまし）
            continue
        if item:
            item["_order"] = order
            items.append(item)

    # 過去の実施結果を順位へ控えめに反映する（Phase 2 の学習ループ）。
    # 優先度の枠は跨がせない。「赤字の止血」より「過去に効いた施策」を
    # 上に出すようなことは起こらないようにする。枠内での微調整に留める。
    w = weights or {}
    items.sort(
        key=lambda x: (
            _PRIORITY_ORDER.get(x["priority"], 9),
            -w.get(x["key"].split(":")[0], 0),
            x["_order"],
        )
    )
    for it in items:
        it.pop("_order", None)
    return items[:limit] if limit and limit > 0 else items
