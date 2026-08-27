# 確認チェックリスト: 管理者閲覧機能 区切り6（本番実機確認）

計画書 `docs/jisso_keikaku_admin_viewer_2026-08-26.md` §8「区切り6: 本番デプロイ・検証・オーナー目視」に対応。
区切り1・2（バックエンド）は[PR #59](https://github.com/Shoichiro12/rakuten-kpi-app/pull/59)で実装済み・本番デプロイ済み、`ADMIN_USER_ID`も設定済み。残っているのはオーナー自身による本番実機での動作確認のみ。

区切り3（フロントエンドの管理者画面）が未実装のため、**現時点ではAPIを直接叩いて確認する**（`curl`やSwagger UI等）。区切り3実装後は、下記の手順をブラウザの`/admin`画面での操作に置き換えて改めて確認するとよい（このチェックリストの順序自体は区切り3後も変わらない）。

## 前提

- `admin@ureshiru.com` が本番Supabaseに作成済みで、そのUUIDが本番envの`ADMIN_USER_ID`に設定済み（オーナー確認済み）
- 確認には、実データが入った任意のアカウント（例: `demo@ureshiru.com`）を対象として使う

## 手順（この順序で実施）

### 1. admin@ureshiru.comで実ログイン

- `https://app.ureshiru.com` にアクセスし、`admin@ureshiru.com` でログインする
- ログイン後の画面（ダッシュボード等）が**管理者自身のデータ**（通常は空、または管理者アカウント自身が入力したデータのみ）で表示されることを確認する
- ここで取得したアクセストークン（ブラウザの開発者ツール → Application → LocalStorage、またはNetworkタブでAPIリクエストの`Authorization`ヘッダを確認）を、以降のAPI確認に使う

### 2. アカウント一覧APIで実データを確認

```
GET https://app.ureshiru.com/api/admin/accounts
Authorization: Bearer <admin@ureshiru.comのアクセストークン>
```

- レスポンスの`configured`が`true`であること（`false`なら`SUPABASE_SERVICE_ROLE_KEY`等の設定漏れ）
- `accounts`配列に実際の登録アカウントが並び、`email`・`created_at`・`last_sign_in_at`・`subscription_status`・`has_data`が実態と合っていることを確認する
- 確認用に使うアカウント（例: `demo@ureshiru.com`）の`user_id`を控えておく（次の手順で使う）

### 3. 閲覧セッションを開始し、expires_atが2時間後であることを確認

```
POST https://app.ureshiru.com/api/admin/view-sessions
Authorization: Bearer <admin@ureshiru.comのアクセストークン>
Content-Type: application/json

{"target_user_id": "<手順2で控えたuser_id>"}
```

- レスポンスに`session_token`（一度だけ返る生トークン）・`id`（セッションID）・`started_at`・`expires_at`が含まれることを確認する
- **`expires_at`が`started_at`のちょうど2時間後になっていること**を確認する（`backend/admin_view.py`の`SESSION_DURATION = timedelta(hours=2)`が正しく効いているかの実測）
- `session_token`を控える（次の手順で使う）

### 4. 対象画面が読み取り専用になっていることを確認

対象アカウント（例: `demo@ureshiru.com`）のデータで、GETは通り書き込みは403になることを確認する。

**GET（成功する想定）:**

```
GET https://app.ureshiru.com/api/dashboard?period=weekly
Authorization: Bearer <admin@ureshiru.comのアクセストークン>
X-Admin-View-Session: <手順3のsession_token>
```

- レスポンスが**管理者自身のデータではなく、対象アカウント（demo@ureshiru.com等）のデータ**になっていることを確認する（手順1で見た管理者自身の画面と中身が違うこと）

**書き込み系（403になる想定）:**

```
POST https://app.ureshiru.com/api/targets
Authorization: Bearer <admin@ureshiru.comのアクセストークン>
X-Admin-View-Session: <手順3のsession_token>
Content-Type: application/json

{"year_month": "2026-08", "target_sales": 1000000}
```

- ステータスコードが**403**になり、書き込みが行われていないことを確認する（対象アカウントの目標設定画面を別途見て、実際に変更されていないことも確認するとより確実）

### 5. 監査ログ（AdminViewSession）に記録されていることを確認

```
GET https://app.ureshiru.com/api/admin/view-sessions
Authorization: Bearer <admin@ureshiru.comのアクセストークン>
```

- 手順3で開始したセッションが履歴に含まれ、`admin_email`・`target_user_id`・`target_email`・`started_at`・`expires_at`が手順3の内容と一致することを確認する

### 6. 閲覧セッションを終了し、後始末する

```
POST https://app.ureshiru.com/api/admin/view-sessions/<手順3のid>/end
Authorization: Bearer <admin@ureshiru.comのアクセストークン>
```

- レスポンスの`ended_at`が埋まっていることを確認する
- 終了後、手順4と同じGETリクエスト（`X-Admin-View-Session`ヘッダ付き）を再送し、**401**（トークンが無効化されている）になることを確認する

### 7. RLS保護の確認

```
GET https://app.ureshiru.com/api/security-status
```

（既存の管理系・診断系エンドポイントと同様、権限のある方法でアクセスすること）

- `unprotected`が空であること（`admin_view_sessions`テーブルもRLS保護対象に含まれていること）を確認する

## 完了後にやること

このチェックリストがすべて✅になったら、CLAUDE.md「📌 申し送り」台帳の管理者閲覧機能の行に「区切り6完了」を追記し、`docs/office_map.html`のQUESTSから該当項目を除去する（区切り3が別途完了していれば、その時点で管理者閲覧機能のクエストごと消せる）。
