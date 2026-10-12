# 夜勤 作業報告（2026-10-12）

## 前段: 普請（急務対応）

`docs/office_map.html` の `QUESTS` 配列に `stamp:"wait"`（急務）の札は無かった。
直近の週次セキュリティチェック（`security/security_check_2026-10-12.md`、同日午前にマージ済み）も
「高0・中0・低1（npm audit新規）、コード変更0件」で、バックエンド・フロント・LPのコードは
10/08以降まったく変更が無いことを確認済み。新たに足せる情報も無いため、今回は**普請は実施しない**。

STATUS（領国・評定・守り・軍費）も実態と照合した。評定「議案なし」（オープンPR 0件、`gh api`相当は
前回security-checkで確認済み）、守り「10/12検分 高0」（本日の報告書どおり）、軍費「月 約$33」
（`.claude/agents/infra-ops.md`のコスト内訳と一致、既存候補扱いのSupabaseプラン食い違いは変更なし）
のいずれも更新不要だった。

## 後段: 巡回（発見専用フェーズ）

これまでの巡回はCLAUDE.md・`.claude/agents/*.md`・`.claude/skills/*/SKILL.md`等の「指示書」が中心で、
`docs/office_map.html` 自身が持つ**AGENTS配列の決め台詞（talk文字列）の内容**は検分対象になって
いなかった。今回はそこに着目し、各台詞が具体的な数字・事実を主張している箇所を実測で裏取りした。

3件の新規候補を発見した（いずれも`docs/office_map.html`のAGENTS配列、既存候補・台帳・却下済みと
重複なしを確認済み）:

1. **developerの台詞「当家でBash全権を預かるは それがし一人」が実態と違う**（292行目）。
   `grep -c "^tools:.*Bash" .claude/agents/*.md` で実測すると、Bashを持つエージェントは
   developer含め7名（developer/infra-ops/kpi-analyst/planner/qa/reviewer/security）。
2. **designerの台詞「評定の間に二十もの札が並ぶ」が件数と食い違う**（309行目）。QUESTS配列を
   実測すると現在51件（kouho50+later1。今回の3件追加前）で「二十」から2.5倍以上の開き。
3. **kpi-analystの台詞「古き帳面（原本スプレッドシート）の数式の誤り三箇条」の裏付けが
   どこにも無い**（313行目）。「数式の誤り」「原本スプレッドシート」「三箇条」をリポジトリ全体で
   検索してもこの1行にしか出現しない。架空の値か、過去の記録が失われたのか判別できない。

いずれも発見のみで修正はせず、`docs/gunrei_kouho.md` の候補一覧に4件追記（上記3件は末尾の3行）し、
`docs/office_map.html` の `QUESTS` に `stamp:"kouho"` として3件追加した（候補の昇格・却下は
オーナー専任のため夜勤では行わない）。

## 次にやること

- `docs/gunrei_kouho.md` の候補一覧は今回で未解決49件（うち新規3件）。夜勤の普請は急務
  （`stamp:"wait"`）が無い限り動かないため、候補の裁可（昇格/却下）はオーナー判断待ち。
- 次回の巡回でも office_map.html 自身（AGENTS talk文・STATUS・footer等）の事実性チェックを
  続ける余地がある（今回は3件で打ち止めにしたが、talk文の総点検自体はまだ途中）。
