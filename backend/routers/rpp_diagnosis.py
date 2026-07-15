"""RPP診断API（RppAnalysisページ専用）。

RppSales（実CSV由来の商品単位データ）のみを入力にした課題判定を返す。
⚠️ RppWeekly由来の既存集計（dashboard / gap_analysis / products）とは混ぜない。
この診断はRppAnalysisページ内で完結させる（二重計上防止）。

判定ロジック本体は calculations.detect_rpp_issues()（KPI計算ロジックの集約場所）。
このモジュールはデータの取り出し・ベンチマーク算出・アクション定義の付与を担う。
"""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import RppActionCheck, RppSales
from calculations import (
    RPP_CPC_SPIKE_RATE,
    RPP_CTR_RATIO,
    RPP_CVR_RATIO,
    RPP_MIN_CT_FOR_DIAGNOSIS,
    RPP_ROAS_LINE,
    calc_change_rate,
    detect_rpp_issues,
    safe_div,
)

router = APIRouter(prefix="/api/rpp", tags=["rpp"])


# ─── RPP用アクション定義 ─────────────────────────────────────────────────────
# 既存 ActionPanel.tsx の ACTIONS 配列と同じ構造 + confidence フィールドを追加。
# 診断はバックエンドで行うため、文言もバックエンドで一元管理しAPIレスポンスに含める
# （フロントは表示するだけ。次フェーズのキーワード別レポート対応時に文言・confidence
#  をここだけで昇格できる）。
#
# 「広告を一時停止する」は rpp_keyword_check の文言内の選択肢の一つに含めるが、
# 単独の confirmed アクションとしては出さない（決め打ちしない）。
RPP_ACTIONS: list[dict] = [
    {
        "key": "rpp_creative",
        "category": "Promotion",
        "confidence": "confirmed",
        "text": "サムネイル・商品名（訴求ワード）を見直す",
        "detail": "検索結果一覧での見え方の課題。1枚目画像の訴求・価格表示・タイトル前方のキーワードを改善してクリック率を上げる",
    },
    {
        # 既存 lp_review（ActionPanel.tsx）と同趣旨。RPP側は診断がバックエンドの
        # ため別キーにしているが、チェック状態を共通化する場合はキー統合を検討。
        "key": "rpp_lp_review",
        "category": "Product",
        "confidence": "confirmed",
        "text": "商品ページLP・レビューを改善する",
        "detail": "クリック後の受け皿の課題。ファーストビューの訴求・画像・レビュー件数/評点を見直して転換率を上げる",
    },
    {
        "key": "rpp_keyword_check",
        "category": "Promotion",
        "confidence": "needs_check",
        "text": "まずRPP管理画面でキーワード別の実績を確認する。特定キーワードだけが悪ければそこだけ除外・入札を下げる。全体的に悪ければ広告自体の停止を検討する",
        "detail": "商品単位のデータだけでは原因がキーワード側か商品側か判別できないため、停止を決め打ちせずキーワード別実績の確認から始める",
    },
    {
        "key": "rpp_bid_review",
        "category": "Promotion",
        "confidence": "needs_check",
        "text": "まず商品全体の入札単価（bid_price）の推移を確認する。急騰が続くならキーワード単位の絞り込みを検討する",
        "detail": "CPC上昇が入札競争の激化によるものか、自店の入札設定によるものかを切り分ける",
    },
]

_ACTIONS_BY_KEY = {a["key"]: a for a in RPP_ACTIONS}

# 課題コード → 表示ラベル（フロントのバッジ・パネル見出しで使用）
ISSUE_LABELS: dict[str, str] = {
    "insufficient_data": "データ不足",
    "cpo_over": "CPO超過（赤字進行中）",
    "roas_low": "ROAS100%割れ（損益分岐点割れ）",
    "ctr_low": "CTR低迷（クリエイティブ課題）",
    "cvr_low": "CVR低迷（LP/商品ページ課題）",
    "cpc_spike": "CPC急騰（入札競争激化の可能性）",
}


class RppActionTogglePayload(BaseModel):
    management_no: str
    period_key: str
    action_key: str


def _aggregate_item(rows: list[RppSales]) -> dict:
    """同一商品の行を合算して指標を再計算する。

    通常はユニーク制約 (period_type, date_from, date_to, item_code) により1商品1行
    だが、週次を年月指定で引いた場合等に複数週が混ざるため合算に対応しておく。
    CTRはインプレッション数が無く合算再計算できないため、行の単純平均を使う。
    """
    ct = sum(r.ct or 0 for r in rows)
    ad_cost = sum(r.ad_cost or 0 for r in rows)
    gross_720 = sum(r.gross_720 or 0 for r in rows)
    cv_720 = sum(r.cv_720 or 0 for r in rows)
    ctr_vals = [r.ctr for r in rows if r.ctr is not None]
    return {
        "ct": ct,
        "ad_cost": ad_cost,
        "gross_720": gross_720,
        "cv_720": cv_720,
        "ctr": round(sum(ctr_vals) / len(ctr_vals), 2) if ctr_vals else 0.0,
        "cvr_720": round(safe_div(cv_720, ct) * 100, 2),
        "roas_720": round(safe_div(gross_720, ad_cost) * 100, 1),
        "cpo_720": round(safe_div(ad_cost, cv_720), 0),
        "cpc": round(safe_div(ad_cost, ct), 1),
        "bid_price": max((r.bid_price or 0) for r in rows) if rows else 0,
        "product_name": next((r.product_name for r in rows if r.product_name), None),
        "item_url": next((r.item_url for r in rows if r.item_url), None),
    }


def _period_filter(q, period_type: str, year_month: Optional[str],
                   date_from: Optional[str], date_to: Optional[str]):
    q = q.filter(RppSales.period_type == period_type)
    if year_month:
        q = q.filter(RppSales.year_month == year_month)
    if date_from:
        q = q.filter(RppSales.date_from == date_from)
    if date_to:
        q = q.filter(RppSales.date_to == date_to)
    return q


def _prev_period_rows(
    db: Session,
    period_type: str,
    year_month: Optional[str],
    date_from: Optional[str],
) -> list[RppSales]:
    """前期（前週/前月）の全行を返す。CPC前期比の算出用。

    「前期」はインポート済みデータの中で現在期間の直前にある期間
    （週次: date_from が現在より小さい最新週 / 月次: year_month が現在より
    小さい最新月）。リクエストの期間から導出し、today には依存しない。
    """
    if period_type == "weekly":
        if not date_from:
            return []
        prev_from = (
            db.query(RppSales.date_from)
            .filter(RppSales.period_type == "weekly", RppSales.date_from < date_from)
            .order_by(RppSales.date_from.desc())
            .limit(1)
            .scalar()
        )
        if not prev_from:
            return []
        return (
            db.query(RppSales)
            .filter(RppSales.period_type == "weekly", RppSales.date_from == prev_from)
            .all()
        )

    # monthly
    if not year_month:
        return []
    prev_ym = (
        db.query(RppSales.year_month)
        .filter(RppSales.period_type == "monthly", RppSales.year_month < year_month)
        .order_by(RppSales.year_month.desc())
        .limit(1)
        .scalar()
    )
    if not prev_ym:
        return []
    return (
        db.query(RppSales)
        .filter(RppSales.period_type == "monthly", RppSales.year_month == prev_ym)
        .all()
    )


@router.get("/diagnosis")
def get_rpp_diagnosis(
    period_type: Literal["weekly", "monthly"] = Query("weekly"),
    management_no: Optional[str] = Query(None, description="商品管理番号（item_code）。省略時は期間内の全商品"),
    year_month: Optional[str] = Query(None, description="YYYY-MM 形式"),
    date_from: Optional[str] = Query(None, description="YYYY-MM-DD 形式（週次の場合）"),
    date_to: Optional[str] = Query(None, description="YYYY-MM-DD 形式（週次の場合）"),
    db: Session = Depends(get_db),
):
    """商品単位のRPP診断結果を返す。

    management_no 指定で1商品、省略で期間内の全商品を診断する
    （テーブルの診断列は全商品分を1リクエストで取得する想定）。

    ⚠️ CPO（Limit CPO=GP/cv）判定について:
    実データ調査の結果、MonthlyItemSales に原価相当の列は無く、
    RppWeekly.cost_of_sales も実RMSのRPPレポートに原価列が無いため常に0。
    よって Limit CPO 判定はスキップし、ROAS<100% を代替シグナルとして使う
    （cpo_evaluable=false）。原価データが取り込めるようになったら
    detect_rpp_issues() に limit_cpo を渡すだけで有効化できる。
    """
    q = _period_filter(db.query(RppSales), period_type, year_month, date_from, date_to)
    rows = q.all()

    period_key = date_from if period_type == "weekly" else (year_month or "")

    base = {
        "period_type": period_type,
        "year_month": year_month,
        "date_from": date_from,
        "date_to": date_to,
        "period_key": period_key,
        "cpo_evaluable": False,
        "cpo_skip_reason": "原価データ未取込のためLimit CPO判定はスキップし、ROAS100%ラインを代替基準にしています",
        "min_ct": RPP_MIN_CT_FOR_DIAGNOSIS,
        "issue_labels": ISSUE_LABELS,
        "actions": RPP_ACTIONS,
    }

    if not rows:
        # 規約: データ無しでも常にJSONを返す
        return {**base, "benchmarks": {}, "items": []}

    # ── ベンチマーク（同期間・同ショップの全商品） ──────────────────────
    # CVR平均: 既存サマリーと同じ「合計cv÷合計ct」の加重平均（gap分析の85%ルール踏襲）
    # CTR平均: インプレッション数が無いため商品別CTRの単純平均
    total_ct = sum(r.ct or 0 for r in rows)
    total_cv = sum(r.cv_720 or 0 for r in rows)
    ctr_vals = [r.ctr for r in rows if r.ctr is not None]
    avg_ctr = round(sum(ctr_vals) / len(ctr_vals), 2) if ctr_vals else 0.0
    avg_cvr = round(safe_div(total_cv, total_ct) * 100, 2)

    benchmarks = {
        "avg_ctr": avg_ctr,
        "avg_cvr": avg_cvr,
        "roas_line": RPP_ROAS_LINE,
        "ctr_ratio": RPP_CTR_RATIO,
        "cvr_ratio": RPP_CVR_RATIO,
        "cpc_spike_rate": RPP_CPC_SPIKE_RATE,
    }

    # ── 前期CPC（同商品の前週/前月比較用） ─────────────────────────────
    prev_rows = _prev_period_rows(db, period_type, year_month, date_from)
    prev_cpc_by_item: dict[str, float] = {}
    prev_groups: dict[str, list[RppSales]] = {}
    for r in prev_rows:
        prev_groups.setdefault(r.item_code or "", []).append(r)
    for code, grp in prev_groups.items():
        agg = _aggregate_item(grp)
        if agg["ct"] > 0:
            prev_cpc_by_item[code] = agg["cpc"]

    # ── 商品ごとに集約 → 判定 ──────────────────────────────────────────
    groups: dict[str, list[RppSales]] = {}
    for r in rows:
        code = r.item_code or ""
        if management_no and code != management_no:
            continue
        groups.setdefault(code, []).append(r)

    items = []
    for code, grp in sorted(groups.items()):
        m = _aggregate_item(grp)
        prev_cpc = prev_cpc_by_item.get(code)
        result = detect_rpp_issues(
            ct=m["ct"],
            ctr=m["ctr"],
            cvr=m["cvr_720"],
            roas=m["roas_720"],
            cpc=m["cpc"],
            avg_ctr=avg_ctr,
            avg_cvr=avg_cvr,
            prev_cpc=prev_cpc,
            # 原価データが無いため CPO 判定はスキップ（上記 docstring 参照）
            cpo=None,
            limit_cpo=None,
        )
        issues = [
            {
                **i,
                "label": ISSUE_LABELS.get(i["issue"], i["issue"]),
                "action": _ACTIONS_BY_KEY.get(i["action_key"]) if i["action_key"] else None,
            }
            for i in result["issues"]
        ]
        items.append({
            "management_no": code,
            "product_name": m["product_name"],
            "item_url": m["item_url"],
            "status": result["status"],
            "issues": issues,
            "metrics": {
                "ct": m["ct"],
                "ctr": m["ctr"],
                "cvr_720": m["cvr_720"],
                "roas_720": m["roas_720"],
                "cpo_720": m["cpo_720"],
                "cpc": m["cpc"],
                "prev_cpc": prev_cpc,
                "cpc_change_rate": calc_change_rate(m["cpc"], prev_cpc) if prev_cpc else None,
                "ad_cost": m["ad_cost"],
                "gross_720": m["gross_720"],
                "cv_720": m["cv_720"],
                "bid_price": m["bid_price"],
            },
        })

    return {**base, "benchmarks": benchmarks, "items": items}


@router.get("/diagnosis/checks")
def get_rpp_action_checks(
    management_no: str,
    period_key: str,
    db: Session = Depends(get_db),
):
    """RPP診断アクションのチェック状態を返す（既存 /api/actions と同パターン）。"""
    rows = db.query(RppActionCheck).filter(
        RppActionCheck.management_no == management_no,
        RppActionCheck.period_key == period_key,
    ).all()
    return {r.action_key: r.checked for r in rows}


@router.post("/diagnosis/toggle")
def toggle_rpp_action(payload: RppActionTogglePayload, db: Session = Depends(get_db)):
    """RPP診断アクションのチェックをトグルする（既存 /api/actions/toggle と同パターン）。"""
    row = db.query(RppActionCheck).filter(
        RppActionCheck.management_no == payload.management_no,
        RppActionCheck.period_key == payload.period_key,
        RppActionCheck.action_key == payload.action_key,
    ).first()

    if row:
        row.checked = not row.checked
    else:
        row = RppActionCheck(
            management_no=payload.management_no,
            period_key=payload.period_key,
            action_key=payload.action_key,
            checked=True,
        )
        db.add(row)

    db.commit()
    return {"action_key": payload.action_key, "checked": row.checked}
