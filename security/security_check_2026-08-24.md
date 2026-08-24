# セキュリティチェック 2026-08-24

対象範囲: 前回チェック（2026-08-18、PR #16・#18マージ・コミット `61346e3` / `f22a854`）以降の
`f22a854..main` 42コミット（ダッシュボードのドリルダウン再設計、マスタ設計統一［目標・商品・
カテゴリ・アイテム別目標のソフトデリート/CSV入出力］、LPのエッセイ型全面刷新、サンプルデータの
`is_sample` 分離、「ウレシル社」サブエージェント体制導入）。

## 結論サマリ

- **重大度「高」の新規指摘は無し。**
- 前回指摘4件（npm audit high3件／npm audit react-router系／CSPヘッダー欠如／consulting.py文字数上限）は
  いずれも**維持（退行なし）**。実測でも解消状態を再確認した。
- RLS強制の仕組み（`migrations._enforce_rls_pg`）はテーブル名非依存でpg_tablesを直接走査する実装のため、
  今回の大量のカラム追加（`is_sample`・`archived_at`）や新規ページ（カテゴリマスタ）の追加によっても
  自動的にカバーされる。**新規テーブルの追加は無かった**（既存テーブルへの列追加のみ）ため、RLS適用漏れの
  リスクはそもそも発生していない。
- 新設・拡張された全ルーター（`masters.py` の商品削除・カテゴリCSV入出力、`targets.py` のCSV入出力・
  ソフトデリート、`item_targets.py` のCSV入出力、`main.py` の `DELETE /api/sample-data`）は、いずれも
  既存の `dependencies=_paid`（または `_auth`）ルーター単位ガードの配下にあり、個別エンドポイントの
  認証漏れは確認されなかった。
- テナント分離（`UserScopedMixin` / SQLAlchemyイベントによる自動 `user_id` 絞り込み）は、新しいクエリも
  すべてORM経由（`db.query(...)`）で、生SQL（`text()`）を使っている箇所は起動時マイグレーション
  （`_mark_legacy_sample_rows`）のみ。これは全ユーザー対象の一括処理として意図的なものであり、
  リクエスト処理経路には生SQLは無い。
- 新規指摘は**低〜中1件（CSVインジェクション対策の欠如。既存の未対策範囲が今回の3ルーター拡張で
  さらに広がった）**。重大度は「中」だが、RLS/テナント分離により影響は「自分自身がエクスポートした
  CSVを自分のExcelで開いたときだけ」に限定されるため緊急対応は不要と判断（詳細は下記）。
- `.gitignore` の変更（`e4363f3`、`.claude/skills/` の追跡除外を `design-system/` のみに縮小）は
  `.env` / `.env.*` の除外に影響なし。意図しない追跡緩和は確認されなかった。

## 前回指摘のフォローアップ

| 指摘 | 前回状態 | 今回の確認 | 判定 |
|---|---|---|---|
| npm audit: nanoid / postcss / vite（high 3件） | ✅ 解決（2026-08-18） | `npm audit --package-lock-only` を実行 → **0件** | 維持 |
| npm audit: react-router / react-router-dom（moderate系） | ✅ 解決（2026-08-18、v7.18.2移行） | 同上 → **0件**。`frontend/package.json` の `react-router-dom` が `^7.18.2` のまま | 維持 |
| `backend/main.py` の `security_headers` にCSPが無い | ✅ 解決（2026-08-18） | `main.py` に前回チェック以降の変更なし（diff 0件）。CSP文字列・ヘッダー付与コードとも健在（`script-src 'self'` 含む） | 維持 |
| `backend/routers/consulting.py` の文字数上限が無い | ✅ 解決（2026-08-18） | `consulting.py` に前回チェック以降の変更なし（diff 0件） | 維持 |

いずれも退行なし。

## 新規指摘

### 中: CSVエクスポートにCSVインジェクション（数式注入）対策が無い（対象範囲が今回さらに拡大）

**再現手順**:
1. 商品マスタで商品名を `=1+1` や `@SUM(A1:A9)` のような文字列にリネームする（`PUT /api/master/products/{management_no}` は `product_name` を自由入力で受け付ける）。同様にカテゴリマスタの大/中/小分類名も自由入力（`POST /api/master/categories`）。
2. `GET /api/master/products/export`（既存）／`GET /api/master/categories/export`（今回新設）／
   `GET /api/item-targets/export`（今回新設。`product_name` を `Product` から結合して出力）のいずれかで
   CSVをダウンロードし、Excel/Googleスプレッドシートで開く。
3. セルが文字列ではなく数式として評価され、意図しない計算やDDE経由のコマンド実行につながり得る
   （CWE-1236 / OWASP CSV Injection）。

**影響**: 各エクスポートAPIは `dependencies=_paid` 配下かつテナント分離（RLS + `user_id` 自動絞り込み）が
効いているため、**このCSVに載るのは常にエクスポートしたユーザー自身のデータのみ**。したがって被害シナリオは
「自分（または同一契約内の共同利用者）が入力した商品名・カテゴリ名を、自分自身がエクスポートしたCSVで
開いたときに、Excelの数式として実行されてしまう」に限定される。他テナントのデータを汚染して攻撃する
経路は無い。**severityは中程度**（他社データを預かる建付け上ゼロにはできないが、緊急対応が必要なほどの
外部攻撃面ではない）。

**対策案**: `backend/routers/masters.py` / `targets.py` / `item_targets.py`（および既存 `export.py`）が
それぞれ個別に `csv.writer` を組み立てている箇所を、共通ヘルパー（例: `backend/csv_utils.py` の
`csv_safe_cell(v)`）に寄せ、セル値が `=`, `+`, `-`, `@`, タブ, 改行 のいずれかで始まる場合は先頭に
シングルクォート（`'`）を付与してExcel側で文字列扱いにする（OWASP推奨の対策）。**この対策はマスタCRUD
規約に「CSVエクスポートは商品マスタの作法が単一の型」と明記されているため、共通ヘルパー化と同時に
CLAUDE.mdのマスタCRUD規約へ追記するのが望ましい。** 影響範囲: `masters.py`（商品・カテゴリの2エクスポート）、
`targets.py`（数値のみのため実質リスク無し。念のため揃える）、`item_targets.py`（`product_name`）、
`export.py`（既存の商品名・ジャンル名を含む出力）。**今回は指摘のみで実装はしていない**（緊急度が低いため
別チケット化を推奨）。

### 低: 新設CSVインポート（カテゴリ・目標・アイテム別目標）にファイルサイズ上限が無い

`POST /api/master/categories/import` / `POST /api/targets/import` / `POST /api/item-targets/import` は
いずれも `await file.read()` で全量をメモリに読み込んでから処理しており、明示的なサイズ上限が無い。
既存の商品マスタCSVインポート（`masters.py` の商品版）や `import_csv.py` の一部エンドポイントも同様で、
**この診断で新しく生まれたパターンではなく既存の踏襲**。RPP ZIP取込（`import_csv.py`）には
`_ZIP_MAX_MEMBER_SIZE = 50MB` の上限があるのに対し、CSV系エンドポイント群には無い、という非対称が
以前から存在する。`dependencies=_paid` で認証済み・課金済みユーザーのみが到達できるため悪用インセンティブは
低く、緊急性は低いと判断。**継続監視**とし、対応するなら全CSVインポート系エンドポイントへ横断的に
`Content-Length` チェックや `UploadFile` のサイズ制限を導入する設計判断が必要（1エンドポイントだけ直すと
非対称が別の形で残るため）。

## 精査した観点（チェックリスト）

- **RLS**: 今回の42コミットで新規テーブル追加は無し（既存9テーブルへ `is_sample` 列、既存3テーブル
  （`products`/`product_categories`/`targets`）へ `archived_at` 列を追加したのみ）。`migrations._enforce_rls_pg`
  は `pg_tables` を直接走査する実装のため列追加の影響を受けず、維持を確認（コード diff 0件）。
  `py -3 -c "from main import app"` を実行し、起動時マイグレーションが全12箇所の列追加ログと
  「旧サンプルデータ412行にis_sampleを遡及付与しました」を正常に出力することを確認（ローカルSQLite。
  本番Postgresでの `_enforce_rls_pg` の実行結果は範囲外・継続監視）。
- **`UserScopedMixin`**: 変更・追加された全モデル（`RppWeekly`/`MonthlyAnalysis`/`Target`/`MonthlyItemSales`/
  `RppSales`/`ProductCategory`/`Product`/`ProductCost`/`ItemTarget`/`GenreBenchmark`）はいずれも既存の
  `UserScopedMixin` 継承クラスへの列追加であり、継承外れ・新規非継承テーブルは無し。
- **認証と課金ガード**: `main.py` の `app.include_router(...)` 一覧を diff し、`targets` / `item_targets` /
  `masters` は `_paid`、`account` / `billing` / `consulting` / `feedback` は `_auth` のまま変更が無いことを
  確認。新設の `DELETE /api/sample-data` と既存 `POST /api/sample-data` / `POST /api/reset-data` は
  いずれも `get_current_user` + `require_active_subscription` を明示的に付与。
- **Stripe**: `backend/billing.py` / `backend/routers/billing.py` は前回チェック以降 diff 0件
  （`git diff f22a854..main --stat` で無出力）。`stripe.Webhook.construct_event` 使用箇所（署名検証）、
  `EXEMPT_TEST_EMAILS` 既定空、`TRIAL_WITHOUT_CARD` 既定オフを再確認し、いずれも退行なし。
- **SPA配信**: `backend/main.py` の `_serve_spa` / `_FRONTEND_DIST_REAL`（realpathチェック）は
  diff 0件で維持。
- **例外ハンドラ**: `global_exception_handler` は diff 0件。`EXPOSE_ERROR_DETAIL` 環境変数が立っていない
  限り `detail` を固定文言にする実装を維持。
- **セキュリティヘッダー**: `_CONTENT_SECURITY_POLICY` に `script-src 'self'` が含まれることを確認（diff 0件）。
  LP（`lp/`）は別配信（backendのStaticFiles/SPAフォールバックの対象外）のため、LP全面刷新で追加された
  Google Fonts（`fonts.googleapis.com`/`fonts.gstatic.com`）・GTM（`googletagmanager.com`）はアプリ側CSPの
  対象外。アプリ側フロントの参照先に変更は無く、CSPの `connect-src`（Supabase由来を実行時導出）にも
  影響なし。
- **入力上限**: `consulting.py` は diff 0件で維持。新設CSV系（上記「新規指摘」参照）はファイルサイズ上限
  無しだが `_paid` ガード配下。
- **CSVインジェクション**: 上記「新規指摘」参照（中）。
- **オープンリダイレクト**: 変更差分中に `location.href`/`location.assign`/`window.open` の新規使用なし
  （`git diff` grepで0件）。`LEGAL_LINKS` 等の外部リンク経路に変更なし。
- **秘密情報の残置**: `git diff f22a854..main` 全体を `sk_live|sk_test|whsec_|SUPABASE_SERVICE_ROLE|
  BEGIN PRIVATE KEY|AKIA...|password=` 等でgrepし0件。新設の `.claude/agents/*.md` / `.claude/skills/*/SKILL.md`
  にも実値の秘密情報は無く、`sk_live_` 等はプレフィックスの説明としての言及のみ（値なし）。
- **`.gitignore` の変更（`e4363f3`）**: `.claude/skills/` の除外範囲を `design-system/` のみへ縮小。
  `.env` / `.env.*` の行は変更なし。新設5スキル（`kickoff`/`jisso-keikaku`/`release-check`/
  `security-check`/`price-check`）の `SKILL.md` は今回追跡対象になったが、中身は社内運用手順の
  Markdownのみで秘密情報は含まない（grep確認済み、上記参照）。意図しない追跡緩和なし。

## 範囲外・継続監視（静的レビューで確認できないもの）

- 本番Render環境変数（`EXEMPT_TEST_EMAILS`・`TRIAL_WITHOUT_CARD`・`STRIPE_WEBHOOK_SECRET`・
  `SUPABASE_SERVICE_ROLE_KEY` 等）の実際の設定値。
- 本番Postgres（Supabase）での `_enforce_rls_pg` の実行結果・`GET /api/security-status` の
  `unprotected` 実測（ローカルSQLiteでのimport確認のみ実施）。
- 本番CSPヘッダーの `connect-src` に実際のSupabaseオリジンが入っているかの最新実測（前回2026-08-18に
  確認済み、今回はCSP関連コード自体に変更が無いため再実測はしていない）。
- `security/index.md` 冒頭の「プロジェクトdocs側に同名のマスター文書が別途存在する」問題の
  同期/削除判断（指示どおり今回も判断・対応せず、注記はそのまま維持）。

## 実行したコマンドと結果

```
$ git log --oneline f22a854..main | wc -l
42

$ cd frontend && npm audit --package-lock-only
found 0 vulnerabilities

$ cd backend && pip-audit -r requirements.txt
（pip-auditは本環境に未インストールだったため py -3 -m pip install pip-audit で導入した上で実行）
No known vulnerabilities found

$ cd backend && py -3 -c "from main import app; print('OK', len(app.routes))"
OK 107
（起動時マイグレーションのログ出力・エラー無しを確認。RLS強制ロジックの健全性を間接確認）

$ cd frontend && npm run build
tsc型エラー0、vite build成功（chunk size警告のみ・機能影響なし）

$ git diff f22a854..main -- . | grep -inE "sk_live|sk_test|whsec_|SUPABASE_SERVICE_ROLE|BEGIN PRIVATE KEY|AKIA[0-9A-Z]{16}|password\s*=\s*['\"]"
（該当なし）
```

## 追記: 同日追加チェック（6ca14cf..HEAD、9コミット）

本チェック確定（`6ca14cf`）後、同日中に追加コミットが積まれたため、`6ca14cf..HEAD`（`c1e22d5`、
9コミット）を対象に差分確認を実施した。

### 対象コミット

```
a4bee98 社内マップ（家臣団の可視化）を導入、4万SKU実測の延期を記録
e4c34ed render.yaml削除（実在しない旧サービスの定義）、Render目視結果を記録
15eaf9c Merge pull request #39 from Shoichiro12/claude/filesv4-zip-fa3147
23fc74a 旧Vercelプロジェクト削除を記録、軍令帳を更新
f20b9c0 夜勤体制（定期実行ルール）を導入、既存Coworkルーチンの重複を発見・無効化
ae5db1e sellerhub側4週分との突き合わせで記録漏れ2件を発見・訂正、無効化手順の反省を記録
6a272f6 security/index.md遡及反映は不要と決定、sellerhub側遺物の宿題を記録、yakin.mdの初週縛りを明文化
ab24d0f Merge pull request #41 from Shoichiro12/claude/yakin-routines
c1e22d5 Merge pull request #40 from Shoichiro12/claude/vercel-cleanup-office-map
```

### 変更ファイル（`git diff 6ca14cf..HEAD --stat`）

```
 .claude/commands/yakin.md |  39 ++++
 CLAUDE.md                 |  31 ++-
 DEPLOY.md                 |   4 +-
 docs/office_map.html      | 487 ++++++++++++++++++++++++++++++++++++++++++++++
 render.yaml               |  37 ----
 5 files changed, 557 insertions(+), 41 deletions(-)
```

**バックエンド・フロントエンドのソースコード（`backend/`・`frontend/src/`）に変更は無い。**
ドキュメント・運用設定のみの差分のため、依存パッケージにも変更なし。

### 結論サマリ

- **重大度「高」の新規指摘は無し。**
- 新規指摘（低〜中を含む）も無し。
- 前回（`6ca14cf`確定分）の未解決2件（CSVインジェクション対策欠如＝中／新設CSVインポートのサイズ
  上限欠如＝低）は、対象ファイル（`backend/routers/masters.py` / `targets.py` / `item_targets.py` /
  `export.py`）がこの9コミットの変更範囲に含まれておらず、**変化なし（維持）**。

### 個別確認

**(1) `render.yaml` 削除**: 実在しない旧Renderサービス（`plan: free`・サービス名`rakuten-kpi-app`、
稼働中の実サービス`rakuten-kpi-app-sg`とは名称・プランとも不一致）の定義を削除。**削除前の内容に
実値の秘密情報は含まれていなかった**（`DATABASE_URL`等はすべて`sync: false`でダッシュボード入力の
env変数名の言及のみ、値は無し）。削除後も`DEPLOY.md`が手動Web Service作成手順に更新されており、
参照切れは無い。セキュリティ上のリスクなし（むしろ実態と食い違うBlueprint定義を除去した点で改善）。

**(2) `DEPLOY.md` / `CLAUDE.md` の記述更新**: Blueprint運用からWeb Service手動作成への手順修正、
「🌙 夜勤の掟」節の新設、申し送り台帳への記録追加。差分全体を`sk_live|sk_test|pk_live|whsec_|
SUPABASE_SERVICE_ROLE|password|secret|token|api[_-]?key|BEGIN (RSA|PRIVATE)`でgrepし、実値の
秘密情報の記載は無し（`SUPABASE_JWT_SECRET`等はいずれも既存パターンと同じ「env変数名の言及」の
みで値は含まない）。プロジェクトref・APIキー等の露出も無し。

**(3) `.claude/commands/yakin.md`（無人自動実行の権限指示）新規**: 内容を精査した結果、危険な
権限拡大の記述は無い。むしろ制約列挙が中心:
  - 「mainへのpush・マージは絶対に行わない」（10番）
  - 「本番環境変数、Stripe設定、Render/Supabase/Cloudflareのダッシュボード」に触れない（「触っては
    いけないもの」節）
  - 「価格・法的文面」「退会・解約・削除など破壊的操作を伴う実装」は明示的に対象外
  - 導入初期は「コード変更禁止。調査・ドキュメント・実装計画の下書きのみ」に明示的にスコープ限定
    されており、解除にはCLAUDE.md台帳への記録が必要という手続きが明文化されている
  この文書自体はプロンプト（実行時の振る舞い指示）であり、実際の権限（ツールアクセス・ファイル
  書き込み範囲）を変更するものではない。**CLAUDE.md「🌙 夜勤の掟」節と整合しており、逸脱なし。**

**(4) `docs/office_map.html`（487行・新規）**: 自己完結の静的HTML（外部フレームワーク依存なし、
インラインJS）。以下を確認した。
  - **外部通信**: `<link>`によるGoogle Fonts（`fonts.googleapis.com` / `fonts.gstatic.com`）の
    読み込みのみ。`fetch` / `XMLHttpRequest` / `WebSocket` / `<img src="http...">` 等の外部への
    データ送信経路は**0件**（grep確認済み）。フォント読み込みはリクエストURLにクエリパラメータや
    ユーザー入力を含まない固定URLで、情報送信のリスクなし。
  - **XSS**: `innerHTML`を9箇所で使用しているが、**すべて同一ファイル内にハードコードされた
    JS定数（`STATUS` / `AGENTS` / `QUESTS`配列）を描画しているだけ**で、外部入力・URLパラメータ・
    `localStorage`・Cookie等の動的/信頼できない入力源は一切参照していない。実質的にテンプレート
    リテラルによる静的レンダリングであり、攻撃者が値を注入する経路が存在しない（あるとすれば
    「このファイル自体を直接書き換えられる」ケースのみで、その場合はXSS以前にリポジトリへの
    書き込み権限を握られている）。
  - **配信経路**: `backend/main.py`を確認したところ、静的配信は`frontend/dist`（`/assets`への
    `StaticFiles`マウント）とSPAフォールバックのみで、リポジトリ直下の`docs/`ディレクトリは
    アプリからマウント・配信されていない。**本ファイルはWebアプリの一部として公開される経路が無く、
    開発者がローカルでブラウザに直接開く用途に限定される。** 外部攻撃面としては評価対象外。
  - **秘密情報**: 実名・メールアドレス・APIキー・トークン等の記載なし（社内の役割名・エージェント
    名・進捗ステータスのみ）。

### 実行したコマンドと結果

```
$ git log --oneline 6ca14cf..HEAD
（9コミット。上記「対象コミット」参照）

$ git diff 6ca14cf..HEAD --stat
（5ファイルのみ。上記「変更ファイル」参照。backend/・frontend/src/への変更なし）

$ git diff 6ca14cf..HEAD | grep -iE "sk_live|sk_test|pk_live|whsec_|SUPABASE_SERVICE_ROLE|password|secret|token|api[_-]?key|BEGIN (RSA|PRIVATE)"
（env変数名の言及のみ。実値の秘密情報なし）

$ grep -n "http://\|https://\|<script\|src=\|fetch(\|XMLHttpRequest\|eval(\|innerHTML\|document.write" docs/office_map.html
（Google Fontsのlink 3件＋innerHTML 9件。いずれも同一ファイル内のハードコード定数の描画。外部送信APIの使用なし）

$ grep -n "docs/\|StaticFiles\|mount(" backend/main.py
（docs/ディレクトリのマウント・配信は無し。/assetsのみ）

$ cd frontend && npm audit --package-lock-only
found 0 vulnerabilities

$ cd backend && python3 -m pip_audit -r requirements.txt
No known vulnerabilities found
```

（バックエンドコード自体に変更が無いため`from main import app`の再実行は本チェックの必須事項では
ないと判断し省略。前回`6ca14cf`確定時点の実測結果が有効なまま。）

### 結論

**9コミットすべてドキュメント・運用設定の追加/更新であり、コード上のセキュリティリスクは
確認されなかった。前回（`6ca14cf`）確定分の指摘事項（未解決2件含む）に変化はない。**
