# -*- coding: utf-8 -*-
"""ゲート判定エンジン（設計ドキュメント2026-08-01 2-A）。

数値のif-then（診断分類・KPI判定）に入る前に必ずくぐらせる「前処理」。
これを飛ばすと、在庫切れ商品に広告改善を提案するような誤った提案をしてしまう。

判定順（設計で固定）:
  0. 在庫ゲート        … 在庫なしなら広告・KW分析の対象から外し、入荷・仕入れを提案
  1. ページ品質ゲート  … ページ未完成なら広告強化を止め、「ページ完成」をToDoとして提案
  2. 外部要因の切り分け … 実装なし（設計どおり。外部要因が疑われても内部要因の改善提案を
                          出し続けるのがデフォルトの挙動＝現状のまま）
  3. 母数ゲート        … アクセス/クリック母数が閾値未満なら判定せずデータ蓄積を優先
  4. 意図確認          … 診断結果は数値どおり出した上で、新商品の異常な高CPC・低ROASには
                          「投資ラインとして許容範囲か」の確認を添える（ブロックしない）

ゲート0・1・3は「引っかかったら診断分類に回さない」ブロック型。
ゲート4は「診断は出すが見せ方を変える」フラグ型（needs_intent_check）。

このモジュールは判定と言語化だけを行い、DBアクセスは呼び出し側（ルーター）が担う。
KPI計算・しきい値定数は calculations.py が単一の真実。
"""
from typing import Optional

from calculations import (
    NEW_PRODUCT_DEFAULT_MONTHS,
    RPP_MIN_CT_FOR_DIAGNOSIS,
    RPP_MIN_CT_NEW_PRODUCT,
    RPP_ROAS_LINE,
)

# ゲート種別（ブロック型）
GATE_STOCK = "stock"
GATE_PAGE_QUALITY = "page_quality"
GATE_SAMPLE_SIZE = "sample_size"

GATE_LABELS = {
    GATE_STOCK: "在庫ゲート（買える状態にない）",
    GATE_PAGE_QUALITY: "ページ品質ゲート（ページ未完成）",
    GATE_SAMPLE_SIZE: "母数ゲート（データ蓄積待ち）",
}

# 商品フェーズ（3-A）
PHASE_NEW = "new"
PHASE_ESTABLISHED = "established"

PHASE_LABELS = {
    PHASE_NEW: "新商品（様子見期間）",
    PHASE_ESTABLISHED: "稼働済み",
}


def _prev_months(ym: str, n: int) -> str:
    """YYYY-MM から n ヶ月前の YYYY-MM を返す。"""
    year, month = int(ym[:4]), int(ym[5:7])
    total = year * 12 + (month - 1) - n
    return f"{total // 12}-{total % 12 + 1:02d}"


def resolve_phase(
    launch_month: Optional[str],
    phase_override: Optional[str],
    current_ym: str,
    default_months: int = NEW_PRODUCT_DEFAULT_MONTHS,
) -> dict:
    """商品フェーズ（新商品/稼働済み）を判定する（3-A）。

    - phase_override があればそれを最優先（担当者による延長・短縮。最終判断は担当者裁量）
    - launch_month が現在から default_months ヶ月以内なら新商品
    - launch_month 不明は稼働済み扱い（保守的に通常基準で診断する）

    Returns:
        {"phase": 'new'|'established', "basis": 'override'|'launch_month'|'unknown',
         "launch_month": ..., "label": 表示用ラベル}
    """
    if phase_override in (PHASE_NEW, PHASE_ESTABLISHED):
        phase, basis = phase_override, "override"
    elif launch_month and len(launch_month) >= 7:
        boundary = _prev_months(current_ym, default_months)
        phase = PHASE_NEW if launch_month[:7] > boundary else PHASE_ESTABLISHED
        basis = "launch_month"
    else:
        phase, basis = PHASE_ESTABLISHED, "unknown"
    return {
        "phase": phase,
        "basis": basis,
        "launch_month": launch_month[:7] if launch_month else None,
        "label": PHASE_LABELS[phase],
    }


def min_ct_for_phase(phase: str) -> int:
    """RPP診断の最低クリック母数。新商品フェーズは50に引き上げる（2-B パターン1'の
    商品粒度への読み替え。オーナー承認済み 2026-08-01）。"""
    return RPP_MIN_CT_NEW_PRODUCT if phase == PHASE_NEW else RPP_MIN_CT_FOR_DIAGNOSIS


def check_gates(
    *,
    has_inventory: Optional[bool] = None,
    stock_count: Optional[int] = None,
    stock_source: Optional[str] = None,
    page_ready: Optional[bool] = None,
    sample: Optional[int] = None,
    sample_threshold: Optional[int] = None,
    sample_label: str = "アクセス",
) -> Optional[dict]:
    """ブロック型ゲート（在庫→ページ品質→母数）を順に判定し、最初に該当した
    ゲートを返す。すべて通過なら None。

    Args:
        has_inventory   : InventoryStatus.has_inventory（手動フラグ）。None=未設定
        stock_count     : 最新月の在庫数（MonthlyItemSales.stock_count）。None=データなし
        stock_source    : 在庫判定の根拠表示（例: "2026-07 商品分析データ" / "手動設定"）
        page_ready      : Product.page_ready。None=未回答はゲートを通す
        sample          : 母数（クリック数 or アクセスUU）。None なら母数ゲートはスキップ
        sample_threshold: 母数の閾値（フェーズ・期間に応じて呼び出し側が決める）
        sample_label    : 母数の表示名（"クリック数" / "アクセスUU" 等）

    Returns:
        {"gate", "label", "proposal": {title, reason, effort}, "context"} | None
    """
    # ── ゲート0: 在庫（最優先。買えない商品にKW戦略を提案しても意味がない）──
    out_of_stock = (has_inventory is False) or (stock_count is not None and stock_count <= 0)
    if out_of_stock:
        basis = "手動設定（在庫なし）" if has_inventory is False else (stock_source or "商品分析データ")
        return {
            "gate": GATE_STOCK,
            "label": GATE_LABELS[GATE_STOCK],
            "proposal": {
                "title": "入荷・仕入れ・予約販売を検討する",
                "reason": (
                    "在庫がなく、買える状態にありません。この状態では広告・キーワードの改善は"
                    "効果がないため、診断対象から外しています。入荷スケジュールの見直し・"
                    "仕入れ調整・予約販売への切り替えを先に検討してください。"
                ),
                "effort": "要調整",
            },
            "context": {"stock_count": stock_count, "basis": basis},
        }

    # ── ゲート1: ページ品質（False のときのみ。null=未回答は通す）──
    if page_ready is False:
        return {
            "gate": GATE_PAGE_QUALITY,
            "label": GATE_LABELS[GATE_PAGE_QUALITY],
            "proposal": {
                "title": "まず商品ページを完成させる",
                "reason": (
                    "商品ページが未完成（LP未反映）として登録されています。ページが受け皿として"
                    "整うまでは広告を強化しても転換につながりにくいため、広告関連の提案を保留し、"
                    "ページ完成を最優先のToDoとして提示しています。完成したら商品マスタで"
                    "「ページ完成」に更新してください。"
                ),
                "effort": "要作業",
            },
            "context": {"page_ready": False},
        }

    # ── ゲート3: 母数（統計的に判断材料として使えるかの前提条件）──
    if sample is not None and sample_threshold is not None and sample < sample_threshold:
        return {
            "gate": GATE_SAMPLE_SIZE,
            "label": GATE_LABELS[GATE_SAMPLE_SIZE],
            "proposal": {
                "title": "まず露出を増やしてデータを貯める",
                "reason": (
                    f"{sample_label}が {sample:,}（基準 {sample_threshold:,} 未満）で、"
                    "CVR等の指標を統計的に判断できる母数に達していません。"
                    "今の数値で良し悪しを判断せず、まず露出とデータ蓄積を優先してください。"
                ),
                "effort": "—",
            },
            "context": {"sample": sample, "threshold": sample_threshold, "sample_label": sample_label},
        }

    return None


def needs_intent_check(
    *,
    phase: str,
    roas: Optional[float] = None,
    investment_intent: Optional[bool] = None,
) -> Optional[dict]:
    """ゲート4: 意図確認（フラグ型・診断はブロックしない）。

    新商品フェーズで異常な低ROAS（損益分岐点割れ）が出ている場合、診断結果は
    数値どおり表示した上で「これは投資ラインとして許容範囲内か」の確認を添える。
    investment_intent=True（許容すると回答済み）の場合は確認ではなく注記に変わる。

    Returns:
        None（対象外）
        {"ask": True, "question": ...}（未回答 → 確認を表示）
        {"ask": False, "note": ...}（回答済み → 注記を表示）
    """
    if phase != PHASE_NEW:
        return None
    if roas is None or roas >= RPP_ROAS_LINE:
        return None
    if investment_intent is True:
        return {
            "ask": False,
            "note": (
                "この商品は新商品への意図的な投資として許容中と登録されています。"
                "診断上の数値は変わりませんが、投資ラインの範囲内かは定期的に見直してください。"
            ),
        }
    return {
        "ask": True,
        "question": (
            "新商品の立ち上げ期です。このROAS・広告費は投資ラインとして許容範囲内ですか？"
            "許容範囲であれば「投資として許容」を選ぶと、以降は注記付きの表示になります"
            "（診断の数値自体は変わりません）。"
        ),
    }
