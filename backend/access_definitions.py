# -*- coding: utf-8 -*-
"""アクセス指標の定義と信頼性判定の単一の真実（要件 No.5 / No.6）。

アクセス指標には母数の異なる2軸が存在する。

- "rpp_click": RppWeekly.ct 由来。RPP広告クリック数。cvr = cv/ct（クリック→注文）。
- "site_uu"  : MonthlyItemSales.access_uu 由来。店舗ページ実訪問UU数。cvr = cv/access_uu（訪問→注文）。

母数が異なるため、同一の比較・合算・グラフに混在させないこと。
新しいAPIでアクセス関連の値を返す際は、必ず access_axis を含めて軸を明示する。

信頼性（No.6）:
  NATIONS講座ルールで、アクセス母数が MIN_ACCESS_SAMPLE 未満の商品・ジャンル・
  期間は CVR・客単価が統計的に信用できない。is_reliable() で全画面共通に判定し、
  信用できない値には「参考値」フラグ（reliable=False）を立てて誤検知・誤提案を防ぐ。
"""

from typing import Literal

AccessAxis = Literal["rpp_click", "site_uu"]

# アクセス母数の下限。これ未満は CVR・客単価を統計的に信用しない（要件No.6）。
# 旧 evaluation.MIN_ACCESS_SAMPLE をここへ集約。全画面・全ルーターで共通利用する。
MIN_ACCESS_SAMPLE = 100


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
