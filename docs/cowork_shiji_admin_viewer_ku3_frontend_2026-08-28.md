# Cowork タスク指示書: 管理者閲覧機能 区切り3（フロントエンド）

対象リポジトリ: `rakuten-kpi-app`（このファイルが置かれているリポジトリそのもの）。
このファイル1本だけ読めば作業できるように、背景から書く。

## 背景

このプロダクト「ウレシル」は楽天出店者向けのKPI管理SaaS。オーナー（開発者）が導入オンボーディングや
問い合わせ対応で顧客と会話しながら同じ画面を見て案内できるよう、「管理者閲覧機能」（専用の管理者
アカウントが、顧客アカウントの画面を読み取り専用で見られる機能）を実装している。実装計画書は
`docs/jisso_keikaku_admin_viewer_2026-08-26.md`。

バックエンド（区切り1・2）は実装・検証済みで [PR #59](https://github.com/Shoichiro12/rakuten-kpi-app/pull/59)
としてmainにマージ済み（マージコミット `b085a39`）。**このタスクはその区切り3＝フロントエンドの実装。
バックエンドのAPIは既に確定・動作しているので、`backend/` のコードは一切変更しない。**

### 仕組みのおさらい（フロント実装に必要な分だけ）

- 管理者は自分自身の通常ログイン（自分のJWT）のまま。閲覧を開始すると、サーバーが不透明な
  セッショントークンを発行する（顧客として別ログインし直すわけではない）
- そのトークンを `X-Admin-View-Session` というリクエストヘッダに載せて送ると、サーバー側が
  「このリクエストは対象アカウントのデータで処理する」と解釈する。**GET以外（POST/PUT/DELETE）は
  このヘッダが付いていると403で拒否される**（読み取り専用の強制。バックエンド実装済み・検証済み）
- ヘッダを付けなければ従来どおり管理者自身のデータで動く（このヘッダの有無だけで挙動が変わる、
  フロント側で新しい認証の仕組みを作る必要はない）
- `/api/admin/*`（このタスクで使うアカウント一覧・セッション開始・終了・履歴のAPI自体）は、
  このヘッダの影響を受けない設計になっている（バックエンド側で除外済み）。つまり閲覧中に
  「閲覧を終了」ボタンを押すAPI呼び出しは、ヘッダが付いたままでも正常に成功する

## やること

### 1. `frontend/src/lib/adminView.ts`（新規）

現在の閲覧セッションを `sessionStorage`（**`localStorage` ではない**。ブラウザを閉じたら消えるように
する意図的な選択）で保持する薄いストア。

- 保存するキー例: `ureshiru:admin-view-session`（他の永続化キーと同じ命名規則 `ureshiru:xxx` に揃える。
  参考: `Sidebar.tsx` の `ureshiru:sidebar-collapsed`）
- 保存する値: セッション開始APIのレスポンスから `{ id, session_token, target_user_id, target_email, expires_at }`
  を抜き出したもの（JSON文字列化してsessionStorageに入れる）
- 公開する関数:
  - `getViewSession(): AdminViewSessionState | null` … 現在の閲覧セッション情報を返す（無ければnull）
  - `getViewToken(): string | null` … `session_token` だけを返す（`api.ts` の `authHeaders()` から呼ぶ）
  - `setViewSession(session: AdminViewSessionState): void`
  - `clearViewSession(): void`
- 型 `AdminViewSessionState` はこのファイル内でexportする:
  ```ts
  export interface AdminViewSessionState {
    id: number
    session_token: string
    target_user_id: string
    target_email: string | null
    expires_at: string  // ISO8601
  }
  ```
- `sessionStorage` へのアクセスは例外を握りつぶす（プライベートブラウジング等でアクセス不可な環境が
  ある。既存の `Sidebar.tsx` の `localStorage` 例外握りつぶしパターンを踏襲する）

### 2. `frontend/src/lib/api.ts` の拡張

**変更点は2つ、両方とも既存構造への最小追記。**

#### 2-1. `authHeaders()` の拡張

現在:
```ts
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}
```

これを次のように変更する（`adminView` のimportを追加し、閲覧トークンがあれば
`X-Admin-View-Session` ヘッダを足す）:
```ts
import { getViewToken } from './adminView'

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken()
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  const viewToken = getViewToken()
  if (viewToken) headers['X-Admin-View-Session'] = viewToken
  return headers
}
```

**これだけで `request()` と `downloadCsv()` の両方に自動的に効く**（両方とも内部で `authHeaders()` を
呼んでいるため）。他のAPI呼び出し箇所を個別に変更する必要は無い。

#### 2-2. `api` オブジェクトへ `admin` 名前空間を追加

`export const api = { ... }` の末尾（`actions: { ... }` の後）に追加する。バックエンドの実際のレスポンス
形はこの指示書の「APIコントラクト」節を正として実装すること（型は仮に置いてよいが、フィールド名は
一字一句正確に合わせる。バックエンドはPython/snake_caseでそのまま返している）。

```ts
/* ─── 管理者閲覧機能（区切り1・2はバックエンド実装済み。PR #59） ─────── */
admin: {
  /** 登録アカウント一覧 */
  accounts: () =>
    request<AdminAccountsResponse>('/admin/accounts'),
  /** 閲覧セッションを開始する */
  startViewSession: (targetUserId: string) =>
    request<AdminViewSessionStart>('/admin/view-sessions', {
      method: 'POST',
      body: JSON.stringify({ target_user_id: targetUserId }),
    }),
  /** 閲覧セッションを終了する */
  endViewSession: (sessionId: number) =>
    request<AdminViewSessionRecord>(`/admin/view-sessions/${sessionId}/end`, { method: 'POST' }),
  /** 閲覧セッション履歴（監査ログの確認用） */
  viewSessions: () =>
    request<{ sessions: AdminViewSessionRecord[] }>('/admin/view-sessions'),
},
```

型定義（`frontend/src/types/index.ts` に追加するか `api.ts` 内に置くかは既存の使い分けに合わせてよい。
`api.ts` は既に `import('../types').X` の形でtypesファイルの型を都度参照しているので、types/index.ts に
足すほうが一貫する）:

```ts
export interface AdminAccountRow {
  user_id: string
  email: string | null
  created_at: string | null       // ISO8601
  last_sign_in_at: string | null  // ISO8601 or null（未ログイン）
  shop_name: string | null
  subscription_status: string | null  // 'trialing' | 'active' | 'past_due' | 'unpaid' | 'canceled' | null
  has_data: boolean
  rpp_rows: number
  monthly_rows: number
}

export interface AdminAccountsResponse {
  accounts: AdminAccountRow[]
  configured: boolean  // false = Supabase Admin API未設定（本番でも稀に有り得る。0件表示ではなくメッセージを出す）
  count: number
}

export interface AdminViewSessionRecord {
  id: number
  admin_email: string | null
  target_user_id: string
  target_email: string | null
  started_at: string | null   // ISO8601
  ended_at: string | null     // ISO8601 or null（未終了）
  expires_at: string          // ISO8601
}

export interface AdminViewSessionStart extends AdminViewSessionRecord {
  session_token: string  // このレスポンスでのみ返る。他のどのAPIも生トークンは返さない
}
```

### 3. `frontend/src/pages/AdminAccounts.tsx`（新規）

`/admin` ルートで表示するページ。要件:

- アカウント一覧テーブル。列: メール / 店舗名 / 登録日 / 最終ログイン / 課金状態 / データ取込有無
  - `created_at` / `last_sign_in_at` は日時フォーマット（`lib/format.ts` に日時系のフォーマッタが
    無ければ素朴に `new Date(...).toLocaleString('ja-JP')` でよい。この画面は社内専用のため
    規則`docs/ui_number_and_chart_rules_2026-08-04.md`ほど厳密な整形は不要、ただし壊れた表示
    （`Invalid Date`等）は避けること）
  - `subscription_status` は日本語ラベルに変換して表示（例: trialing→トライアル中, active→契約中,
    past_due→支払い確認中, unpaid→未払い, canceled→解約済み, null→未契約）
  - `has_data` は ✓/− のような簡易表示でよい
  - `last_sign_in_at` が null の行（一度もログインしていないユーザー）は「未ログイン」等と表示
- 各行に「この画面を見る」ボタン。押すと `api.admin.startViewSession(user_id)` を呼び、成功したら
  `adminView.setViewSession(...)` でレスポンスを保存し、ダッシュボード（`/`）へ遷移する
  （`useNavigate()` を使う。既存ページの遷移パターンに合わせる）
- `configured: false` が返ってきたら、テーブルの代わりに「Supabase Admin APIが未設定のため
  一覧を取得できません（環境変数 `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` を確認してください）」
  という案内を表示する（クラッシュさせない）
- ローディング・エラー状態は既存ページ（例: `AccountSettings.tsx` の `Notice` コンポーネントパターン、
  または他ページの `Loader2` spin表示）に倣う
- **サイドバーへの新規ナビ項目は追加しない**（計画書§6・評定Q3で確定済み。管理者は直接 `/admin` に
  アクセスする運用）。`App.tsx` にルートを足すだけでよい

### 4. `frontend/src/components/layout/AdminViewBanner.tsx`（新規）

閲覧セッションが有効な間（`adminView.getViewSession()` が非null）、常時表示する固定バナー。

- 表示位置: `App.tsx` のレイアウト最上部（サイドバー＋メイン領域を包む `<div className="relative flex h-screen ...">` の直上、または画面全体の最上部に固定表示帯として追加。既存のスキップリンク・レイアウト構造を壊さないこと。`App.tsx` は `relative overflow-hidden` に依存した挙動があるので構造変更は最小限にする（詳細は `App.tsx` 内のコメント参照）
- 文言: 「閲覧モード: `{target_email}`（読み取り専用）保存・削除はできません」
  **「読み取り専用」の明記は評定Q2で必須要件として確定している。省略しないこと**
- 残り時間の目安: `expires_at` と現在時刻の差分を計算して「残り約N分」のように表示する
  （厳密なカウントダウンタイマーは不要。表示のたびに再計算する程度でよい）
- 「閲覧を終了」ボタン: 押すと
  1. `api.admin.endViewSession(session.id)` を呼ぶ（このAPI呼び出し自体は `X-Admin-View-Session`
     ヘッダが付いたままでも正常に成功する。バックエンドが `/api/admin/*` を対象外にしているため、
     事前にトークンをクリアする必要は無い）
  2. 成功したら `adminView.clearViewSession()` でローカル状態を消す
  3. 画面をリロードするか `/admin` へ遷移する（対象アカウントのデータで開いていた各画面のstateが
     残らないよう、単純な `window.location.href = '/admin'` でよい。SPA内遷移だと古いstateが
     残るページがあるかもしれないため、確実性を優先してフルリロードにする）
- 401（閲覧セッションが無効・失効）を検知した場合の自動クリアは任意（無くても良い。付けるなら、
  APIエラーメッセージが「閲覧セッションが無効です」で始まる場合に `adminView.clearViewSession()`
  を呼んでバナーを消す、という形。必須要件ではない）

### 5. `frontend/src/App.tsx` への追記

- `import AdminAccounts from './pages/AdminAccounts'` と `<Route path="/admin" element={<AdminAccounts />} />` を
  `AppRoutes` 内の既存Routeリストに追加する（既存ルートの並びの最後でよい）
- `AdminViewBanner` を配置する（上記4番参照）

## やらないこと（スコープ外）

- `backend/` のコードは一切変更しない（区切り1・2で確定済み・動作確認済み）
- 書き込み系ボタンの個別 `disabled` 化はしない（評定Q2で見送り確定）。バックエンドの403エラーは
  既存の `parseJson()` のエラーハンドリング（`detail` をそのままthrowしてページ側がcatchして表示）に
  乗せるだけでよい。各ページの保存ボタンのハンドラを個別に変更する必要は無い
- サイドバーへの新規ナビ項目は追加しない（評定Q3で確定済み）
- 法的文書（`lp/*.html`）には触れない（区切り4で対応済み）
- `AdminViewSession` のバックエンドAPI・DBモデルには触れない（区切り1・2で確定済み）

## APIコントラクト（バックエンド実装済み・ローカルで動作確認済み。この節を正として実装すること）

すべて `Authorization: Bearer <管理者のJWT>` が必要（管理者以外は403、未ログインは401）。

### `GET /api/admin/accounts`

```json
{
  "accounts": [
    {
      "user_id": "uuid文字列",
      "email": "user@example.com",
      "created_at": "2026-07-01T00:00:00+00:00",
      "last_sign_in_at": "2026-08-20T09:00:00+00:00",
      "shop_name": "メイン店舗",
      "subscription_status": "trialing",
      "has_data": true,
      "rpp_rows": 120,
      "monthly_rows": 30
    }
  ],
  "configured": true,
  "count": 1
}
```

`configured: false` のときは `accounts: []`（Supabase Admin API未設定。501ではなく200で返す設計。
フロントはこれをエラーではなく「未設定」状態として案内表示すること）。

### `POST /api/admin/view-sessions`

リクエスト: `{ "target_user_id": "uuid文字列" }`

レスポンス（200）:
```json
{
  "id": 1,
  "admin_email": "admin@ureshiru.com",
  "target_user_id": "uuid文字列",
  "target_email": "user@example.com",
  "started_at": "2026-08-28T10:00:00.000000",
  "ended_at": null,
  "expires_at": "2026-08-28T12:00:00.000000",
  "session_token": "生トークン文字列（このレスポンスでのみ返る）"
}
```

エラー: 対象アカウントが存在しない場合 `404`、Supabase Admin API未設定の場合 `501`。

### `POST /api/admin/view-sessions/{id}/end`

レスポンス（200。`session_token` は含まれない）:
```json
{
  "id": 1,
  "admin_email": "admin@ureshiru.com",
  "target_user_id": "uuid文字列",
  "target_email": "user@example.com",
  "started_at": "2026-08-28T10:00:00.000000",
  "ended_at": "2026-08-28T10:15:00.000000",
  "expires_at": "2026-08-28T12:00:00.000000"
}
```

自分（呼び出した管理者自身）が開始したセッション以外は `404`（他の管理者のセッションIDを指定した場合。
現状は管理者1名運用のため実質発生しない）。

### `GET /api/admin/view-sessions`

```json
{ "sessions": [ /* 上と同じ形のオブジェクトの配列。started_at 降順、最大200件 */ ] }
```

### 読み取り専用の強制（参考・フロントは意識しなくてよい仕様）

`X-Admin-View-Session` ヘッダが付いた状態で `GET`/`HEAD`/`OPTIONS` 以外のメソッド（`POST`/`PUT`/`DELETE`
等）を通常のAPI（`/api/admin/*` 以外）に送ると、常に次のレスポンスが返る:

```json
{ "detail": "閲覧モードは読み取り専用です。保存・削除はできません。" }
```
（HTTP 403）

これは `parseJson()` が既存どおり `Error('閲覧モードは読み取り専用です。保存・削除はできません。')` を
throwするので、各ページの既存の保存エラーハンドリング（try/catchでメッセージ表示）にそのまま乗る。
新しいエラーハンドリングを追加で書く必要は無い。

トークンが失効・不正な場合は `401 {"detail": "閲覧セッションが無効です。再度開始してください。"}`。

## 検証

`npm run build`（型エラー0必須）に加え、ヘッドレスブラウザ等で以下を確認すること
（バックエンドはローカルで `SUPABASE_JWT_SECRET` を設定して認証有効化し、自作JWTで管理者アカウントを
模倣する必要がある。区切り1・2の検証で使った手順と同様。ローカルに実Supabaseが無い場合、
`GET /api/admin/accounts` は `configured:false` になるため、一覧表示・「未設定」案内の表示までは
確認できるが、実際にセッションを開始しての遷移確認は本番相当の環境が必要になる点は許容する）:

- `/admin` にアクセスして一覧テーブルが表示される（または `configured:false` の案内が表示される）
- ヘッドレスブラウザのネットワークログで、通常のAPI呼び出し（閲覧セッション開始前）に
  `X-Admin-View-Session` ヘッダが付いていないことを確認
- （実Supabase環境がある場合）閲覧開始 → バナーに「読み取り専用」の文言が表示される →
  以降のAPI呼び出しに `X-Admin-View-Session` ヘッダが付くことをネットワークログで確認 →
  何らかの保存操作でエラーメッセージが表示される → 「閲覧を終了」→ バナー消滅・自分のデータに戻る
- コンソールエラー0

## 納品方法

このリポジトリの標準運用に従い、変更はブランチを切ってコミット → プッシュ → Pull Request を作成する
（mainへの直接pushはしない）。**GitHub連携でpush・PR作成ができない環境の場合は、`main` からの累積差分
パッチ（SHA256・対象ファイル一覧つき、`git apply --check` の手順を明記）をチャット上で提示する形に
切り替える**（このリポジトリの標準運用。詳細はCLAUDE.mdの「Coworkからの変更の受け渡しはパッチ運用で
固定する」節を参照。累積差分は必ず現在の `main`＝PR #59マージ後の状態からのものにすること）。

PRの説明文には「`docs/jisso_keikaku_admin_viewer_2026-08-26.md` の区切り3に対応」と明記すること。
