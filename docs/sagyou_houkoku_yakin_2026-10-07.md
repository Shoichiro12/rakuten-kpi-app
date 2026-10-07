# 夜勤 作業報告（2026-10-07）

## 前段: 普請（急務対応）

`docs/office_map.html` の `QUESTS` に `stamp:"wait"`（急務）の項目は0件だった。既存の候補
（`stamp:"kouho"`、45件超）はいずれも「候補（未昇格）」の状態で、オーナーの裁可待ちのまま。
よって今回の普請は何もせず終了した。

### STATUS照合

`STATUS`（領国・評定・守り・軍費）を実態と照合した。
- 評定: GitHub上のオープンPRは0件（`list_pull_requests` で確認）。「議案なし」のまま変更不要
- 守り: 最新の `security/security_check_*.md` は2026-10-05付（`ls security/` で確認）。「10/5検分 高0」のまま変更不要
- 軍費: `.claude/agents/infra-ops.md` のコスト表（Render $7 + Supabase $25 + Cloudflare 約$1 ＋ メール$0 ≈ $33）と一致。変更不要

いずれも事実の更新を要しなかった。

## 後段: 巡回（発見専用フェーズ）

既存の `docs/gunrei_kouho.md`（候補一覧76件・却下済み1件）とCLAUDE.md申し送り台帳を踏まえ、
以下を中心に見回った:

- `.claude/agents/` 配下の未精査領域（customer-success.md・pmo.md・reviewer.md・planner.md・qa.md・infra-ops.md 全文）
- `backend/sample_data.py` のテーブル網羅性（`UserScopedMixin` 継承20テーブルとの対比）
- `backend/migrations.py` の `_USER_SCOPED_TABLES` 登録状況（既存候補の裏取り）
- LP各ページ（`lp/*.html`）のアンカーリンク整合性（`href="...#..."` と対応する `id`）
- `backend/main.py` のルーター登録（`_paid`/`_auth`/`_admin` の使い分けとコメント）
- リポジトリ全体の `vercel` 言及箇所の棚卸し

ほとんどの発見は既存候補・却下済み・CLAUDE.md記載済みの事項と重複していた（例: サンプル
データのProduct/ProductCategory生成は `upsert_product`/`get_or_create_category` 経由で
実際には網羅済み、LPのアンカーリンクは全て解決済み、`_admin` 依存グループは適切にコメント
済み）。

### 新規候補（1件）

| 発見日 | 場所 | 何が | なぜ問題か | 放置するとどうなるか |
|---|---|---|---|---|
| 2026-10-07 | `docs/本番デプロイ_チェックリスト.md:10` | 法的文書の正を「LP（`https://ureshiru.vercel.app`）側」と記載。このURLは2026-08-24削除済みの旧Vercelプロジェクトのもので、現行LPは`https://ureshiru.com`（Cloudflare Pages） | 既存候補（2026-09-15発見、CLAUDE.md:367／links.tsが対象）と同根の問題が、別ファイルにも存在していた。重複ではなく追加の発生箇所 | 既存候補#35の対応時にこのファイルが見落とされると、同じ誤ったURLが残り続ける。実害は小さい（このファイルはCLAUDE.md・`.claude/agents/`配下の現行ドキュメントから一度も参照されておらず、2026-07-28・07-30の古い作業報告2件からのみ参照される旧チェックリスト） |

`docs/gunrei_kouho.md` の候補一覧に追記、`docs/office_map.html` の `QUESTS` に `stamp:"kouho"`
で1件追加した。重複以外の新規候補は2〜3件目まで見つからなかった（既存の候補backlogが
既に広く・深く既存の不整合を捕捉済みのため）。

## 次にやること

- 急務（`stamp:"wait"`）が積まれたら次回の普請で着手する
- 今回追加した候補1件は、既存候補#35（CLAUDE.md:367のLP URL修正）と同時に対応するのが効率的
