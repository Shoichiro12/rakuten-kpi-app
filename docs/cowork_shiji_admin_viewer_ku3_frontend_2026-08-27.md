# Cowork タスク指示書: 管理者閲覧機能 区切り3（フロントエンド）

対象リポジトリ: `rakuten-kpi-app`（このファイルが置かれているリポジトリそのもの）。
このファイル1本だけ読めば作業できるように、背景から書く。

## 背景（このタスクだけを見る人向けの説明）

このプロダクト「ウレシル」は楽天出店者向けのKPI管理SaaS。オーナー（開発者）が導入オンボーディングや問い合わせ対応で顧客と会話しながら同じ画面を見て案内できるよう、「管理者閲覧機能」（専用の管理者アカウントが、顧客アカウントの画面を読み取り専用で見られる機能）を実装している。

実装計画書は `docs/jisso_keikaku_admin_viewer_2026-08-26.md`。このタスクはその計画書の「区切り3」に該当する。**バックエンド（区切り1・区切り2）は既に実装・マージ・本番デプロイ済み**（[PR #59](https://github.com/Shoichiro12/rakuten-kpi-app/pull/59)）。区切り3はその確定済みAPIを呼ぶだけの独立したフロントエンド作業で、`backend/` のコードは一切変更しない。

## やること

**API仕様は `backend/routers/admin.py`・`backend/admin_guard.py`・`backend/admin_view.py`・`backend/auth.py` の実装を正とする。** この指示書の説明と実装コードが食い違う場合は、必ず実装コードを読んで確認すること（この指示書は計画時点の要約であり、実装の詳細を完全に写し取ったものではない）。

### 1. `frontend/src/pages/AdminAccounts.tsx`（新規）

管理者アカウント一覧画面。`GET /api/admin/accounts` を呼び、以下を表示する:

- メールアドレス（`email`）
- 登録日（`created_at`）
- 最終ログイン（`last_sign_in_at`）
- 店舗名（`shop_name`、未設定ならダッシュ表示）
- 契約状態（`subscription_status`。null/undefinedは「未契約」等の表示にする）
- データ取込有無（`has_data`。true/falseのバッジ表示。`rpp_rows`/`monthly_rows`の件数もツールチップ等で補足してよい）

レスポンスの `configured: false` の場合（Supabase Admin API未設定）は、一覧の代わりに「管理者機能が設定されていません」等の案内を表示する（500エラーにしないこと。バックエンドは501ではなく200で`configured: false`を返す設計）。

各行に「この人として見る」ボタンを置き、押すと後述の閲覧セッション開始処理（`POST /api/admin/view-sessions`、body `{target_user_id: string}`）を呼び、成功したら `/`（ダッシュボード）等アプリの通常画面へ遷移させる。

### 2. `frontend/src/lib/adminView.ts`（新規）

閲覧セッションのトークンをブラウザ側で保持・参照する薄いモジュール。

- `POST /api/admin/view-sessions` のレスポンスに含まれる `session_token`（生トークン。このレスポンスでしか返らない）を `sessionStorage`（`localStorage`ではなく`sessionStorage`を推奨——閲覧モードはタブを閉じたら終わってほしい一時的な状態のため）に保存する関数
- 保存されているトークン・対象メール（`target_email`）・失効時刻（`expires_at`）を読み出す関数
- 「閲覧を終了」時（`POST /api/admin/view-sessions/{id}/end`）や、`expires_at` を過ぎている場合に `sessionStorage` をクリアする関数
- `id`（セッションID。終了APIに必要）も一緒に保持すること（開始レスポンスの `id` フィールド）

### 3. `frontend/src/lib/api.ts` の `authHeaders()` 拡張

現在の実装（5〜8行目付近）:

```ts
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}
```

これを、`adminView.ts` から有効な閲覧セッショントークンが取得できる場合に `X-Admin-View-Session` ヘッダも付与するよう拡張する:

```ts
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken()
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  const viewToken = getActiveViewSessionToken() // adminView.ts から import。期限切れなら null を返すこと
  if (viewToken) headers['X-Admin-View-Session'] = viewToken
  return headers
}
```

**重要**: `/api/admin/*` へのリクエスト（一覧取得・セッション開始・終了・履歴）にはこのヘッダを付けても問題ない（バックエンドの `UserContextMiddleware` が `/api/admin` パスを上書き対象外にしているため）。特別な分岐は不要——`authHeaders()` は常に同じロジックでよい。

### 4. `frontend/src/components/layout/AdminViewBanner.tsx`（新規）

閲覧セッションが有効な間、アプリのレイアウト最上部（`App.tsx`）に常時表示する固定バナー。

- 文言に必ず「閲覧モード」「対象アカウントのメールアドレス」「**読み取り専用**」の3点を含める（**「読み取り専用」の明記は評定Q2で確定した必須要件**。理由: 書き込みボタンを個別に無効化しない設計のため、押せてしまうボタンで保存に失敗したユーザー体験を、バナーでの事前宣言によって補う）
- 残り時間の目安（`expires_at` から算出。厳密なカウントダウンは不要、「残り約N分」程度でよい）
- 「閲覧を終了」ボタン。押すと `POST /api/admin/view-sessions/{id}/end` を呼び、`adminView.ts` の状態をクリアして管理者自身の画面（`/admin`）へ戻す
- 403エラーを受けたときのエラーメッセージが埋もれないよう、バナー自体に「保存・削除はできません」も明記する

### 5. `frontend/src/App.tsx` にルート追加

- `/admin` ルートを追加し、`AdminAccounts.tsx` を表示する
- `AdminViewBanner.tsx` を、閲覧セッションが有効なときだけレイアウト最上部に描画する
- **サイドバーへの新規ナビ項目は追加しない**（評定Q3で確定。管理者は直接 `/admin` にアクセスする運用）
- 書き込み系ボタンの個別 disabled 化は行わない（評定Q2で確定。バックエンドの403を受けたときの表示は既存の `parseJson()` のエラーハンドリングに乗せるだけでよい。新しいエラー表示の仕組みを作らないこと）

## やらないこと（スコープ外）

- `backend/` のコードは一切変更しない（API仕様に疑問があれば実装コードを読んで解決し、変更はしない）
- サイドバーへの管理者用ナビ項目の追加（評定Q3で明示的に見送り）
- 書き込みボタンの個別 disabled 化（評定Q2で明示的に見送り）
- `/admin` 以外のルートへのアクセス制御変更（`require_admin` はバックエンド側の防御が正で、フロント側の「非管理者はこの画面を見せない」的なガードは無くてもよい。403エラー時にエラーメッセージが表示されれば十分）

## 検証

- `npm run build`（型エラー0）
- ヘッドレスブラウザ（またはローカルuvicorn+ローカルSupabase設定がある場合は実データ）で以下を確認:
  1. `/admin` にアクセスし、アカウント一覧が表示される（`configured: false` のケースも別途、案内文言が出ることを確認）
  2. 一覧から1件を選び「この人として見る」→ ダッシュボード等の通常画面に遷移する
  3. バナーに「閲覧モード」「対象メールアドレス」「読み取り専用」の3点が表示されている
  4. 対象アカウントのデータ（ダッシュボード等）が表示される
  5. 何らかの保存操作（例: 目標設定の保存）を試み、エラーメッセージが表示される（403想定）
  6. 「閲覧を終了」を押す → バナーが消え、管理者自身の画面に戻る
- ローカル環境（認証無効・`ADMIN_USER_ID`未設定）では `require_admin` が403を返す設計のため、`/admin` は「この機能は認証が有効な環境専用です」等のエラー表示になる想定。この場合はUIの見た目（レイアウト崩れがないか）だけ確認できればよい

## 納品方法

このリポジトリの標準運用に従い、変更はブランチを切ってコミット → プッシュ → Pull Request を作成する（mainへの直接pushはしない）。GitHub連携で push・PR作成ができない環境の場合は、`main` からの累積差分パッチ（SHA256・対象ファイル一覧つき、`git apply --check` の手順を明記）をチャット上で提示する形に切り替える。

PRの説明文には「`docs/jisso_keikaku_admin_viewer_2026-08-26.md` の区切り3に対応」と明記すること。
