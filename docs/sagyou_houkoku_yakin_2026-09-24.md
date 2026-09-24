# 夜勤 作業報告（2026-09-24）

## 前段: 普請（急務対応）

`docs/office_map.html` QUESTS に `stamp:"wait"`（急務）は0件だった（`stamp:"kouho"` 26件・`stamp:"later"` 2件のみ）。
着手対象が無いため、普請は何も行わなかった。

STATUS（領国・評定・守り・軍費）も実態と照合した:
- 評定: GitHub上のopen PRは0件 → 「議案なし」のまま変更不要
- 守り: 直近の週次セキュリティチェックは2026-09-21付（次回は09-28）→ 「9/21検分 高0」のまま変更不要
- 軍費: `.claude/agents/infra-ops.md` のコスト内訳（Render $7 + Supabase $25 + Cloudflare 約$1 = $33）と一致 → 「月 約$33」のまま変更不要

「最終更新」コメント（`docs/office_map.html:268`）のみ、既存候補（2026-09-21発見・未昇格）が指摘するとおり
2026-09-21で止まっていたため、今回の更新に合わせて2026-09-24へ更新した（事実の更新の範囲内）。

## 後段: 巡回（発見専用）

新規候補を3件発見し、`docs/office_map.html` QUESTS（`stamp:"kouho"`）と `docs/gunrei_kouho.md` の
候補一覧に追記した。既存の急務・候補・却下済み・CLAUDE.md記載事項と重複しないことを確認済み。

1. **`.claude/agents/kpi-analyst.md:14`** — アクセス軸の出典テーブルの取り違え。
   「`site_uu`＝`MonthlyItemSales.cvr`」「`rpp_click`＝`RppSales.cvr_720`等」と書かれているが、
   単一の真実である `backend/access_definitions.py` によれば実際は `site_uu`＝`MonthlyItemSales.access_uu`、
   `rpp_click`＝`RppWeekly.ct`。`gap_analysis.py` が `RppWeekly` のみをimportし `RppSales` を一切
   使っていないことも確認した。kpi-analystエージェント自身が「アクセス軸の定義を担当」する番人という
   位置づけなのに、自分の知識ファイルが定義を取り違えている。

2. **`CLAUDE.md:373,377`ほか** — LPを繰り返し「LP（別リポジトリ）」と表記しているが、`lp/` は
   このリポジトリ直下に実在するディレクトリで、別リポジトリではない（`ls lp/`で実在確認、CLAUDE.md
   自身の台帳にも`lp/index.html`等を通常のPRで直接編集してきた記録が多数ある）。2026-09-15発見の
   既存候補（LP参照URLが`ureshiru.vercel.app`のまま）とは別の論点——URLの古さではなく
   「別リポジトリかどうか」という構造の誤認そのもの。

3. **`lp/privacy.html:64`** — 委託先一覧（個人情報保護法上の開示）が「ウェブサイトのホスティング：
   Vercel Inc.」のままだが、2026-08-24にCloudflare Pagesへ移行済み（Vercelプロジェクトは同日削除済み）。
   1行上の「アプリケーションのホスティング：Render, Inc.」は現状と一致しており、この行だけ取り残されている。
   `.claude/agents/legal-finance.md` 自身のチェック項目（「Vercel → Cloudflare Pages に移行済みなら要更新」）
   が指摘する内容そのものが、まだ未対応のまま残っていたことの裏取り。

いずれも発見のみで修正はしていない。昇格・却下はオーナー判断を待つ。

## 次にやること

- 上記3件の候補について、オーナーの昇格・却下判断待ち
- 既存の候補一覧（26件）は今回すべて既知として重複除外に使用済み。優先度の高いものから昇格を検討されたい
