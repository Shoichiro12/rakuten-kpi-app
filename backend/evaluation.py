# -*- coding: utf-8 -*-
"""KPI評価の統一判定ロジック（NATIONS フレームワーク準拠）。

要件レポート No.2「目標値とYoYを両方使う統一ロジック」と
No.1「17パターン評価マトリクス」の中核モジュール。

判定原則:
  - 「上がった/下がった」は目標達成率とYoYの両方を参照する
  - 目標が設定されていれば目標比を主軸、YoYを補助軸とする
  - 目標が無ければYoYのみで判定する
  - どちらも無ければ「判定不可」として扱う（勝手に○×を付けない）
"""

from typing import Optional

# NATIONS講座ルール: アクセス母数がこの値未満の商品・ジャンル・期間は
# CVR・客単価が統計的に信用できないため評価対象から除外する（要件No.6）。
# ActionPanel（商品レベル）と同一の閾値。全画面で共通利用する。
MIN_ACCESS_SAMPLE = 100


def judge_metric(
    key: str,
    label: str,
    actual: float,
    target: Optional[float],
    prev_year: Optional[float],
) -> dict:
    """単一KPIを目標比×YoYで判定する統一関数。

    Returns:
        key / label / actual
        target, achieve_rate     : 目標と達成率(%)。目標未設定は None
        prev_year, yoy_rate      : 前年同期実績とYoY(%)。前年データ無しは None
        target_ok, yoy_ok        : それぞれ 100% 以上か（判定不能は None）
        achieved                 : 統一判定の結果（True=達成 / False=未達 / None=判定不可）
        basis                    : 判定根拠 'target' | 'yoy' | None
    """
    achieve_rate = None
    if target is not None and target > 0:
        achieve_rate = round(actual / target * 100, 1)

    yoy_rate = None
    if prev_year is not None and prev_year > 0:
        yoy_rate = round(actual / prev_year * 100, 1)

    target_ok = (achieve_rate >= 100) if achieve_rate is not None else None
    yoy_ok = (yoy_rate >= 100) if yoy_rate is not None else None

    if target_ok is not None:
        achieved, basis = target_ok, "target"
    elif yoy_ok is not None:
        achieved, basis = yoy_ok, "yoy"
    else:
        achieved, basis = None, None

    return {
        "key": key,
        "label": label,
        "actual": actual,
        "target": target,
        "achieve_rate": achieve_rate,
        "prev_year": prev_year,
        "yoy_rate": yoy_rate,
        "target_ok": target_ok,
        "yoy_ok": yoy_ok,
        "achieved": achieved,
        "basis": basis,
    }


# ---------------------------------------------------------------------------
# 17パターン評価マトリクス
# ---------------------------------------------------------------------------
# 売上（達成/未達）× アクセス × CVR × 客単価（各 達成/未達）= 16パターン
# ＋ 判定不可（目標未設定・データ不足）= 17パターン目
#
# 評価ランク:
#   ◎ … 売上達成・全KPI達成（現状維持＋横展開）
#   ○ … 売上達成だが一部KPIに課題（今のうちに補強）
#   △ … 売上未達だが達成KPIあり（未達KPIに集中投下）
#   × … 売上未達・全KPI未達（構造的な立て直しが必要）
#   − … 判定不可
#
# 対策優先度: × = 高 / △ = 高 / ○ = 中 / ◎ = 維持

KPI_PRIORITY = ["access", "cvr", "av"]  # 深掘り優先順（アクセス > CVR > 客単価）

KPI_LABELS = {"access": "アクセス", "cvr": "転換率（CVR）", "av": "客単価"}


def _pattern_no(sales_ok: bool, access_ok: bool, cvr_ok: bool, av_ok: bool) -> int:
    """16パターンの通し番号（1〜16）。売上達成群が1〜8、未達群が9〜16。

    各群内は アクセス/CVR/客単価 の達成ビット（達成=0, 未達=1）を
    2進数として並べた順。例: 全達成 = No.1、全未達 = No.16。
    """
    bits = (0 if access_ok else 4) + (0 if cvr_ok else 2) + (0 if av_ok else 1)
    return (1 if sales_ok else 9) + bits


def evaluate_matrix(
    sales: dict,
    access: dict,
    cvr: dict,
    av: dict,
    low_sample: bool = False,
) -> dict:
    """judge_metric の結果4つから評価マトリクスを構築する。

    Args:
        low_sample : アクセス母数が MIN_ACCESS_SAMPLE 未満の場合 True（要件No.6）。
                     CVR・客単価を評価対象外（excluded）とし、アクセス対策に
                     フォーカスを固定する。

    Returns:
        pattern_no : 1〜16（判定可能時）/ 17（判定不可）
        rank       : '◎' | '○' | '△' | '×' | '−'
        priority   : '維持' | '中' | '高' | '−'
        focus      : 深掘りすべきKPIキーのリスト（優先順）
        comment    : 状況の言語化（1〜2文）
        metrics    : 各KPIの判定詳細
        undetermined : 判定不可だったKPIキー（目標もYoYも無い）
        low_sample / min_access : 母数不足フラグと閾値
    """
    metrics = {"sales": sales, "access": access, "cvr": cvr, "av": av}

    # 100UUルール（要件No.6）: 母数不足時はCVR・客単価を評価対象外にする。
    # 「未達」と断定せず excluded として明示し、判定はアクセス軸に集中させる。
    if low_sample:
        for m in (cvr, av):
            m["achieved"] = None
            m["basis"] = None
            m["excluded"] = True

    undetermined = [
        k for k, m in metrics.items()
        if m["achieved"] is None and not m.get("excluded")
    ]

    # 売上が判定不可なら評価そのものが成立しない → パターン17
    if sales["achieved"] is None:
        return {
            "pattern_no": 17,
            "rank": "−",
            "priority": "−",
            "focus": [],
            "comment": "目標が未設定、または前年データが無いため評価できません。目標設定画面でKGI/KPI目標を登録してください。",
            "metrics": metrics,
            "undetermined": undetermined,
            "low_sample": low_sample,
            "min_access": MIN_ACCESS_SAMPLE,
        }

    # 母数不足時はアクセスのみで簡易評価（売上×アクセスの2軸）
    if low_sample:
        sales_ok = sales["achieved"]
        access_ok = access["achieved"] is True
        pattern_no = _pattern_no(sales_ok, access_ok, False, False)
        if sales_ok:
            rank, priority = "○", "中"
        else:
            rank, priority = "△", "高"
        comment = (
            f"アクセス母数が{MIN_ACCESS_SAMPLE}未満のため、CVR・客単価は評価していません"
            "（統計的に信用できないため）。まずアクセス対策で母数を確保しましょう。"
        )
        return {
            "pattern_no": pattern_no,
            "rank": rank,
            "priority": priority,
            "focus": ["access"],
            "comment": comment,
            "metrics": metrics,
            "undetermined": undetermined,
            "low_sample": True,
            "min_access": MIN_ACCESS_SAMPLE,
        }

    sales_ok = sales["achieved"]
    # KPI側の判定不可は「未達扱い」でパターン算出するが、undetermined として明示する
    access_ok = access["achieved"] is True
    cvr_ok = cvr["achieved"] is True
    av_ok = av["achieved"] is True

    pattern_no = _pattern_no(sales_ok, access_ok, cvr_ok, av_ok)

    kpi_ok = {"access": access_ok, "cvr": cvr_ok, "av": av_ok}
    failed = [k for k in KPI_PRIORITY if not kpi_ok[k]]
    all_ok = len(failed) == 0
    none_ok = len(failed) == 3

    if sales_ok and all_ok:
        rank, priority = "◎", "維持"
        comment = "売上・全KPIとも達成。現状の施策を維持しつつ、成功要因を他ジャンル・他商品へ横展開しましょう。"
        focus = []
    elif sales_ok:
        rank, priority = "○", "中"
        labels = "・".join(KPI_LABELS[k] for k in failed)
        comment = f"売上は達成していますが、{labels}が未達です。売上が崩れる前に該当KPIを補強しましょう。"
        focus = failed
    elif not none_ok:
        rank, priority = "△", "高"
        labels = "・".join(KPI_LABELS[k] for k in failed)
        comment = f"売上未達。{labels}がボトルネックです。達成できているKPIは維持し、未達KPIへ対策を集中してください。"
        focus = failed
    else:
        rank, priority = "×", "高"
        comment = "売上・全KPIとも未達です。アクセス→CVR→客単価の順に構造から立て直してください。"
        focus = list(KPI_PRIORITY)

    return {
        "pattern_no": pattern_no,
        "rank": rank,
        "priority": priority,
        "focus": focus,
        "comment": comment,
        "metrics": metrics,
        "undetermined": undetermined,
        "low_sample": False,
        "min_access": MIN_ACCESS_SAMPLE,
    }
