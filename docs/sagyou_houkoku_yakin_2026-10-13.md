# 夜勤 作業報告（2026-10-13）

## 前段: 普請

`docs/office_map.html` のQUESTSに `stamp:"wait"`（急務）は0件だった（既存は`kouho`50件超＋`later`1件のみ）。
CLAUDE.md「📌 申し送り」台帳の「未実装」「未実施」扱いの項目（Stripe顧客の重複防止・専門家確認・
4万SKU実測・JuneOne告知のLP追記・comp管理区切り4・GAP商品テーブルの列絞り込み・Supabaseプラン確認・
招待メール差出人統一）はいずれもオーナー判断待ち、またはオーナー自身の外部ダッシュボード確認が
前提で、夜勤が着手できる急務ではない。**よって普請は無し。**

STATUS（領国・評定・守り・軍費）も実態と照合した。評定=オープンPR0件（`gh`相当のAPIで確認）で
「議案なし」のまま変更不要。守り=直近`security/security_check_2026-10-12.md`と一致し変更不要。
軍費=`.claude/agents/infra-ops.md`のコスト表（$7+$25+$1+$0+$0=$33）と一致し変更不要。

## 後段: 巡回

新規候補2件を発見（3件の上限内）。重複チェックは`docs/gunrei_kouho.md`の候補一覧・却下済み、
`docs/office_map.html`のQUESTS、CLAUDE.md申し送り台帳と照合済み。

1. **`.claude/README.md:21`** — 組織図「権限」列がsecurityを「読み取り＋監査コマンド」と記載。
   実際の`.claude/agents/security.md`の`tools:`行はWriteを含み、`security/`配下へ週次で
   実際に書き込んでいる。他部署の行（pmo/planner/developer）は正しくWrite権限を反映している
   のに、securityの行だけ書き込み権限が記載から落ちている。
2. **`.claude/skills/kickoff/SKILL.md:11`** — 「`security/index.md`（またはプロジェクト側
   security_index.md）の最終実施日を確認し」と、無効化済みCoworkルーチンの遺物（sellerhub側
   文書、CLAUDE.md本文120-122行で「アクセス手段なし・repo側のみが正」と既に決着済み）を
   代替確認先として案内し続けている。

いずれも発見のみ・修正はせず、`docs/gunrei_kouho.md`の候補一覧と`docs/office_map.html`の
QUESTS（`stamp:"kouho"`）に追記した。候補札（`kouho`）の昇格・却下は行っていない。

## 次にやること

- 普請・巡回とも新規のコード変更は無し。次回夜勤も同様にQUESTSの`wait`確認から開始する。
