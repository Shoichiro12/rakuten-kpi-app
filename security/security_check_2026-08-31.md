# セキュリティチェック 2026-08-31（週次定例・無人/定期routineからの実行）

対象範囲: 前回チェック（2026-08-24、`security/security_check_2026-08-24.md` 本体分
`f22a854..main` 42コミット＋同日追加分 `6ca14cf..HEAD` 9コミット、確定コミット `8cb4fe6`）
以降の **`8cb4fe6..611df97`（89コミット）**。管理者閲覧機能・無償提供（comp）管理・
マスタ削除の一括化・LPエッセイ型全面刷新の後続対応・夜勤/巡回運用の定着が中心。

## 結論サマリ

- **重大度「高」の新規指摘は無し。**
- 前回の未解決2件を再確認した。
  - CSVエクスポートのCSVインジェクション対策欠如（中）… **前回チェック後の2026-08-27に実装・
    本番実測まで完了しクローズ済み**（`security/index.md` 既存記録どおり）。今回はこれが
    **退行していないか**を実測し、**退行なし**を確認（後述）。
  - 新設CSVインポート3本のファイルサイズ上限欠如（低）… 今回の89コミットで新しいCSVインポート
    エンドポイントの追加は無く、**対象・状態とも変化なし（継続監視）**。
- 今回の主眼である**管理者閲覧機能**（アカウント一覧・view-as閲覧モード）と**無償提供（comp）
  管理**は、コードレビューに加えてローカルで実際にJWTを発行し（自作HS256トークン・
  `SUPABASE_JWT_SECRET`/`ADMIN_USER_ID` を設定した実サーバーへのHTTPリクエスト）、以下の
  境界条件を**すべて実測で確認した**。想定どおりの拒否・許可が得られ、**新規の高/中指摘なし**。
  - 非管理者トークンでの `/api/admin/*` アクセス → 403
  - 管理者トークンでの `/api/admin/accounts` `/api/admin/comp-grants` アクセス → 200
  - 閲覧モード中（`X-Admin-View-Session` ヘッダあり）の GET → 200（対象ユーザーのデータ）
  - 閲覧モード中の POST（`/api/targets` 等、通常API） → 403「閲覧モードは読み取り専用です」
  - 閲覧モード中の comp 付与操作（`POST /api/admin/comp-grants`） → 403
    「閲覧モード中は無償提供の操作はできません」（`require_admin_write` が個別に効いている）
  - 管理者資格を偽った `X-Admin-View-Session` ヘッダ（非管理者トークン＋ヘッダ） → 403
  - 不正・存在しない閲覧トークン → 401「閲覧セッションが無効です」
  - **期限切れの閲覧セッション（DBへ直接期限切れ行を挿入して検証）→ 401**（自動失効が実際に効く）
  - comp 状態のユーザーが `POST /api/billing/checkout` を叩く → **409で拒否**（Stripe Session
    作成前に遮断。二重取り防止のコードが実際に機能）
  - comp 付与後、対象ユーザーの `billing_status()` 呼び出しで先行登録（`CompGrant.target_user_id
    IS NULL`）が正しく解決され `status: "comp"` になることを実測
  - note（付与理由）を空で送信 → 400（422のバリデーションエラー形式ではなく、想定どおり
    文字列detailの400）
- 新規テーブル `AdminViewSession` / `CompGrant` はいずれも `UserScopedMixin` 継承・
  `migrations._USER_SCOPED_TABLES` に登録済み。`_enforce_rls_pg()` はテーブル名非依存の
  `pg_tables` 走査実装のため、これら含め自動的にRLS対象になる（コードレビューで確認、
  ローカルSQLiteでは `applicable: false` のため本番Postgresでの実測は範囲外）。
- `npm audit --package-lock-only` … **0件**。`pip-audit` … **0件**（本環境に未インストールの
  ため `pip install pip-audit` で導入）。
- CSVインジェクション対策（`backend/csv_utils.py::csv_safe_cell()`）は `masters.py` /
  `item_targets.py` / `export.py` の4箇所すべてで健在。`targets.py` は引き続き対象外
  （数値列のみ・docstringに理由明記）。**退行なし。**
- 秘密情報の残置なし（`ADMIN_USER_ID` の `.env.example` はプレースホルダUUIDのみ）。

## 前回指摘のフォローアップ

| 指摘 | 前回状態（2026-08-24時点） | 今回の確認 | 判定 |
|---|---|---|---|
| CSVエクスポート（商品名・カテゴリ名）にCSVインジェクション対策が無い | 中・未解決 | 2026-08-27に `csv_safe_cell()` を4箇所へ適用・本番実測まで完了しクローズ済み（`security/index.md` 既存記録）。今回は退行確認のみ実施 → `masters.py`（カテゴリ・商品export）・`item_targets.py`・`export.py` の4箇所とも `csv_safe_cell()` 呼び出しが健在（grep確認）。`targets.py` も docstring の対象外明記が維持 | ✅ 維持（クローズ済み、退行なし） |
| 新設CSVインポート3本（カテゴリ・目標・アイテム別目標）にファイルサイズ上限が無い | 低・継続監視 | `masters.py::import_categories` / `targets.py::import_targets` / `item_targets.py::import_item_targets` とも `await file.read()` に変更なし。今回の89コミットで新規CSVインポートエンドポイントの追加なし | 継続監視（変化なし） |
| npm audit: react-router系（前々回解決） | 解決済み | `npm audit --package-lock-only` で再実測 → 0件 | 維持 |
| CSPヘッダー（前々回解決） | 解決済み | `backend/main.py` の `_CONTENT_SECURITY_POLICY` に diff なし、`script-src 'self'` 健在 | 維持 |

## 新規指摘

**該当なし（高・中・低とも新規指摘0件）。**

以下は「指摘」ではないが、次回以降の参考として記録する。

### 参考: 既に `docs/gunrei_kouho.md` に記録済みの軽微な文書不整合（重複報告しない）

巡回対象と重なる領域のため、今回のチェックで独自に発見しかけたが、既に候補として記録されて
いることを確認したため新規指摘としては起票しない（重複回避）。

- `backend/.env.example:29` の `ADMIN_USER_ID` コメントが「GETのみ保護」と書かれているが、
  実際は `require_admin_write` 経由で comp 管理の書き込みAPI（付与・解除）も同じUUID判定で
  保護されている（コメントが2026-08-28のcomp機能追加に追随していない）。**セキュリティ上の
  実害はない**（保護自体は実装済み・今回の実測でも確認済み。コメントの説明不足のみ）。
  候補一覧に2026-08-28付で記載済み・未昇格。
- `backend/routers/admin.py` 等の日時が `datetime.utcnow()`（naive UTC）でシリアライズされる
  設計負債。フロント `parseServerDate()` で対症療法済み。候補一覧に2026-08-28付で記載済み。

これらはオーナー裁可（昇格/却下）待ちの項目であり、本チェックのスコープ外として扱う
（`docs/gunrei_kouho.md` の運用ルールに従う）。

## 精査した観点（チェックリスト）

- **RLS**: 新規テーブルは `AdminViewSession`・`CompGrant` の2つのみ。両方 `UserScopedMixin` を
  継承し、`migrations._USER_SCOPED_TABLES` に登録済み（ユニーク制約なしの空リストとして。
  理由はモデルのdocstringに明記）。`_enforce_rls_pg()` はテーブル名非依存の実装のため自動的に
  RLS対象化される（コードdiffなし、ロジック健在）。
- **管理者判定**: `admin_guard.is_admin_user_id()` は環境変数 `ADMIN_USER_ID`（JWT検証済みの
  `user.id`＝`sub`のみで判定）。リクエストボディ・ヘッダ値からの入力は一切判定に使わない
  （実測: 非管理者トークン＋偽装ヘッダは403「管理者権限がありません」）。
- **閲覧モード（読み取り専用）の強制**: `auth.py::UserContextMiddleware` が `X-Admin-View-Session`
  ヘッダを検証し、GET/HEAD/OPTIONS以外は403で即終了（アプリ本体を呼ばない）。この除外は
  `path.startswith("/api/admin")` のときのみ働かない設計だが、comp管理の書き込みAPI
  （`/api/admin/comp-grants` 系）は `admin_guard.require_admin_write` が同じヘッダを個別に
  再チェックして403にする二段構え。**両方を実測し、抜け穴が無いことを確認**（新設の
  `require_admin_write` が意図どおり機能している）。閲覧セッション自体の開始・終了API
  （`/api/admin/view-sessions*`）は閲覧モード中でも動作する必要があるため意図的に対象外
  （デッドロック回避、コメントに明記済み・実装と整合）。
- **comp状態の二重取り防止**: `routers/billing.py::create_checkout()` の先頭、Stripe API呼び出し
  より前に `Subscription.status == "comp"` を検査し409で拒否することを実測（Stripe側の
  `checkout.Session.create` は呼ばれない設計）。`_ACTIVE_STATUSES` / `subscription_guard.
  ACTIVE_STATUSES` とも `"comp"` を含み機能ロックは通過するが、`account.py::_BLOCKING_SUB_
  STATUSES` には含まれないため退会はブロックしない（設計どおり）。退会時に `CompGrant` を
  連動解除する処理（生SQLでtenancyを迂回して該当メール/ user_idの行を revoke）も健在。
- **CompGrant の tenancy**: 付与操作で新規 `Subscription` 行を作る際、`current_user_id.set()`
  を使って対象ユーザーのコンテキストへ一時切替してから `user_id` を明示指定している
  （`Subscription(user_id=target_user_id)`）。過去に発覚した「誤って管理者自身に帰属する」
  バグ（PR #72で修正済み）は今回のコードにも修正が反映済みであることをコードで確認
  （`before_flush` の自動スタンプに任せない実装になっている）。
- **認証と課金ガード**: `main.py` の `_admin = _auth + [Depends(require_admin)]` を
  `admin.router` / `admin_comp.router` の両方に付与。`_paid` グループ（`masters` /
  `targets` / `item_targets` / `export`）に変更なし。
- **Stripe**: `stripe.Webhook.construct_event` 使用箇所（署名検証）に diff なし。
  `EXEMPT_TEST_EMAILS` 既定空・`TRIAL_WITHOUT_CARD` 既定オフ、いずれも維持。
- **SPA配信**: `_serve_spa` / `_FRONTEND_DIST_REAL`（realpathチェック）に diff なし。
- **例外ハンドラ**: `global_exception_handler` / `EXPOSE_ERROR_DETAIL` に diff なし。
- **セキュリティヘッダー**: `_CONTENT_SECURITY_POLICY` の `script-src 'self'` を含む全体に
  diff なし。
- **入力上限**: comp付与の `email`/`note` は手動チェック（空文字・`@`なしを400で拒否）。
  文字数上限は明示的には無い（`note` は自由記述、社内の少人数運用でDoS的実害は小さいと
  判断。念のため次回以降の検討事項として記録するに留める＝低優先度）。
- **CSVインジェクション**: 上記フォローアップ表のとおり退行なし。
- **オープンリダイレクト**: 新規追加された `window.location.href = '/admin'`（`AdminAccounts.tsx`
  ／閲覧セッション開始後の遷移）は固定文字列パスであり、ユーザー入力やクエリパラメータに
  由来しない。オープンリダイレクトのリスクなし。
- **秘密情報の残置**: `git diff 8cb4fe6..HEAD` 全体を `sk_live|sk_test|pk_live|whsec_|
  SUPABASE_SERVICE_ROLE|BEGIN (RSA|PRIVATE)|AKIA[0-9A-Z]{16}|password\s*=\s*['\"]` でgrepし
  該当なし。`backend/.env.example` に追加された `ADMIN_USER_ID` はプレースホルダUUID
  （`11111111-2222-3333-4444-555555555555`）のみで実値なし。

## 実行したコマンドと結果

```
$ git log --oneline 8cb4fe6..HEAD | wc -l
89

$ cd frontend && npm install && npm audit --package-lock-only
found 0 vulnerabilities

$ cd frontend && npm run build
tsc型エラー0、vite build成功

$ cd backend && pip install -r requirements.txt -q && pip install pip-audit -q && pip-audit -r requirements.txt
No known vulnerabilities found

$ cd backend && python3 -c "from main import app; print('OK')"
OK
（このFastAPI/starletteバージョンでは include_router() のルートが _IncludedRouter として
ラップされ app.routes 直下には現れないが、import自体は成功しエラーなし。実機能確認は
下記の実サーバー起動テストで実施）

# 実サーバー起動＋自作HS256 JWTでの境界テスト（venv環境、SUPABASE_JWT_SECRET・ADMIN_USER_ID設定）
$ curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8124/api/admin/accounts            # トークン無し
401
$ curl ... -H "Authorization: Bearer $USER_TOKEN" .../api/admin/accounts                        # 非管理者
403
$ curl ... -H "Authorization: Bearer $ADMIN_TOKEN" .../api/admin/accounts                       # 管理者
200 {"accounts":[],"configured":false,"count":0}
$ curl ... -H "Authorization: Bearer $USER_TOKEN" -X POST .../api/admin/comp-grants             # 非管理者の付与試行
403
$ curl ... -H "Authorization: Bearer $ADMIN_TOKEN" -X POST .../api/admin/comp-grants \
    -d '{"email":"user@example.com","note":"test grant"}'                                       # 付与（先行登録）
200 {"target_user_id":null,"resolved":false,...}
$ curl ... -H "Authorization: Bearer $ADMIN_TOKEN" -X POST .../api/admin/comp-grants \
    -d '{"email":"foo@example.com","note":""}'                                                  # note空
400 {"detail":"付与理由（note）を入力してください。"}
$ curl ... -H "Authorization: Bearer $USER_TOKEN" .../api/billing/status                         # 先行登録の解決
200 {"status":"comp","is_active":true,...}
$ curl ... -H "Authorization: Bearer $USER_TOKEN" -X POST .../api/billing/checkout               # comp中のcheckout
409 {"detail":"無償提供の適用中のため、お支払い手続きは不要です。"}
$ curl ... -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Admin-View-Session: <有効トークン>" \
    .../api/dashboard?period=weekly                                                              # 閲覧モードGET
200
$ curl ... -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Admin-View-Session: <有効トークン>" \
    -X POST .../api/targets                                                                       # 閲覧モードPOST
403 {"detail":"閲覧モードは読み取り専用です。保存・削除はできません。"}
$ curl ... -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Admin-View-Session: <有効トークン>" \
    -X POST .../api/admin/comp-grants -d '{"email":"z@z.com","note":"x"}'                        # 閲覧モード中のcomp操作
403 {"detail":"閲覧モード中は無償提供の操作はできません。閲覧を終了してから操作してください。"}
$ curl ... -H "Authorization: Bearer $USER_TOKEN" -H "X-Admin-View-Session: <有効トークン>" \
    .../api/dashboard?period=weekly                                                               # 非管理者が偽装ヘッダ
403 {"detail":"管理者権限がありません。"}
$ curl ... -H "Authorization: Bearer $ADMIN_TOKEN" -H "X-Admin-View-Session: not-a-real-token" \
    .../api/dashboard?period=weekly                                                                # 不正トークン
401 {"detail":"閲覧セッションが無効です。再度開始してください。"}
$ (DBへ期限切れセッション行を直接INSERTしてから) curl ... -H "X-Admin-View-Session: expired-token-xyz" \
    .../api/dashboard?period=weekly                                                                # 期限切れ
401 {"detail":"閲覧セッションが無効です。再度開始してください。"}

$ grep -n csv_safe_cell backend/routers/{masters,item_targets,export,targets}.py backend/csv_utils.py
（4箇所とも健在。上記フォローアップ表参照）

$ git diff 8cb4fe6..HEAD | grep -inE "sk_live|sk_test|pk_live|whsec_|SUPABASE_SERVICE_ROLE|BEGIN (RSA|PRIVATE)|AKIA[0-9A-Z]{16}|password\s*=\s*['\"]"
（該当なし）
```

## 範囲外・継続監視（静的レビュー・ローカル実測で確認できないもの）

- 本番Render環境変数（`ADMIN_USER_ID`・`EXEMPT_TEST_EMAILS`・`TRIAL_WITHOUT_CARD`・
  `STRIPE_WEBHOOK_SECRET`・`SUPABASE_SERVICE_ROLE_KEY` 等）の実際の設定値。
- 本番Postgres（Supabase）での `_enforce_rls_pg` 実行結果・`GET /api/security-status` の
  `unprotected` 実測（今回はローカルSQLite。`applicable: false` のため本番Postgresでの
  確認が必要。管理者閲覧機能・comp管理はいずれも本番デプロイ済み・実機確認済みと
  CLAUDE.md申し送りに記録があるため実害は低いと判断するが、静的レビューの限界として明記）。
- Supabase Admin API（`supabase_admin.list_users()` 等）の本番動作。ローカルでは
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` 未設定のため `admin_configured() == False` の
  経路（`configured: false` 応答）のみ実測。本番相当の分岐（実際にSupabase Auth APIを叩く
  経路）はコードレビューのみ。
- `security/index.md` 冒頭のプロジェクトdocs側マスター文書に関する既知の経緯は継続事項なし
  （2026-08-24に判断確定済み、今回の変更なし）。

## 総括

新規指摘は**高0件・中0件・低0件**。前回の未解決2件のうち、CSVインジェクション対策（中）は
前回チェック後に実装・本番実測まで完了しクローズ済みであることを確認し、退行もなし。
新設CSVインポートのファイルサイズ上限欠如（低）は対象範囲に変更が無く継続監視のまま。
今回重点確認とした管理者閲覧機能・無償提供（comp）管理は、権限境界・読み取り専用強制・
Stripe二重取り防止・tenancy分離のすべてで設計どおりの挙動を実測確認でき、新規のセキュリティ
上の問題は見つからなかった。
