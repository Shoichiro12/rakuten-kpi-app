from typing import Literal, Optional


def safe_div(numerator: float, denominator: float, default: float = 0.0) -> float:
    if denominator == 0:
        return default
    return numerator / denominator


def calc_kpis(
    gross: float,
    cost_of_sales: float,
    ad_cost: float,
    cv: int,
    ct: int,
    expense_rate: float = 0.15,
    ctr: float = 0.0,
) -> dict:
    gp = gross - cost_of_sales
    gpr = safe_div(gp, gross) * 100
    av = safe_div(gross, cv)
    cvr = safe_div(cv, ct) * 100
    roas = safe_div(gross, ad_cost) * 100
    cpo = safe_div(ad_cost, cv)
    limit_cpo = safe_div(gp, cv)
    cpc = safe_div(ad_cost, ct)
    steady_cost = gross * expense_rate
    rev = gp - (ad_cost + steady_cost)
    roi = safe_div(gp, ad_cost) * 100

    return {
        "gross": gross,
        "cost_of_sales": cost_of_sales,
        "ad_cost": ad_cost,
        "cv": cv,
        "ct": ct,
        "gp": gp,
        "gpr": round(gpr, 2),
        "av": round(av, 0),
        "cvr": round(cvr, 2),
        "ctr": round(ctr, 2),
        "roas": round(roas, 1),
        "cpo": round(cpo, 0),
        "limit_cpo": round(limit_cpo, 0),
        "cpc": round(cpc, 0),
        "steady_cost": round(steady_cost, 0),
        "rev": round(rev, 0),
        "roi": round(roi, 1),
    }


def calc_change_rate(current: float, previous: float) -> Optional[float]:
    if previous == 0:
        return None
    return round((current - previous) / previous * 100, 1)


# ─── RPP診断（RppAnalysisページ専用） ────────────────────────────────────────
#
# RppSales（実CSV由来の商品単位データ）だけを入力にした課題判定。
# ⚠️ RppWeekly由来の既存集計（dashboard / gap_analysis / products）とは混ぜない。
#
# confidence の考え方:
# - confirmed   … 商品単位のデータだけで原因まで言い切れる課題（CTR/CVR）
# - needs_check … 損益悪化は事実だが、原因がキーワード側か商品側かは
#                 キーワード別レポートが無い現状では判別できない課題（ROAS/CPO/CPC）
# 次フェーズでキーワード別RPPレポートを取り込んだら needs_check → confirmed に
# 昇格させる設計のため、confidence は必ずスキーマに含める。

RppConfidence = Literal["confirmed", "needs_check", "info"]
RppDiagnosisStatus = Literal["insufficient_data", "issues", "good"]

# クリック母数がこの値未満の商品は判定対象外（ノイズ対策）。
# 警告ではなく「データ不足」の情報表示に留める。
RPP_MIN_CT_FOR_DIAGNOSIS = 10

# CTR: 同期間・同ショップ全商品平均の75%未満で課題（既存ActionPanelの75%ルール踏襲）
RPP_CTR_RATIO = 0.75
# CVR: 同ショップ全商品平均の85%未満で課題（既存gap分析の85%ルール踏襲）
RPP_CVR_RATIO = 0.85
# ROAS: 絶対値100%ライン（損益分岐点）
RPP_ROAS_LINE = 100.0
# CPC: 同商品の前期比 +20% 以上で急騰扱い
RPP_CPC_SPIKE_RATE = 20.0


def detect_rpp_issues(
    ct: int,
    ctr: float,
    cvr: float,
    roas: float,
    cpc: float,
    avg_ctr: float,
    avg_cvr: float,
    prev_cpc: Optional[float] = None,
    cpo: Optional[float] = None,
    limit_cpo: Optional[float] = None,
    min_ct: int = RPP_MIN_CT_FOR_DIAGNOSIS,
) -> dict:
    """RPP商品単位の課題判定。

    優先順位（上から順に判定。複数該当は issues 配列で全部返す）:
      1. データ不足（ct < min_ct）      → 判定スキップ、情報表示のみ
      2. CPO超過（limit_cpo がある場合のみ） → 要確認: 赤字進行中
      3. ROAS < 100%                    → 要確認: 損益分岐点割れ
      4. CTR が平均の75%未満            → 確定: クリエイティブ課題
      5. CVR が平均の85%未満            → 確定: LP/商品ページ課題
      6. CPC が前期比+20%以上           → 要確認: 入札競争激化
      7. 該当なし                       → 良好

    limit_cpo（=GP/cv）は原価データが取れる場合のみ渡す。
    ※調査結果: MonthlyItemSales に原価列は無く、RppWeekly.cost_of_sales も
      実RMSのRPPレポートに原価列が無いため常に0。よって現状 limit_cpo は
      常に None（CPO判定スキップ）で、ROAS<100% が代替シグナルとなる。
      原価データが取り込めるようになったら limit_cpo を渡すだけで有効化できる。

    戻り値: {"status": RppDiagnosisStatus, "issues": [{"issue", "confidence", "action_key"}]}
    """
    # 優先度1: 母数不足 → 以降の判定はすべてスキップ（警告にしない）
    if ct < min_ct:
        return {
            "status": "insufficient_data",
            "issues": [
                {"issue": "insufficient_data", "confidence": "info", "action_key": None},
            ],
        }

    issues: list[dict] = []

    # 優先度2: CPO超過（原価データがあり limit_cpo を計算できた場合のみ）
    if limit_cpo is not None and cpo is not None and limit_cpo > 0 and cpo > limit_cpo:
        issues.append({"issue": "cpo_over", "confidence": "needs_check", "action_key": "rpp_keyword_check"})

    # 優先度3: ROAS 損益分岐点割れ（原因がキーワード側か商品側かは不明 → 要確認）
    if roas < RPP_ROAS_LINE:
        issues.append({"issue": "roas_low", "confidence": "needs_check", "action_key": "rpp_keyword_check"})

    # 優先度4: CTR低迷（検索結果上の見え方の課題 → 商品単位データで確定できる）
    if avg_ctr > 0 and ctr < avg_ctr * RPP_CTR_RATIO:
        issues.append({"issue": "ctr_low", "confidence": "confirmed", "action_key": "rpp_creative"})

    # 優先度5: CVR低迷（クリック後の受け皿の課題 → 商品単位データで確定できる）
    if avg_cvr > 0 and cvr < avg_cvr * RPP_CVR_RATIO:
        issues.append({"issue": "cvr_low", "confidence": "confirmed", "action_key": "rpp_lp_review"})

    # 優先度6: CPC急騰（入札競争か、商品全体の入札見直し要否かは不明 → 要確認）
    if prev_cpc is not None and prev_cpc > 0:
        change = (cpc - prev_cpc) / prev_cpc * 100
        if change >= RPP_CPC_SPIKE_RATE:
            issues.append({"issue": "cpc_spike", "confidence": "needs_check", "action_key": "rpp_bid_review"})

    if not issues:
        return {"status": "good", "issues": []}
    return {"status": "issues", "issues": issues}
