# -*- coding: utf-8 -*-
"""アクセス指標の定義と信頼性判定の単一の真実（要件 No.5 / No.6）。

アクセス指標には母数の異なる2軸が存在する。

- "rpp_click": RppWeekly.ct 由来。RPP広告クリック数。cvr = cv/ct（クリック→注文）。
- "site_uu"  : MonthlyItemSales.access_uu 由来。店舗ページ実訪問UU数。cvr = cv/access_uu（訪問→注文）。

母数が異なるため、同一の比較・合算・グラフに混在させないこと。
新しいAPIでアクセス関連の値を返す際は、必ず access_axis を含めて軸を明示する。

信頼性（No.6）:
  EC実務基準として、アクセス母数が MIN_ACCESS_SAMPLE 未満の商品・ジャンル・
  期間は CVR・客単価が統計的に信用できない。is_reliable() で全画面共通に判定し、
  信用できない値には「参考値」フラグ（reliable=False）を立てて誤検知・誤提案を防ぐ。
"""

from typing import Literal

AccessAxis = Literal["rpp_click", "site_uu"]

# アクセス母数の下限。これ未満は CVR・客単価を統計的に信用しない（要件No.6）。
# 旧 evaluation.MIN_ACCESS_SAMPLE をここへ集約。全画面・全ルーターで共通利用する。
#
# 基準は「週あたり100件」（EC実務基準・オーナー確認済み）。この100は週次の値なので、
# 月次データに対しては月換算（100 × 30 ÷ 7 ≒ 429 → 430）で判定する。
# 従来は月次にも100を使っていたが、それでは月次でほぼ全商品が母数条件を満たしてしまい
# ゲートとして機能しないため、2026-08-01 の設計整理で換算を導入した（オーナー承認済み）。
# 週次の閾値・既定値は従来どおり100で変更なし。
MIN_ACCESS_SAMPLE = 100            # 週次（週あたりアクセス）
MIN_ACCESS_SAMPLE_MONTHLY = 430    # 月次（週100件の月換算）


def min_access_for(period_type: Literal["weekly", "monthly"]) -> int:
    """期間種別に応じたアクセス母数の下限を返す（weekly=100 / monthly=430）。"""
    return MIN_ACCESS_SAMPLE_MONTHLY if period_type == "monthly" else MIN_ACCESS_SAMPLE


def is_reliable(denominator, threshold: int = MIN_ACCESS_SAMPLE) -> bool:
    """アクセス母数(denominator)が閾値以上なら True（＝CVR・客単価を信用してよい）。

    denominator は access_axis に応じた母数を渡す:
      - rpp_click 軸 … RppWeekly.ct（クリック数）
      - site_uu   軸 … MonthlyItemSales.access_uu（訪問UU）

    None・負値は母数不足（False）として扱う。
    """
    if denominator is None:
        return False
    return denominator >= threshold
