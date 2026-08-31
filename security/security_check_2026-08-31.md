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
- ~~本番Postgres（Supabase）での `_enforce_rls_pg` 実行結果・`GET /api/security-status` の
  `unprotected` 実測（今回はローカルSQLite。`applicable: false` のため本番Postgresでの
  確認が必要）~~ → **2026-08-31追記で解消。** オーナーが本番で実測し `comp_grants`・
  `admin_view_sessions` を含む20テーブルが `protected`・`unprotected` 空・`ok: true` を確認した。
  詳細は本ファイル末尾「追記（2026-08-31）」節の①を参照。
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

---

## 追記（2026-08-31、オーナー指摘を受けた「0件の根拠」追加）

初回提出版（上記本文）はPR #79としてオーナーへ提示したところ、「高0・中0・低0という結論が、
実際に読まれた上での0件なのか、diff範囲の指定漏れや『既存パターンの踏襲だから』で流れた0件
なのか分からない」という指摘を受けた。具体的に3点の根拠不足を指摘され、確認したところ**3点とも
実際に不足していた**（詳細は各節）。以下、3点それぞれの根拠を追加する。この経緯を踏まえ、
`.claude/skills/security-check/SKILL.md` に「差分カバレッジ節（必須）」を新設し、次回以降は
この追記のような後追い作業ではなく初回提出時点で満たすようにした（詳細は本ファイル末尾の
差分カバレッジ表を参照）。

### ① `GET /api/security-status` の本番実測（オーナー実施、2026-08-31）

初回提出版では「ローカルSQLiteでは `applicable: false` のため本番Postgresでの実測は範囲外」と
明記していたが、結論サマリでは「これら含め自動的にRLS対象になる」と断定形で書いており、
**本番での実測なしに断定していた**のは根拠不足だった。

このセッションからは本番URLへの疎通ができない（CLAUDE.md「セッション環境の注意」節）ため、
オーナーがログイン済みブラウザのページ内fetchで直接実施した（手順を
`docs/unyou_cowork_honban_kakunin_2026-08-29.md`に追記済み）。結果:

```
HTTP 200
applicable: true
ok: true
protected: 20テーブル（comp_grants・admin_view_sessions を含む）
unprotected: []（空）
```

これにより、管理者閲覧機能・comp管理の新規テーブル（`AdminViewSession`/`admin_view_sessions`・
`CompGrant`/`comp_grants`）が本番Postgresで実際にRLS保護対象になっていることが実測で確定した。
コードレビューでの推論（`_enforce_rls_pg()`はテーブル名非依存の`pg_tables`走査のため自動対象化
される）は、この実測で裏付けられた。**comp管理計画書§13区切り5のチェックリスト⑥
（`docs/honban_kakunin_comp_management_ku5_2026-08-28.md`）はこの結果をもって完了とした。**

### ② `/api/admin/comp-grants` 3エンドポイントの構成をコードで確認し、妥当性を評価

`backend/routers/admin_comp.py` を読むと、3エンドポイントの依存関係は次のとおり:

| エンドポイント | 依存関係 |
|---|---|
| `GET /comp-grants`（一覧） | `Depends(require_admin)` のみ |
| `POST /comp-grants`（付与） | `Depends(require_admin_write)` |
| `POST /comp-grants/{grant_id}/revoke`（解除） | `Depends(require_admin_write)` |

`require_admin_write`（`backend/admin_guard.py`）は内部で`require_admin`に依存したうえで、
リクエストヘッダに`X-Admin-View-Session`が付いていれば無条件403にする（トークンの有効性は
見ず、ヘッダの有無だけで遮断する設計）。

**妥当性の評価（1段落）**: 一覧（GET）を`require_admin`のみに留め`require_admin_write`を
付けていないのは意図的で妥当である。理由は、管理者が閲覧モード中に一覧を読むこと自体は
「対象アカウントのデータを読み取り専用で見る」という閲覧モードの目的と衝突しない
（`auth.py::UserContextMiddleware`が`/api/admin/*`を読み取り専用強制の対象外にしているのと
整合する設計判断）。一方、付与・解除という状態変更操作は、閲覧モード中に管理者が「今どの
アカウントを操作しているか」を見失いやすい状況で実行させるべきではなく、`require_admin_write`
による二段目の遮断が意味を持つ。**GETとPOSTで別の依存を割り当てる非対称な構成は、
「読み取りは閲覧モードと衝突しないが書き込みは衝突する」という業務上の性質の違いを
そのまま反映しており妥当。**

**閲覧モード中の解除（revoke）が403になることをローカル実測で追加確認**（初回提出版は付与
のみ実測、解除は未実測だった）。自作HS256 JWTでローカルサーバーを起動し、有効な閲覧セッション
トークンをDBへ直接発行、既存のCompGrantを用意して確認:

```
$ curl -H "Authorization: Bearer $TOKEN_A" "$BASE/api/admin/comp-grants"                                    # 通常のGET
200 {"grants":[{"id":1,...}]}

$ curl -H "Authorization: Bearer $TOKEN_A" -H "X-Admin-View-Session: $VIEW_TOKEN" "$BASE/api/admin/comp-grants"   # 閲覧モード中のGET
200 {"grants":[{"id":1,...}]}   # 一覧は閲覧モード中でも読める（設計どおり）

$ curl -H "Authorization: Bearer $TOKEN_A" -H "X-Admin-View-Session: $VIEW_TOKEN" -X POST "$BASE/api/admin/comp-grants/1/revoke"   # 閲覧モード中の解除
403 {"detail":"閲覧モード中は無償提供の操作はできません。閲覧を終了してから操作してください。"}

$ curl -H "Authorization: Bearer $TOKEN_A" -X POST "$BASE/api/admin/comp-grants/1/revoke"   # 閲覧モード外の解除
200 {"id":1,...,"revoked_at":"2026-08-31T03:54:33.879616",...}
```

一覧（GET）・付与（POST）・解除（POST）の3本すべてで、想定どおりの拒否・許可を実測確認した。

### ③ 一括削除API2本（カテゴリ・商品）のtenancy分析

**コードでの経路確認**: `backend/tenancy.py::_apply_user_scope`は`do_orm_execute`イベントに
登録されており、`execute_state.is_select`/`is_update`/`is_delete`のいずれかであれば
**WHERE句の中身に関わらず**`with_loader_criteria(UserScopedMixin, lambda cls: cls.user_id == uid, ...)`
を無条件に適用する。これは「特定の絞り込み条件を検知して有効化する」実装ではなく、
「`UserScopedMixin`を継承したモデルに対するORM実行そのものを横取りしてWHERE句を追加する」
実装のため、`.filter(id.in_(...))`のようなIN句を伴うクエリであっても対象から除外されない。

`backend/routers/masters.py`の2つの一括削除エンドポイントを確認すると、いずれも標準の
SQLAlchemy ORM Query（`db.query(Model).filter(Model.xxx.in_(ids), ...).all()`および`.update()`）
を使っており、生SQL（`text()`。tenancyの自動絞り込みを受けない既知の抜け道）は使っていない:

- `bulk_delete_products()`: `db.query(Product).filter(Product.management_no.in_(mnos), Product.archived_at.is_(None)).all()`
- `bulk_delete_categories()`: `db.query(ProductCategory).filter(ProductCategory.id.in_(payload.ids), ProductCategory.archived_at.is_(None)).all()`（＋紐づく商品の`category_id`を`None`にする`db.query(Product).filter(...).update(...)`も同様にORM経由）

したがって理論上は、他テナントのIDやmanagement_noをリクエストに混入させても、ORMクエリの
時点で`user_id`スコープが追加され、対象から静かに除外される設計になっている。

**PR #75マージ前レビューでの既存実証（2026-08-29、コミット`7b3dde2`）**: この設計どおりに
動くことは、実装直後の追加qa検証で既に実行によって確認されている。2ユーザー分の自作HS256
トークンを用意し、①own+他ユーザーID混在②**同一management_noが別ユーザーに実在する最も
厳しいケース**（`products`のユニーク制約が`user_id`込みのため合法な状態）の2パターンで、
他ユーザーの行が一切削除されないことを確認済み（詳細は`docs/sagyou_houkoku_yakin_2026-08-28.md`
「追加検証（2026-08-29）」節）。

**今回のセキュリティチェックでの再実行（2026-08-31）**: 上記の実証が退行していないかを、
独立した新しいローカル環境で再現した。認証を有効化したuvicorn（ポート8177）を起動し、
2ユーザー分のHS256トークンとサブスクリプション行を用意、以下3パターンを再実行した:

| パターン | 操作 | 結果 |
|---|---|---|
| カテゴリ: own(id=1)+他ユーザー(id=2)混在 | Aが`{"ids":[1,2]}`で一括削除 | `{"requested":2,"deleted_ids":[1],"detached_products":1}`。Bの`id=2`は無傷（B側トークンで一覧確認） |
| 商品: own(QA-A-002)+他ユーザー(QA-B-001)混在 | Aが両方を指定して一括削除 | `{"requested":2,"deleted_management_nos":["QA-A-002"]}`。B側の`QA-B-001`は一覧に残存 |
| **同一management_no「SAME-001」がA・B双方に実在** | Aが`{"management_nos":["SAME-001"]}`で一括削除 | `{"requested":1,"deleted_management_nos":["SAME-001"]}`。DB確認で**Aの行(id=4)のみ`archived_at`が入り、Bの同名行(id=5)は`archived_at`が`NULL`のまま**（B側トークンでの一覧確認でも健在） |

3パターンとも合格。PR #75時点の実証結果と一致し、退行なし。検証用のサーバー・DB・テスト
データはすべて削除済み（コミット対象外）。

### 差分カバレッジ表（今回のチェック全体、追記時点でまとめ）

`.claude/skills/security-check/SKILL.md`「差分カバレッジ節（必須）」を今回のチェック内容へ
遡及適用した表。次回以降はこの表を初回提出時点から書く。

| コンポーネント | 検証方法 | 結果 |
|---|---|---|
| `GET /api/admin/accounts`（非管理者） | ローカル実測 | 403 |
| `GET /api/admin/accounts`（管理者） | ローカル実測 | 200 |
| `POST /api/admin/view-sessions`（開始）〜対象データの閲覧 | ローカル実測（GET系） | 200、対象ユーザーのデータを返す |
| 閲覧モード中の通常API POST（`/api/targets`等） | ローカル実測 | 403 |
| 期限切れ・不正な閲覧セッショントークン | ローカル実測（DB直挿入） | 401 |
| `GET /api/admin/comp-grants`（一覧、`require_admin`のみ） | コードレビュー＋ローカル実測（通常時・閲覧モード中の両方） | 200／200 |
| `POST /api/admin/comp-grants`（付与、`require_admin_write`） | ローカル実測（通常時・閲覧モード中） | 200／403 |
| `POST /api/admin/comp-grants/{id}/revoke`（解除、`require_admin_write`） | ローカル実測（通常時・閲覧モード中）※初回提出版では未実測、追記で実施 | 200／403 |
| comp状態ユーザーの`POST /api/billing/checkout`二重取り防止 | ローカル実測 | 409（Stripe API呼び出し前に遮断） |
| `AdminViewSession`/`CompGrant`のRLS保護（本番Postgres） | 本番実測（オーナー実施）※初回提出版は「範囲外」のまま断定していた、追記で解消 | `protected`20テーブルに含まれる・`unprotected`空 |
| 一括削除API（カテゴリ・商品）のtenancy分離 | コード追跡＋ローカル実測（own+他ユーザー混在・同一キー別ユーザー）＋既存実証（PR #75, `7b3dde2`）の参照＋再実行 ※初回提出版は範囲説明の1文のみで未分析だった、追記で実施 | 他ユーザーの行は一切削除されない（3パターン合格） |
| CSVインジェクション対策（既存対策の退行確認） | `grep`によるコード確認 | 4箇所とも健在、退行なし |
| npm audit / pip-audit | コマンド実行 | いずれも0件 |
