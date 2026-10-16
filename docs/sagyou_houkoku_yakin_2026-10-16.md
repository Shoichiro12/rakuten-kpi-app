# 夜勤 作業報告（2026-10-16）

## 前段: 普請

`docs/office_map.html` のQUESTSに `stamp:"wait"`（急務）は0件だった（着手前の時点で`kouho`59件＋
`later`1件、`mcp__github__list_pull_requests`で実測）。CLAUDE.md「📌 申し送り」台帳の「未実装」「未実施」扱いの
項目はいずれもオーナー判断待ち、またはオーナー自身の外部ダッシュボード確認が前提で、夜勤が着手できる
急務ではない。**よって普請は無し。**

STATUS（領国・評定・守り・軍費）も実態と照合した。

- 評定: `mcp__github__list_pull_requests`（state=open）で実測し0件。「議案なし」のまま変更不要
- 守り: 直近`security/security_check_2026-10-12.md`の結論（「高」は無し）と「10/12検分 高0」が一致。
  変更不要（次回定例は10/19）
- 軍費: `.claude/agents/infra-ops.md`のコスト表（Render $7 + Supabase $25 + Cloudflare $1 +
  LP/メール $0）＝$33とCLAUDE.md記載の「月 約$33」が一致。変更不要（Supabaseの実プランが本当に
  Proかどうかの疑義は既存候補のまま、オーナー確認待ちのため今回は手を付けない）
- 「最終更新」コメント（`docs/office_map.html:269`）を本日の変更にあわせて2026-10-15→2026-10-16へ
  更新（事実の更新）

## 後段: 巡回

新規候補2件を発見（上限3件のうち2件）。`docs/gunrei_kouho.md`の候補一覧（着手前80件・解決済みの
記録を含む）・却下済み（1件）、`docs/office_map.html`のQUESTS（着手前`kouho`59件）、CLAUDE.md
申し送り台帳と1件ずつ照合して重複が無いことを確認した。

1. **`.claude/README.md:51`（「全員共通のルール」節「エムダッシュ（—）不使用」）／
   `docs/sagyou_houkoku_yakin_*.md`全体／`docs/gunrei_kouho.md`本体**。ウレシル社の全員共通の
   文体規約「エムダッシュ不使用」が、まさにこのルールを毎晩読み書きする夜勤routine自身の出力で
   繰り返し違反されている。全`sagyou_houkoku_yakin_*.md`を通算すると39箇所、直近3晩だけでも
   10-13が2箇所・10-14が1箇所・10-15が3箇所と減る傾向が無い。候補を記録する台帳そのものである
   `docs/gunrei_kouho.md`にも既に13箇所混入していた。
2. **`backend/.env.example`（全46行）／`frontend/`（`.env.example`自体が存在しない）**。
   `backend/.env.example`は「backend の環境変数サンプル」と名乗るが、実際に書かれているのは
   任意のフラグ系5変数（`EXEMPT_TEST_EMAILS`・`TRIAL_WITHOUT_CARD`系・`ADMIN_USER_ID`・
   `EXPOSE_ERROR_DETAIL`・`ENABLE_DOCS`）のみで、アプリ起動に必須の接続系変数（`DATABASE_URL`・
   `SUPABASE_URL`・`SUPABASE_JWT_SECRET`・`STRIPE_SECRET_KEY`等、`backend/*.py`の
   `os.environ.get()`呼び出しとの突き合わせで確認）が1つも載っていない。`frontend/`には
   `.env.example`自体が存在せず、`VITE_SUPABASE_URL`等の雛形もどこにも無い。既存候補
   （拡張系env変数の記載漏れ、複数件）はいずれも「任意の機能が動かない」程度の実害だったが、
   今回の発見は「新しい環境でローカル開発を始めることそのものが`.env.example`だけでは完結しない」
   という、より根本的な欠落。

他に点検した箇所（`.claude/skills/*/SKILL.md`全5本、`.claude/agents/pmo.md`・`customer-success.md`・
`reviewer.md`・`qa.md`・`infra-ops.md`・`legal-finance.md`・`security.md`・`developer.md`の全文、
`.claude/README.md`全文、`docs/unyou_exempt_test_emails.md`、LPのアンカーリンク全件、docs内部の
Markdownリンク全件）はいずれも実装と一致しているか、既存候補と重複しており新規候補にはならなかった。

発見のみ・修正はせず、`docs/gunrei_kouho.md`の候補一覧と`docs/office_map.html`のQUESTS
（`stamp:"kouho"`）に追記した。候補札（`kouho`）の昇格・却下は行っていない。

## 次にやること

- 普請・巡回とも新規のコード変更は無し（`docs/`・`docs/office_map.html`のみの変更）。次回夜勤も
  同様にQUESTSの`wait`確認から開始する。
- 未裁可の候補の総数（`docs/office_map.html` QUESTSの`kouho`で61件）がさらに増えた。
  オーナーの都合が良いタイミングで`docs/gunrei_kouho.md`の棚卸し（昇格・却下の判断）をまとめて
  行うと、巡回のたびの重複確認コストが下がる。
