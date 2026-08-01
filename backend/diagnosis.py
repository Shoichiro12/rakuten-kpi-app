# -*- coding: utf-8 -*-
"""診断分類器（設計ドキュメント2026-08-01 2-B / 5章）。

商品単位のRPP実績を8分類に振り分け、対応する提案（試算＋選択肢）を紐付ける。
設計2-Bの12パターンのうち、KW粒度が前提のもの（#1,#1',#2,#5,#9のKW操作部分）は
商品粒度に読み替え、KW操作が必要な結論は「RPP管理画面でキーワード別実績を確認」への
誘導文言にする（KW別データ取込後に粒度をKWへ拡張する。3-E'）。
#12（商品タイプ分離）は商品マスタにタイプ概念が無いため対象外（オーナー承認済み）。

8分類:
  育成型         … 新商品フェーズ。ROAS評価を適用せず、データ蓄積を優先（2-B #10）
  出血型         … ROAS300%未満 AND CPO>Limit CPO の複合条件（3-D'）。停止候補を
                   試算付きで提示（原価率設定済み商品のみ判定可能）
  要ページ改善型 … CVRがベンチマーク比で異常に低い。KW調整では目標到達不可、
                   ページ改善とセットで対応。広告側は出血止めのみ（2-B #7）
  要観察型       … CTRが基準以上なのにCV0。即除外せず価格・ページ要因を疑う（2-B #8)
  高CPC型        … CVR良好だがCPCが突出して高い。入札引き下げ（2-B #3）
  低露出型       … ROASは合格ライン超過だがクリック僅少。課題は効率でなく量（2-B #4）
  惜しい群       … ROASが合格ラインまであと一歩（250〜300%）でCVR良好・大型出血なし。
                   数円単位の緩やかな微調整（2-B #6）
  良好型         … 上記いずれにも該当しない（2-B #5の「主力は維持」に相当）

設計原則（2-C / 3-F / 5章）:
  - 提案は「試算＋選択肢の提示」を基本とし、自動実行しない
  - 配信停止のような影響が大きい打ち手には必ずセカンドベストを併記する
  - 各提案には根拠の数値を添える

しきい値定数は calculations.py が単一の真実。ここでは判定と言語化だけを行う。
"""
from typing import Optional

from calculations import (
    AD_CVR_BASELINE_LABEL,
    ROAS_PASS_LINE,
    RPP_CVR_RATIO,
    RPP_ROAS_LINE,
    safe_div,
)

# ─── 分類キーとラベル ─────────────────────────────────────────────────────
TYPE_NURTURE = "nurture"            # 育成型
TYPE_BLEEDING = "bleeding"          # 出血型
TYPE_PAGE_IMPROVE = "page_improve"  # 要ページ改善型
TYPE_WATCH = "watch"                # 要観察型
TYPE_HIGH_CPC = "high_cpc"          # 高CPC型
TYPE_LOW_EXPOSURE = "low_exposure"  # 低露出型
TYPE_ALMOST = "almost"              # 惜しい群
TYPE_GOOD = "good"                  # 良好型

TYPE_LABELS = {
    TYPE_NURTURE: "育成型",
    TYPE_BLEEDING: "出血型（停止候補）",
    TYPE_PAGE_IMPROVE: "要ページ改善型",
    TYPE_WATCH: "要観察型",
    TYPE_HIGH_CPC: "高CPC型",
    TYPE_LOW_EXPOSURE: "低露出型",
    TYPE_ALMOST: "惜しい群",
    TYPE_GOOD: "良好型",
}

# バッジ色のトーン（フロントは tone → 色クラスに変換。文言・判定はバックエンド集約）
TYPE_TONES = {
    TYPE_NURTURE: "info",        # 青系（判断保留・見守り）
    TYPE_BLEEDING: "danger",     # 赤系（停止候補）
    TYPE_PAGE_IMPROVE: "danger",
    TYPE_WATCH: "warning",       # 黄系（要観察・要確認）
    TYPE_HIGH_CPC: "warning",
    TYPE_LOW_EXPOSURE: "warning",
    TYPE_ALMOST: "info",
    TYPE_GOOD: "success",        # 緑系
}

# ─── 分類のしきい値（この分類器でのみ使う値。KPI定数は calculations.py） ─────
# 惜しい群のROAS下限（設計2-B #6 の例示 250〜290% を 250〜合格ライン未満 として採用）
ALMOST_ROAS_MIN = 250.0
# 要ページ改善型: CVRがベンチマークの50%未満＝「異常に低い」（靴紐案件: 0.66% vs 11%級。
# 85%ルール(RPP_CVR_RATIO)の「低め」より深刻な水準を別枠で拾う）
PAGE_IMPROVE_CVR_RATIO = 0.5
# 高CPC型: 店舗平均CPCの1.5倍以上を「突出して高い」とみなす
HIGH_CPC_RATIO = 1.5
# 低露出型: 母数ゲートは通ったがクリックがこの値未満なら「露出不足」とみなす
LOW_EXPOSURE_CT = 50


def _yen(v: Optional[float]) -> str:
    if v is None:
        return "—"
    return f"¥{int(round(v)):,}"


def _proposal(title: str, detail: str, kind: str = "primary",
              estimate: Optional[str] = None) -> dict:
    """提案1件。kind: 'primary'（第一候補）| 'second_best'（代替案）| 'note'（補足）"""
    return {"title": title, "detail": detail, "kind": kind, "estimate": estimate}


def classify_product(
    *,
    ct: int,
    cvr: float,
    ctr: float,
    roas: float,
    cpc: float,
    cv: int,
    gross: float,
    ad_cost: float,
    cvr_benchmark: float,
    ctr_benchmark: float,
    shop_avg_cpc: Optional[float] = None,
    limit_cpo: Optional[float] = None,
    cpo: Optional[float] = None,
    phase: str = "established",
) -> dict:
    """商品1件を8分類に振り分ける。

    Args:
        cvr_benchmark : 広告経由CVRの比較基準（benchmarks.resolve_benchmark の value）
        ctr_benchmark : CTRの比較基準（同上）
        shop_avg_cpc  : 店舗平均CPC（高CPC型の判定用。Noneなら判定スキップ）
        limit_cpo     : 限界CPO＝粗利÷注文件数。原価率が設定済みの商品のみ渡す。
                        None の場合、複合条件（3-D'）は判定できない
        phase         : 'new'（新商品フェーズ）| 'established'

    Returns:
        {"type", "label", "tone", "summary", "proposals": [...],
         "limit_cpo_evaluable": bool}

    判定順（先に該当したものが分類。深刻度と「判断を確定できる度合い」の順）:
      育成型 → 出血型 → 要ページ改善型 → 要観察型 → 高CPC型 → 低露出型 → 惜しい群 → 良好型
    """
    evaluable = limit_cpo is not None and limit_cpo > 0 and cpo is not None

    # ── 育成型（2-B #10）: 新商品はROAS評価を適用しない ────────────────────
    if phase == "new":
        return {
            "type": TYPE_NURTURE,
            "label": TYPE_LABELS[TYPE_NURTURE],
            "tone": TYPE_TONES[TYPE_NURTURE],
            "summary": (
                "新商品フェーズ（デフォルト3ヶ月の様子見期間）のため、ROAS等の効率評価を"
                "適用していません。今はデータ蓄積と露出の確保を優先する期間です。"
            ),
            "proposals": [
                _proposal(
                    "露出とデータ蓄積を優先する",
                    "この期間の数値で広告の良し悪しを判断しないでください。様子見期間の"
                    "延長・短縮は商品マスタの「フェーズ」で変更できます。",
                ),
            ],
            "limit_cpo_evaluable": evaluable,
        }

    # ── 出血型（3-D' 複合条件）: ROAS<300% AND CPO>Limit CPO で停止候補 ────
    if evaluable and roas < ROAS_PASS_LINE and cpo > limit_cpo:
        # 停止した場合の試算（3-F: 試算＋選択肢の提示。自動実行しない）
        saved = ad_cost
        lost_gross = gross
        # 粗利ベースの損益: limit_cpo×cv ＝ 粗利。広告費がそれを上回っている分が出血額
        bleed = ad_cost - (limit_cpo * cv)
        summary = (
            f"ROAS {roas:.0f}%（合格ライン {ROAS_PASS_LINE:.0f}%未満）かつ "
            f"CPO {_yen(cpo)} が限界CPO {_yen(limit_cpo)} を超過。広告費が商品の粗利を"
            f"上回っており、1件売るごとに損が出ています（超過分 約{_yen(bleed)}/期間）。"
        )
        proposals = [
            _proposal(
                "配信停止（第一候補）",
                "複合条件（ROAS合格ライン未満＋限界CPO超過）に該当した最大の出血源です。"
                "停止すれば出血は止まりますが、経由売上も失われます。実行するかどうかは"
                "下の代替案と見比べて判断してください。",
                kind="primary",
                estimate=f"広告費 −{_yen(saved)} ／ 経由売上 −{_yen(lost_gross)}（期間あたり）",
            ),
            _proposal(
                "KW絞り込みで継続（代替案）",
                "RPP管理画面でキーワード別実績を確認し、悪いKWだけ除外・入札引き下げで"
                "続ける選択肢です。配信面を維持したまま出血を減らせる可能性がありますが、"
                "全体的に悪い場合は停止の方が確実です。",
                kind="second_best",
            ),
        ]
        return {
            "type": TYPE_BLEEDING,
            "label": TYPE_LABELS[TYPE_BLEEDING],
            "tone": TYPE_TONES[TYPE_BLEEDING],
            "summary": summary,
            "proposals": proposals,
            "limit_cpo_evaluable": True,
        }

    # ── 要ページ改善型（2-B #7）: CVRがベンチマーク比で異常に低い ──────────
    if cvr_benchmark > 0 and cvr < cvr_benchmark * PAGE_IMPROVE_CVR_RATIO:
        return {
            "type": TYPE_PAGE_IMPROVE,
            "label": TYPE_LABELS[TYPE_PAGE_IMPROVE],
            "tone": TYPE_TONES[TYPE_PAGE_IMPROVE],
            "summary": (
                f"CVR {cvr:.2f}%が基準値 {cvr_benchmark:.2f}%の半分未満で、異常に低い水準です。"
                "この状態ではキーワード調整だけで目標に届きません。"
            ),
            "proposals": [
                _proposal(
                    "商品ページ改善とセットで対応する",
                    "サムネイル・ファーストビューの訴求・価格/送料表記・レビューを見直して"
                    "ください。ページが受け皿として機能するまで、広告側は出血止め"
                    "（明確に悪いKWの除外）のみに留めます。",
                ),
            ],
            "limit_cpo_evaluable": evaluable,
        }

    # ── 要観察型（2-B #8）: CTRは基準以上なのにCV0 ────────────────────────
    if cv == 0 and ctr_benchmark > 0 and ctr >= ctr_benchmark:
        return {
            "type": TYPE_WATCH,
            "label": TYPE_LABELS[TYPE_WATCH],
            "tone": TYPE_TONES[TYPE_WATCH],
            "summary": (
                f"CTR {ctr:.2f}%（基準 {ctr_benchmark:.2f}%）とクリックはされているのに、"
                "注文が0件です。興味は持たれているが購入に至っていない状態です。"
            ),
            "proposals": [
                _proposal(
                    "即除外せず「要観察」として価格・ページ要因を疑う",
                    "クリック後に離脱する原因（価格が競合より高い・送料・ページの訴求不足）を"
                    "確認してください。KWを消す前に受け皿側を疑うのがこのパターンの定石です。",
                ),
            ],
            "limit_cpo_evaluable": evaluable,
        }

    # ── 高CPC型（2-B #3）: CVR良好だがCPCが突出して高い ────────────────────
    cvr_ok = cvr_benchmark > 0 and cvr >= cvr_benchmark * RPP_CVR_RATIO
    if (
        cvr_ok
        and shop_avg_cpc is not None and shop_avg_cpc > 0
        and cpc >= shop_avg_cpc * HIGH_CPC_RATIO
        and roas < ROAS_PASS_LINE
    ):
        # 目標ROASに乗るCPCの逆算（3-C: 目標CPC ≒ (売上÷クリック数) ÷ 目標ROAS倍率）
        target_cpc = safe_div(safe_div(gross, ct), ROAS_PASS_LINE / 100)
        return {
            "type": TYPE_HIGH_CPC,
            "label": TYPE_LABELS[TYPE_HIGH_CPC],
            "tone": TYPE_TONES[TYPE_HIGH_CPC],
            "summary": (
                f"CVR {cvr:.2f}%は良好ですが、CPC {_yen(cpc)} が店舗平均 {_yen(shop_avg_cpc)} の"
                f"{HIGH_CPC_RATIO:.1f}倍以上と突出しています。売れる力はあるのに単価で効率を落としています。"
            ),
            "proposals": [
                _proposal(
                    "目標ROASに乗る水準まで入札を引き下げる",
                    "一気に合わせるのではなく、週次で±10〜15%程度の刻みで段階的に近づけて"
                    "ください（急な絞り込みは露出を失います）。",
                    estimate=f"目安CPC 約{_yen(target_cpc)}（ROAS{ROAS_PASS_LINE:.0f}%換算）",
                ),
            ],
            "limit_cpo_evaluable": evaluable,
        }

    # ── 低露出型（2-B #4）: 効率は合格だがクリック僅少 ─────────────────────
    if roas >= ROAS_PASS_LINE and ct < LOW_EXPOSURE_CT:
        return {
            "type": TYPE_LOW_EXPOSURE,
            "label": TYPE_LABELS[TYPE_LOW_EXPOSURE],
            "tone": TYPE_TONES[TYPE_LOW_EXPOSURE],
            "summary": (
                f"ROAS {roas:.0f}%と効率は合格ラインを超えていますが、クリックが {ct:,}件と"
                "僅少です。課題は効率ではなく量（露出）です。"
            ),
            "proposals": [
                _proposal(
                    "入札UPで露出を拡大する",
                    "効率が出ている状態なので、露出を増やすだけで伸びる可能性が高い商品です。"
                    "月間クリック数の目標を置いて、届くまで段階的に入札を上げてください。",
                ),
            ],
            "limit_cpo_evaluable": evaluable,
        }

    # ── 惜しい群（2-B #6）: 合格まであと一歩・CVR良好・大型出血なし ────────
    almost_range = ALMOST_ROAS_MIN <= roas < ROAS_PASS_LINE
    no_big_bleed = (not evaluable) or (cpo is not None and cpo <= limit_cpo)
    if almost_range and cvr_ok and no_big_bleed:
        return {
            "type": TYPE_ALMOST,
            "label": TYPE_LABELS[TYPE_ALMOST],
            "tone": TYPE_TONES[TYPE_ALMOST],
            "summary": (
                f"ROAS {roas:.0f}%で合格ライン（{ROAS_PASS_LINE:.0f}%）まであと一歩。"
                f"CVR {cvr:.2f}%は良好で、大きな出血もありません。"
            ),
            "proposals": [
                _proposal(
                    "数円単位の緩やかな入札微調整",
                    "急な絞り込みはしないでください。CPCを数円下げるだけで合格ラインに"
                    "乗る位置にいます。週次で少しずつ調整し、露出を落とさないことを優先します。",
                ),
            ],
            "limit_cpo_evaluable": evaluable,
        }

    # ── 良好型 ────────────────────────────────────────────────────────────
    note = None
    if roas < RPP_ROAS_LINE:
        # 損益分岐点割れだが上記いずれにも該当しない（原価未設定で複合条件を判定
        # できない等）。既存の roas_low 課題（detect_rpp_issues）が別途警告する。
        note = (
            "ROASが損益分岐点（100%）を下回っていますが、原価率が未設定のため"
            "停止候補（複合条件）の判定ができません。商品マスタで原価率を設定すると"
            "限界CPOベースの判定が有効になります。"
        )
    return {
        "type": TYPE_GOOD,
        "label": TYPE_LABELS[TYPE_GOOD],
        "tone": TYPE_TONES[TYPE_GOOD],
        "summary": note or "明確な課題は検出されていません。主力は維持し、現在の運用を継続してください。",
        "proposals": [] if note is None else [
            _proposal(
                "原価率を設定して停止判断を有効化する",
                "限界CPO（粗利÷注文件数）が算出できると、「利益は出ているが目標未達なだけのKW」を"
                "早期に止めすぎない複合条件（ROAS300%未満＋限界CPO超過）で判定できます。",
                kind="note",
            ),
        ],
        "limit_cpo_evaluable": evaluable,
    }
