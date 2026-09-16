# 夜勤作業報告（2026-09-16）

## 前段: 普請（急務対応）

`docs/office_map.html` の `QUESTS` に `stamp:"wait"`（急務）は0件。
普請の対象なし。

**STATUS実態照合**: 評定＝オープンPR 0件（`mcp__github__list_pull_requests` で確認）で
「議案なし」のまま変更不要。守り＝最新の `security/security_check_*.md` は2026-09-14付で
「9/14検分 高0」のまま変更不要（本文の「重大度『高』の新規指摘は無し」を確認）。軍費＝
`.claude/agents/infra-ops.md` のコスト表（Render Starter $7 + Supabase Pro $25 + Cloudflare
約$1 ≒ $33）と一致で変更不要。3項目とも実態と一致しており更新なし。

## 後段: 巡回（発見専用フェーズ）

既存の急務（QUESTS）・候補一覧（`docs/gunrei_kouho.md`）・却下済み・CLAUDE.md申し送り台帳と
照合し、新規2件を発見した（3件枠のうち2件。3件目に相当する水準の新規発見は今回無し）。

1. **CLAUDE.md:321 のバックエンドルーター一覧が古い**（`backend/routers/`）。記載は9本
   （dashboard / import_csv / targets / gap_analysis / products / actions / evaluation /
   export / account）だが、実際は21本（`__init__.py`除く）。`admin`・`admin_comp`・
   `billing`・`consulting`・`costs`・`feedback`・`inventory`・`item_targets`・`masters`・
   `recommendations`・`revenue_plan`・`rpp_diagnosis` の12本が記載から漏れている。
   2026-09-15に見つかったApp.tsxルーティング一覧の陳腐化（同種の記述漏れ）と対になる
   バックエンド側の同型問題。
2. **CLAUDE.md:320 の`global_exception_handler`説明がEXPOSE_ERROR_DETAILゲートを
   反映していない**。「全例外は`{"detail": str(exc)}`のJSON 500に変換」と書かれているが、
   実装（`backend/main.py:200-206`）は既定で定型文（`"サーバーエラーが発生しました"`）を返し、
   `env EXPOSE_ERROR_DETAIL`が真のときだけ`str(exc)`を返す。このゲート自体は`c4ea5b7`
   （2026-08-03）で導入済みで、CLAUDE.md 120行目（Coworkルーチン突き合わせの記録）が
   「訂正のみで対応済み」と書いているが、実際に更新されたのは120行目の履歴記述のみで、
   320行目のアーキテクチャ説明自体は当時から一度も直っていなかった。

両方とも `docs/office_map.html` の QUESTS に `stamp:"kouho"` として追記し、詳細を
`docs/gunrei_kouho.md` の候補一覧に記録した。修正（昇格判断）はオーナーの裁可待ち。

コードの変更は無し（CLAUDE.mdの当該2行そのものは、巡回のルールにより今回は直していない
——巡回は発見のみで修正はしない）。

## 次にやること

- 上記2件の候補をオーナーが確認し、急務（`stamp:"wait"`）へ昇格するか却下するか判断する
- 急務が積まれ次第、次回夜勤の普請で1件ずつ対応する
