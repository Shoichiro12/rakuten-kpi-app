# -*- coding: utf-8 -*-
"""アイテム別目標の自動算出（設計ドキュメント2026-08-01 3-B''）。

利用者が入力するのは「アイテム別の目標売上」だけ。残りは確定公式で自動算出する:

    目標CVR   = MIN(現状CVR, 前年CVR)      … 保守的採用（EC実務の確定公式・オーナー承認済み）
    目標客単価 = MIN(現状客単価, 前年客単価)
    目標注文件数 = 目標売上 ÷ 目標客単価
    必要アクセス数 = 目標注文件数 ÷ 目標CVR

- AI推論は使わない。決定的な計算式のみ（実装も検証もシンプルに保つ）
- CVR・客単価は site_uu 軸（MonthlyItemSales＝商品分析レポートのページ全体CVR）
- 「現状値」= 対象月以前の直近実績月（無ければ最新実績月）
- 「前年値」= 対象月の前年同月。片方欠損は存在する方のみ採用し、basis_detail に明記
- 両方欠損（実績ゼロの新商品等）のみ推定モード: 同ジャンル自店平均 → 自店全体平均 →
  汎用ベースライン(ページCVR7%) の順で参考値を作り、承認フロー
  （estimated_approved）を経てから利用する

再計算のタイミング（バッチ・cronは使わない。書き込み時に導出して保存する方式）:
  1. 目標売上の保存時（routers/item_targets.py の upsert）
  2. 商品分析CSVの取込時（import_csv._import_monthly_items_bytes → recalc_all_item_targets）
     - 承認済みの推定値は、実績が入って確定公式（rule）で算出できるようになった時点で
       自動的にrule算出へ切り替える（推定はあくまで実績が無い間のつなぎ。確定公式は
       オーナー承認済みのルールなので、実測が取れたらそちらを正とする）
     - 実績が入っても推定のままのケース（データが対象商品に無い等）は、承認済みの
       推定値を取込のたびに上書きしない（承認した数字が勝手に動かないように）
"""
from typing import Optional

from sqlalchemy.orm import Session

from models import ItemTarget, MonthlyItemSales
from calculations import PAGE_CVR_BASELINE, safe_div

# 推定モードで同ジャンル平均を採用する最低商品数（対象商品自身を除く）
MIN_ESTIMATE_SAMPLE = 1


def _prev_year_ym(ym: str) -> str:
    return f"{int(ym[:4]) - 1}-{ym[5:7]}"


def _row_metrics(row: MonthlyItemSales) -> dict:
    """商品分析1行から CVR(%)・客単価 を取り出す（site_uu 軸）。"""
    uu = row.access_uu or 0
    cv = row.cv or 0
    sales = row.sales or 0
    cvr = row.cvr if (row.cvr or 0) > 0 else (round(safe_div(cv, uu) * 100, 2) if uu > 0 else 0)
    av = round(safe_div(sales, cv), 0) if cv > 0 else 0
    return {"cvr": cvr, "av": av, "uu": uu, "cv": cv}


def _actual_at_or_before(db: Session, management_no: str, ym: str) -> Optional[MonthlyItemSales]:
    """対象月以前の直近実績行。無ければ最新実績行（対象月が過去データより前の場合）。"""
    row = (
        db.query(MonthlyItemSales)
        .filter(MonthlyItemSales.management_no == management_no,
                MonthlyItemSales.year_month <= ym)
        .order_by(MonthlyItemSales.year_month.desc())
        .first()
    )
    if row is None:
        row = (
            db.query(MonthlyItemSales)
            .filter(MonthlyItemSales.management_no == management_no)
            .order_by(MonthlyItemSales.year_month.desc())
            .first()
        )
    return row


def _estimate_from_genre(db: Session, management_no: str) -> Optional[dict]:
    """実績ゼロの商品向けの参考値。同ジャンル（u3→u2→u1）→自店全体の順で自店平均を作る。

    Returns: {"cvr", "av", "source"}（作れない場合 None）
    """
    latest_ym = (
        db.query(MonthlyItemSales.year_month)
        .order_by(MonthlyItemSales.year_month.desc())
        .limit(1)
        .scalar()
    )
    if not latest_ym:
        return None
    rows = (
        db.query(MonthlyItemSales)
        .filter(MonthlyItemSales.year_month == latest_ym,
                MonthlyItemSales.management_no != management_no)
        .all()
    )
    rows = [r for r in rows if (r.access_uu or 0) > 0 and (r.cv or 0) > 0]
    if not rows:
        return None

    # 対象商品のジャンルは商品マスタ経由では持たないため、過去実績（無いのが前提）や
    # マスタのカテゴリからは取れないことが多い。取れる場合のみジャンル絞り込みを試す。
    self_row = (
        db.query(MonthlyItemSales)
        .filter(MonthlyItemSales.management_no == management_no)
        .order_by(MonthlyItemSales.year_month.desc())
        .first()
    )

    def _agg(subset, label):
        uu = sum(r.access_uu or 0 for r in subset)
        cv = sum(r.cv or 0 for r in subset)
        sales = sum(r.sales or 0 for r in subset)
        if uu <= 0 or cv <= 0:
            return None
        return {
            "cvr": round(cv / uu * 100, 2),
            "av": round(sales / cv, 0),
            "source": f"{label}（{len(subset)}商品・{latest_ym}実績）",
        }

    if self_row is not None:
        for attr, label in (("genre_u3", "同ジャンル（小分類）平均"),
                            ("genre_u2", "同ジャンル（中分類）平均"),
                            ("genre_u1", "同ジャンル（大分類）平均")):
            g = getattr(self_row, attr)
            if not g:
                continue
            subset = [r for r in rows if getattr(r, attr) == g]
            if len(subset) >= MIN_ESTIMATE_SAMPLE:
                agg = _agg(subset, label)
                if agg:
                    return agg

    return _agg(rows, "自店全体平均")


def calc_item_target(db: Session, management_no: str, year_month: str,
                     target_sales: float) -> dict:
    """アイテム別目標の自動算出（確定公式）。ItemTarget に保存する値一式を返す。

    Returns:
        {target_cvr, target_av, required_access, calc_basis, basis_detail}
    """
    current_row = _actual_at_or_before(db, management_no, year_month)
    py_row = (
        db.query(MonthlyItemSales)
        .filter(MonthlyItemSales.management_no == management_no,
                MonthlyItemSales.year_month == _prev_year_ym(year_month))
        .first()
    )

    cur = _row_metrics(current_row) if current_row is not None else None
    py = _row_metrics(py_row) if py_row is not None else None

    cvr_cands = []
    av_cands = []
    if cur and cur["cvr"] > 0:
        cvr_cands.append(("現状値", current_row.year_month, cur["cvr"]))
    if py and py["cvr"] > 0:
        cvr_cands.append(("前年値", py_row.year_month, py["cvr"]))
    if cur and cur["av"] > 0:
        av_cands.append(("現状値", current_row.year_month, cur["av"]))
    if py and py["av"] > 0:
        av_cands.append(("前年値", py_row.year_month, py["av"]))

    # ── 確定公式（rule）: 実績がある場合は MIN(現状, 前年) ──────────────────
    if cvr_cands and av_cands:
        cvr_pick = min(cvr_cands, key=lambda x: x[2])
        av_pick = min(av_cands, key=lambda x: x[2])
        target_cvr = cvr_pick[2]
        target_av = av_pick[2]
        required = _required_access(target_sales, target_av, target_cvr)
        detail = (
            f"目標CVR={target_cvr}%（{cvr_pick[0]} {cvr_pick[1]}を採用）／"
            f"目標客単価=¥{int(target_av):,}（{av_pick[0]} {av_pick[1]}を採用）"
        )
        if len(cvr_cands) < 2 or len(av_cands) < 2:
            detail += "。前年同月の実績が無いため、存在する実績のみで算出"
        return {
            "target_cvr": target_cvr,
            "target_av": target_av,
            "required_access": required,
            "calc_basis": "rule",
            "basis_detail": detail,
        }

    # ── 推定モード（estimated）: 実績が無い新商品等。承認フローを経て使う ────
    est = _estimate_from_genre(db, management_no)
    if est is not None:
        required = _required_access(target_sales, est["av"], est["cvr"])
        return {
            "target_cvr": est["cvr"],
            "target_av": est["av"],
            "required_access": required,
            "calc_basis": "estimated",
            "basis_detail": (
                f"実績が無いため参考値: {est['source']}から推定。"
                "「この参考値で確定」の承認後に診断・逆算で使われます"
            ),
        }

    # 自店にデータが1件も無い場合の最終フォールバック: CVRのみ汎用ベースライン。
    # 客単価は推定材料が無く、算出不能（データ取込後に自動で再計算される）
    return {
        "target_cvr": PAGE_CVR_BASELINE,
        "target_av": None,
        "required_access": None,
        "calc_basis": "insufficient",
        "basis_detail": (
            "実績・類似商品データが無いため算出できません（CVRのみ汎用ベースライン"
            f"{PAGE_CVR_BASELINE:.0f}%を仮置き）。商品分析CSVを取り込むと自動で再計算されます"
        ),
    }


def _required_access(target_sales: float, target_av: Optional[float],
                     target_cvr: Optional[float]) -> Optional[float]:
    """必要アクセス数 = (目標売上 ÷ 目標客単価) ÷ 目標CVR"""
    if not target_av or not target_cvr or target_av <= 0 or target_cvr <= 0:
        return None
    orders = target_sales / target_av
    return round(orders / (target_cvr / 100), 0)


def apply_calc(db: Session, row: ItemTarget) -> ItemTarget:
    """ItemTarget 1行に自動算出を適用する（承認状態の維持ルール込み）。"""
    calc = calc_item_target(db, row.management_no, row.year_month, row.target_sales)

    if (
        row.calc_basis == "estimated"
        and row.estimated_approved
        and calc["calc_basis"] == "estimated"
    ):
        # 承認済みの推定値は、推定のままの再計算では上書きしない（承認した数字を保つ）
        return row

    if calc["calc_basis"] == "rule" and row.calc_basis == "estimated":
        calc["basis_detail"] += "。実測データが取れたため、参考値から確定公式の算出に自動更新"

    row.target_cvr = calc["target_cvr"]
    row.target_av = calc["target_av"]
    row.required_access = calc["required_access"]
    row.calc_basis = calc["calc_basis"]
    row.basis_detail = calc["basis_detail"]
    if calc["calc_basis"] != "estimated":
        # rule/insufficient に承認概念は無い（ruleは常に有効扱い）
        row.estimated_approved = False
    return row


def recalc_all_item_targets(db: Session) -> int:
    """全アイテム目標を再計算する（商品分析CSV取込時に呼ぶ）。commitは呼び出し側。"""
    rows = db.query(ItemTarget).all()
    for row in rows:
        apply_calc(db, row)
    return len(rows)
