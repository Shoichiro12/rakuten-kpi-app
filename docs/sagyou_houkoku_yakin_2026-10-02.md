# 夜勤 作業報告（2026-10-02）

## 前段: 普請（急務対応）

`docs/office_map.html` の QUESTS を確認したところ、`stamp:"wait"`（急務）の項目は0件だった。
すべて `stamp:"kouho"`（候補・未裁可、44件）と `stamp:"later"`（後日・封緘）のみで、着手対象が無い。

STATUS（評定・守り・軍費）も実態と照合した。
- 評定: オープンPR 0件（`gh api repos/Shoichiro12/rakuten-kpi-app/pulls?state=open` で確認）→「議案なし」のままで正しい
- 守り: 直近のセキュリティチェックは `security/security_check_2026-09-28.md`（9/28）→「9/28検分 高0」のままで正しい（次回定例は10/5）
- 軍費: 変更なし

該当なしのため、普請は実施せず。

## 後段: 巡回（発見専用フェーズ）

既存の `docs/office_map.html` QUESTS（急務・後日・候補44件）、`docs/gunrei_kouho.md` の候補一覧・却下済み、
CLAUDE.md申し送り台帳と重複しないかを確認したうえで、新規2件を発見した（上限3件のうち2件）。

1. **`.claude/agents/kpi-analyst.md:14`** — 前提知識が「`MIN_ACCESS_SAMPLE=100` 未満は信頼度低」とだけ
   書いているが、`backend/access_definitions.py` は期間種別ごとに異なる3段階のしきい値（週次100・
   月次430・年次5220、`min_access_for(period_type)`）を単一の真実として定義している。kpi-analyst.md は
   この期間別の使い分けに一切触れておらず、月次・年次データの信頼性判定を誤りうる。同じ14行目の
   既存候補（2026-09-24発見、`site_uu`/`rpp_click` の出典テーブル取り違え）とは別の欠落。
2. **`.claude/agents/developer.md:15-28`／`.claude/agents/reviewer.md:1-12`** — developer.md の開発規約表・
   reviewer.md のチェックリストは、どちらもCSV**エクスポート**時の数式インジェクション対策
   （`csv_safe_cell()`）だけを扱い、CSV/ZIP**アップロード**時のマルウェアスキャン義務（`scan_bytes()`。
   CLAUDE.mdマスタCRUD規約に明記済み）には一切触れていない。この規約は一度CLAUDE.mdへの記載自体が
   漏れたまま本番 `CLOUDMERSIVE_API_KEY` が未設定になり、5エンドポイントでスキャン漏れが起きていた
   実績がある（2026-09-02発覚）。CLAUDE.md本体には明記されたが、実装担当・レビュー担当のエージェント
   指示書には反映されておらず、同種の事故が再発しうる。

いずれも発見のみ・修正はしていない。`docs/office_map.html` QUESTS に `stamp:"kouho"` として追記し、
`docs/gunrei_kouho.md` の候補一覧に詳細を記録した。候補の昇格・却下は行っていない（オーナーのみが行う）。

あわせて `docs/office_map.html` の「最終更新」コメント（2026-09-28 → 2026-10-02）を実態に合わせて更新した
（事実の更新。新しい判断を伴わないため普請1件のルールの外で実施）。

## 評定待ち

なし（普請を実施していないため）。

## 次にやること

- `docs/office_map.html` QUESTS に急務（`stamp:"wait"`）が無い状態が続いている。巡回で積み上がった
  候補（現在44件+今回2件=46件）のうち、オーナーが優先度の高いものを急務へ昇格させるタイミングで
  次回以降の普請が動き出す
- 次回の定例セキュリティチェックは2026-10-05（月曜）
