# 夜勤作業報告（2026-09-17）

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
照合し、新規2件を発見した（3件枠のうち2件。今回はドキュメント陳腐化の系統から離れ、
セキュリティ・運用チェックリストの観点で調べた）。

1. **`backend/.env.example` にマルウェアスキャン関連env（`CLOUDMERSIVE_API_KEY`・
   `MALWARE_SCAN_FAIL_CLOSED`・`MALWARE_SCAN_TIMEOUT`）の記載が無い。** 同ファイルの
   他の「旗系」env変数（`EXEMPT_TEST_EMAILS`・`TRIAL_WITHOUT_CARD`・`ADMIN_USER_ID`・
   `EXPOSE_ERROR_DETAIL`・`ENABLE_DOCS`）はすべて区切りコメント＋注意書き＋設定例つきの
   ブロックで書かれているのに、マルウェアスキャンの3変数だけ皆無（grepでヒット0件）。
   2026-09-02に実際に`CLOUDMERSIVE_API_KEY`が本番未設定のまま長期間気づかれなかった
   インシデント（CLAUDE.md記録済み）と同型のチェックリスト漏れが、対応後もなお
   `.env.example`側には残っている。
2. **`backend/migrations.py:25-57` の`_USER_SCOPED_TABLES`辞書に`action_logs`・
   `rpp_action_checks`が登録されていない。** どちらも`UserScopedMixin`を継承し実運用で
   能動的に使われているテーブル（`action_logs`=施策実施記録・学習ループ、`recommendations.py`
   `learning.py`で使用／`rpp_action_checks`=RPP診断パネルのチェック状態、`rpp_diagnosis.py`
   で使用）だが、この辞書に無いため、既存DBへのuser_id列自動追加（`_add_user_id_columns`）と
   `LEGACY_DATA_USER_ID`による既存行の一括割当（`_assign_legacy_data`）の対象から漏れている。
   RLS強制（`_enforce_rls_pg`）は`pg_tables`を独立に全走査するため無関係＝両テーブルとも
   RLSでは保護済み（`security-status`のunprotectedが空であることから裏付けられる）。
   影響が生じるのは「user_id列が無い状態でテーブルが先に存在していた既存DB」に限られる
   条件付きのリスクだが、CLAUDE.md冒頭の「新しいモデルを追加するときの必須確認」
   チェックリストがこの辞書への登録を明示的な項目に挙げていないことが一因と考えられる。

両方とも `docs/office_map.html` の QUESTS に `stamp:"kouho"` として追記し、詳細を
`docs/gunrei_kouho.md` の候補一覧に記録した。修正（昇格判断）はオーナーの裁可待ち。

コードの変更は無し（巡回は発見のみで修正はしない）。

## 次にやること

- 上記2件の候補をオーナーが確認し、急務（`stamp:"wait"`）へ昇格するか却下するか判断する
- 急務が積まれ次第、次回夜勤の普請で1件ずつ対応する
