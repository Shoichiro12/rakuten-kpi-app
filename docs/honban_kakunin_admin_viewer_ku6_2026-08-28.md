# 本番実機確認チェックリスト: 管理者閲覧機能 区切り6

対象: `docs/jisso_keikaku_admin_viewer_2026-08-26.md` の区切り6（本番デプロイ・検証・オーナー目視）。
区切り1・2（バックエンド）は [PR #59](https://github.com/Shoichiro12/rakuten-kpi-app/pull/59) でマージ済み。
区切り3（フロントエンド・`/admin` 画面）は別PRで進行中。

**このチェックリストは①〜⑤の順で実施する。** ①②③⑤はAPIが動いていれば区切り3のUI無しでも
curl/ブラウザDevToolsで確認できる（各項目に代替手順を併記）。④（読み取り専用の実感確認）は
区切り3のUI（閲覧バナー）があるとやりやすいが、無くてもDevToolsのNetworkタブでヘッダを見れば確認できる。

前提: `admin@ureshiru.com` がSupabase側で作成済み・Renderの `ADMIN_USER_ID` にそのUUIDが設定済み
（申し送り台帳で確認済みの前提）。

---

## ① 管理者アカウントで実ログイン

- [ ] `https://app.ureshiru.com` を開き、`admin@ureshiru.com` とパスワードマネージャーに保存した
      パスワードでログインできることを確認する
- [ ] ログイン後、通常のダッシュボードが表示されること（管理者アカウント自身は店舗データを
      持たない=空のダッシュボードになるはずなので、それが「壊れている」わけではないことを確認）
- [ ] ブラウザのDevTools → Application/Storage → セッション or ローカルストレージ等で、
      Supabaseのアクセストークンが取得できていることを確認（次のステップでcurlに使う場合）

## ② アカウント一覧APIで実データが返ることを確認

**区切り3のUIがある場合**: `/admin` を開き、テーブルに実際の登録アカウント（メール・店舗名・登録日・
最終ログイン・課金状態・データ取込有無）が表示されることを確認する。

**UIが無い場合の代替（DevTools Network or curl）**:
```bash
curl -s -H "Authorization: Bearer <管理者のアクセストークン>" \
  https://app.ureshiru.com/api/admin/accounts | jq .
```
- [ ] `configured: true` であること（`false` ならSupabase Admin API未設定＝`SUPABASE_SERVICE_ROLE_KEY`
      が本番envに無い可能性があるので先にそちらを確認する）
- [ ] `accounts` 配列に、実際に知っている顧客アカウント（例: 検証用に把握している既存ユーザー）が
      含まれていること。特に以下を実データと突き合わせて確認:
  - [ ] `email` が正しい
  - [ ] `shop_name` が正しい（店舗名を設定しているアカウントで確認）
  - [ ] `subscription_status` が実際の契約状態と一致する（Stripeダッシュボード or 該当アカウントの
        「請求・プラン」画面と突き合わせる）
  - [ ] `has_data` / `rpp_rows` / `monthly_rows` が、データ投入済みのアカウントで `true`・0より大きい
        値になっていること（**サンプルデータだけのアカウントでは `false`・0のままであること**も
        あわせて確認する — これが `is_sample` 除外条件が本番Postgresでも正しく効いている証拠になる）

## ③ 閲覧セッションを開始し、expires_at が開始から2時間後になっていることを確認

**区切り3のUIがある場合**: ②の一覧から検証対象アカウント（社内の検証用アカウント推奨。実顧客への
無断閲覧は避ける）の「この画面を見る」を押す。

**UIが無い場合の代替**:
```bash
curl -s -X POST -H "Authorization: Bearer <管理者のアクセストークン>" \
  -H "Content-Type: application/json" \
  -d '{"target_user_id": "<対象アカウントのUUID>"}' \
  https://app.ureshiru.com/api/admin/view-sessions | jq .
```

- [ ] レスポンスの `started_at` と `expires_at` を控える
- [ ] **`expires_at` - `started_at` を計算し、ちょうど2時間（7200秒）であることを確認する**
      （`date -d` やPythonの `datetime.fromisoformat()` で差分を取ってもよい。目視で「時」の桁が
      +2されているだけでは不十分——分・秒まで一致していることを確認する）
- [ ] レスポンスに `session_token` が含まれていること（これが閲覧用のトークン。以降のリクエストに
      `X-Admin-View-Session` ヘッダとして使う）
- [ ] 同じ管理者で以前に開いていた別の閲覧セッションがあれば、`GET /api/admin/view-sessions` で
      その `ended_at` が今回の開始時刻あたりで自動的に埋まっていることを確認する（1管理者1セッション
      の自動終了の実機確認）

## ④ 対象アカウント画面が読み取り専用で開けることを確認

**区切り3のUIがある場合**: 閲覧開始後、バナーに「閲覧モード: `{対象メール}`（読み取り専用）保存・
削除はできません」と表示され、ダッシュボード等の画面が**対象アカウントのデータ**で表示されることを
確認する。何らかの保存操作（例: 目標設定の保存ボタン）を押し、エラーメッセージが表示され保存が
実行されないことを確認する。

**UIが無い場合の代替（DevTools or curl）**:
```bash
# 読み取り（GET）は成功し、対象アカウントのデータが返ることを確認
curl -s -H "Authorization: Bearer <管理者のアクセストークン>" \
  -H "X-Admin-View-Session: <③で取得したsession_token>" \
  https://app.ureshiru.com/api/dashboard?period=weekly | jq .

# 書き込み（POST）は403で拒否されることを確認
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "Authorization: Bearer <管理者のアクセストークン>" \
  -H "X-Admin-View-Session: <③で取得したsession_token>" \
  -H "Content-Type: application/json" -d '{}' \
  https://app.ureshiru.com/api/targets
```
- [ ] `GET /api/dashboard` が対象アカウントの実データ（管理者自身の空データではなく）を返すこと
- [ ] `POST /api/targets`（またはUIの何らかの保存操作）が **403** で拒否され、本文に
      「閲覧モードは読み取り専用です。保存・削除はできません。」が含まれること
- [ ] 念のため、`session_token` を付けずに同じ `GET /api/dashboard` を叩くと**管理者自身のデータ**
      （通常は空）に戻ることを確認する（ヘッダの有無だけで切り替わっている証拠）

## ⑤ 監査ログ（開始・終了・対象）が記録されていることを確認

- [ ] `GET /api/admin/view-sessions` を叩き、③で開始したセッションが一覧に含まれ、
      `admin_email`（自分自身）・`target_user_id`・`target_email`・`started_at`・`expires_at` が
      正しく記録されていることを確認する
- [ ] 閲覧を終了する（UIの「閲覧を終了」、または `POST /api/admin/view-sessions/{id}/end`）
- [ ] 終了後、同じ `GET /api/admin/view-sessions` で該当セッションの `ended_at` が埋まっていることを
      確認する（開始のみでなく終了も記録される、が要件の核心）
- [ ] 終了後、③で使った `session_token` を `X-Admin-View-Session` に付けて何かGETを叩くと **401**
      「閲覧セッションが無効です。再度開始してください。」になることを確認する（終了後の再利用が
      本当に効かないことの最終確認）

---

## 全項目通過後

- [ ] `GET /api/security-status`（要ログイン）で `admin_view_sessions` が `protected` に含まれ、
      `unprotected` が空・`ok:true` であることを確認する
- [ ] 申し送り台帳（CLAUDE.md）の該当行に「区切り6・本番実機確認済み（日付）」を追記する
      （このチェックリストの結果を要約する形でよい。特に②の実データ突き合わせ結果と③の2時間の
      実測値は具体的に書き残すこと——「確認した」だけだと後で再現できない）
