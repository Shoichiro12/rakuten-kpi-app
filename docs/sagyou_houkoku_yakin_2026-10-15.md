# 夜勤 作業報告（2026-10-15）

## 前段: 普請

`docs/office_map.html` のQUESTSに `stamp:"wait"`（急務）は0件だった（着手前の時点で`kouho`56件＋
`later`1件のみ、`mcp__github__list_pull_requests`で実測）。CLAUDE.md「📌 申し送り」台帳の「未実装」「未実施」扱いの
項目はいずれもオーナー判断待ち、またはオーナー自身の外部ダッシュボード確認が前提で、夜勤が着手できる
急務ではない。**よって普請は無し。**

STATUS（領国・評定・守り・軍費）も実態と照合した。

- 評定: `mcp__github__list_pull_requests`（state=open）で実測し0件。「議案なし」のまま変更不要
- 守り: 直近`security/security_check_2026-10-12.md`の結論サマリ（「重大度『高』の新規指摘は無し」）
  と「10/12検分 高0」が一致。変更不要（次回定例は10/19）
- 軍費: `.claude/agents/infra-ops.md`のコスト表（Render $7 + Supabase $25 + Cloudflare $1 +
  LP/メール $0）＝$33とCLAUDE.md記載の「月 約$33」が一致。変更不要
- 「最終更新」コメント（`docs/office_map.html:269`）を本日の変更にあわせて2026-10-12→2026-10-15へ
  更新（事実の更新）

## 後段: 巡回

新規候補3件を発見（上限3件）。`docs/gunrei_kouho.md`の候補一覧（着手前60件・解決済みの記録を含む）・
却下済み（1件）、`docs/office_map.html`のQUESTS（着手前`kouho`56件）、CLAUDE.md申し送り台帳と
1件ずつ照合して重複が無いことを確認した。

1. **`docs/office_map.html:317`（legal-financeのtalk文字列）／`.claude/agents/legal-finance.md:10`／
   `CLAUDE.md:375`** — legal-financeの決め台詞は価格・プラン名の確認先を「五箇所」（LPの3文書＋
   billing.py＋Stripe）と数えているが、CLAUDE.md本文とlegal-finance.md自身の表はどちらも同じ論点を
   「3箇所」（LPを1項目として数える）で一貫して表現しており、数え方の単位がtalk文字列だけ食い違う。
2. **`SKILL.md`（リポジトリ直下、全文）** — `.claude/skills/`配下ではなくルートに置かれた旧設計書で、
   アクセス軸を`monthly_analysis.access_count`から集計すると説明（現行は`access_definitions.py`が
   単一の真実で月次・年次は`site_uu`軸）、`ActionCheck`/`InventoryStatus`のスキーマ例に
   `UserScopedMixin`も`user_id`も無い（2026-07マルチテナント化以前の設計のまま）等、現行実装と
   大きく乖離している。どのドキュメントからも参照されていない「死んだドキュメント」。
3. **`security/index.md:7-16`（冒頭注記）／`CLAUDE.md:120`** — security/index.mdの冒頭は
   「次回チェック時に同期するか削除するか判断する」という2026-08-18時点の未決定の書きぶりのままだが、
   CLAUDE.md:120（2026-08-24付）は既に「遡及反映は不要」「security/index.mdはgit側の実施記録の
   役割を維持」と決着させている。`git log -p --follow`で確認すると、以降8回以上の週次更新を経ても
   この冒頭段落だけ一度も書き換えられていない。

他に点検した箇所（`.claude/agents/pmo.md`／`customer-success.md`／`legal-finance.md`の残り／
`.claude/README.md`の未指摘行／`docs/VISION.md`）はいずれも実装と一致しているか、既存候補と
重複しており新規候補にはならなかった。

発見のみ・修正はせず、`docs/gunrei_kouho.md`の候補一覧と`docs/office_map.html`のQUESTS
（`stamp:"kouho"`）に追記した。候補札（`kouho`）の昇格・却下は行っていない。

## 次にやること

- 普請・巡回とも新規のコード変更は無し（`docs/`のみの変更）。次回夜勤も同様にQUESTSの`wait`確認から
  開始する。
- 未裁可の候補の総数（`docs/office_map.html` QUESTSの`kouho`で59件）が多くなってきているため、
  オーナーの都合が良いタイミングで`docs/gunrei_kouho.md`の棚卸し（昇格・却下の判断）をまとめて
  行うと、巡回のたびの重複確認コストが下がる。
