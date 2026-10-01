# 夜勤 作業報告（2026-10-01）

## 前段: 普請（急務対応）

`docs/office_map.html` の QUESTS を確認したところ、`stamp:"wait"`（急務）の項目は0件だった。
すべて `stamp:"kouho"`（候補・未裁可）と `stamp:"later"`（後日・封緘）のみで、着手対象が無い。

STATUS（評定・守り・軍費）も実態と照合した。
- 評定: オープンPR 0件（GitHub `list_pull_requests` で確認）→「議案なし」のままで正しい
- 守り: 直近のセキュリティチェックは `security/security_check_2026-09-28.md`（9/28）→「9/28検分 高0」のままで正しい（次回定例は10/5）
- 軍費: 変更なし

該当なしのため、普請は実施せず。

## 後段: 巡回（発見専用フェーズ）

既存の `docs/office_map.html` QUESTS（急務・後日・候補41件）、`docs/gunrei_kouho.md` の候補一覧・却下済み、
CLAUDE.md申し送り台帳と重複しないかを確認したうえで、新規2件を発見した（上限3件のうち2件）。

1. **`.claude/agents/security.md:3,31`／`.claude/README.md:21`** — セキュリティ室エージェントの指示書が、
   報告書の更新先ファイルを「security_index.md」（ディレクトリ区切り無し）と表記している。実在するのは
   `security/index.md`。この綴りは、CLAUDE.mdで既に「Coworkルーチン時代の遺物・sellerhub側に残る別ファイル・
   repo側`security/index.md`が正で同期不要」と決着済みの、プロジェクトdocs側の別ファイルを指す言葉として
   既存候補（`.claude/skills/security-check/SKILL.md:14`）で使われてきた経緯があり、紛らわしい。
2. **`backend/.env.example`** — CSPの追加接続先許可env `CSP_CONNECT_SRC`（CLAUDE.md本文のCSP節で
   存在が明記済み）と、RMS自動検出フォルダ変更env `RMS_INBOX_DIR`（ローカル専用機能）が、どちらも
   `.env.example` に一切記載が無い。既出の「`.env.example`のドキュメント漏れ」パターン（2026-09-17巡回、
   ALLOW_ORIGINS等）と同型だが対象変数は重複しない。

いずれも発見のみ・修正はしていない。`docs/office_map.html` QUESTS に `stamp:"kouho"` として追記し、
`docs/gunrei_kouho.md` の候補一覧に詳細を記録した。候補の昇格・却下は行っていない（オーナーのみが行う）。

## 評定待ち

なし（普請を実施していないため）。

## 次にやること

- `docs/office_map.html` QUESTS に急務（`stamp:"wait"`）が無い状態が続いている。巡回で積み上がった
  候補（現在41件+今回2件=43件）のうち、オーナーが優先度の高いものを急務へ昇格させるタイミングで
  次回以降の普請が動き出す
- 次回の定例セキュリティチェックは2026-10-05（月曜）
