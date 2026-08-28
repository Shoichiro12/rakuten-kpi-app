# Cowork タスク指示書: 無償提供（comp）管理 区切り3（フロントエンド）

対象リポジトリ: `rakuten-kpi-app`（このファイルが置かれているリポジトリそのもの）。
このファイル1本だけ読めば作業できるように、背景から書く。

## 背景

このプロダクト「ウレシル」は楽天出店者向けのKPI管理SaaS。社内の検証・デモ用アカウントや、
導入検証中の見込み客に無料で全機能を使わせる仕組み（無償提供＝comp）を、これまでの
`EXEMPT_TEST_EMAILS`（環境変数・Renderダッシュボードでの手作業）から、管理者専用画面
`/admin` から直接付与・解除できるようにする。実装計画書は
`docs/jisso_keikaku_comp_management_2026-08-28.md`（§13が評定確定内容、§14が区切り1・2の
実装結果）。

`/admin` 画面自体は「管理者閲覧機能」という別機能（計画書 `docs/jisso_keikaku_admin_viewer_2026-08-26.md`）
で既に実装済み・本番稼働中。今回のタスクはその同じ画面（`frontend/src/pages/AdminAccounts.tsx`）に
comp管理のUIを追加する。

バックエンド（区切り1・2）は実装・検証済みで
[PR #70](https://github.com/Shoichiro12/rakuten-kpi-app/pull/70) としてmainにマージ済み
（マージコミット `70bb2f2`）。本番デプロイも確認済み（マイグレーション正常・回帰なし・
`comp_grants`がRLS保護済み）。**このタスクはその区切り3＝フロントエンドの実装。
バックエンドのAPIは既に確定・動作しているので、`backend/` のコードは一切変更しない。**

### 仕組みのおさらい（フロント実装に必要な分だけ）

- comp = 「Stripeのカード登録・課金を一切通らず、対象アカウントが全機能を無料で使える」状態。
  `Subscription.status` の値の1つとして `"comp"` が新設されている（既存の `trialing`/`active`
  と同列。有効な契約として扱われるので、対象アカウントは課金ロック（402）に引っかからない）
- 付与には2パターンある。**フロントはこの違いを意識する必要はない**（バックエンドが
  自動判定する。同じAPI呼び出しで両方に対応する）:
  - 既存アカウント（Supabase Authに実在）への付与 → 即座に反映される
  - 未登録メールへの「先行登録」→ そのメールでサインアップした本人の初回アクセス時に
    自動で確定する（`resolved: false` のまま一覧に残り、サインアップされると `resolved: true` に変わる）
- 付与時、対象メールに**既にStripe上の生きた契約**（trialing/active/past_due/unpaid かつ
  `stripe_customer_id`あり）がある場合は **409** で拒否される。「先に解約してから」という
  趣旨のエラーメッセージが返る
- 解除は「有効な付与を無効化する」操作。対象が既にサインアップ済みでcomp状態なら、
  その場で通常の未契約状態に戻る（課金導線が復活する）
- **付与理由（`note`）は必須。** 空文字・空白のみだと422で拒否される（後述の「バリデーション
  エラーの扱い」を必ず読むこと。ふつうの`detail`文字列ではない特殊な形が返る）
- 管理者閲覧モード中（`X-Admin-View-Session`ヘッダが付いている状態）は、comp管理の
  書き込み系操作（付与・解除）は403で拒否される（バックエンド実装済み）。一覧の取得は
  拒否されない

## やること

### 1. `frontend/src/types/index.ts` に型を追加

```ts
export interface CompGrant {
  id: number
  email: string
  target_user_id: string | null
  resolved: boolean       // target_user_id が確定済みか（false=先行登録でまだ未サインアップ）
  granted_by_email: string | null
  granted_at: string       // ISO8601
  revoked_at: string | null
  revoked_by_email: string | null
  note: string
}

export interface CompGrantListResponse {
  grants: CompGrant[]  // 有効な付与のみ（revoked_atがnullの行）
}

export interface CompGrantCreateResponse extends CompGrant {
  already_granted: boolean  // true = 既に有効な付与があり、新規作成せずそれを返した（冪等）
}

export interface CompGrantRevokeResponse extends CompGrant {
  subscription_touched: boolean  // true = 対象のSubscription行を実際に削除した（未契約状態に戻した）
}
```

### 2. `frontend/src/lib/api.ts` の `admin` 名前空間に `comp` を追加

現在の `admin: { ... }`（670行目付近）の末尾に追記する。**既存の `accounts`/`startViewSession`/
`endViewSession`/`viewSessions` は変更しない。**

```ts
/* ─── 無償提供（comp）管理（区切り1・2はバックエンド実装済み。PR #70） ─── */
comp: {
  /** 有効な無償提供の一覧 */
  list: () =>
    request<import('../types').CompGrantListResponse>('/admin/comp-grants'),
  /** 付与する（note必須。バリデーションエラーの扱いは下記「重要な注意」参照） */
  grant: (email: string, note: string) =>
    request<import('../types').CompGrantCreateResponse>('/admin/comp-grants', {
      method: 'POST',
      body: JSON.stringify({ email, note }),
    }),
  /** 解除する */
  revoke: (grantId: number) =>
    request<import('../types').CompGrantRevokeResponse>(`/admin/comp-grants/${grantId}/revoke`, {
      method: 'POST',
    }),
},
```

### 3. `frontend/src/pages/AdminAccounts.tsx` の拡張

このファイルは既に実装済み（アカウント一覧・「この画面を見る」ボタン・閲覧履歴の折りたたみ）。
そこに comp 管理のセクションを追加する。**既存のアカウント一覧テーブル・閲覧履歴セクション・
`startView` 関数などは変更しない。** 追加するのは以下の3点。

#### 3-1. `STATUS_LABEL` に `comp` を追加

現在の定義（18〜24行目）:
```ts
const STATUS_LABEL: Record<string, string> = {
  trialing: 'トライアル中',
  active: '契約中',
  past_due: '支払い確認中',
  unpaid: '未払い',
  canceled: '解約済み',
}
```
これに `comp: '無償提供'` を追加する。これだけで、既存のアカウント一覧テーブルの「課金状態」列に
comp状態のアカウントが「無償提供」と表示されるようになる（バックエンドの `subscription_status`
フィールドは既に `"comp"` を返すため、テーブル本体への変更は不要）。

#### 3-2. 「無償提供の管理」セクションを新設（既存の「閲覧履歴」折りたたみの直前あたりに配置）

- 開閉式（`<details>`）にはせず、常時表示のカードでよい（付与操作の起点になるため、
  閲覧履歴のような「たまに確認する」ログとは性質が違う）
- 表示内容:
  - 有効な無償提供の一覧（`api.admin.comp.list()`）: メール・状態（`resolved` に応じて
    「サインアップ済み」/「先行登録中（未サインアップ）」）・付与した管理者・付与日時・理由（note）・
    「解除」ボタン
  - 一覧が0件なら「無償提供中のアカウントはありません」等の空状態表示
  - 一覧の取得・表示はページマウント時に自動で行う（既存の「閲覧履歴」のような
    「開いたときだけ取得」の遅延読み込みにする必要はない。付与操作の起点としてすぐ見えるべきため）
- 付与フォーム: メールアドレス入力欄＋理由（note）入力欄＋「付与する」ボタン
  - **note入力欄は空のままでは送信ボタンを無効化する**（`disabled`）。理由は下記
    「重要な注意: バリデーションエラーの扱い」を参照。プレースホルダで記入例を示す
    （例:「◯◯社の導入検証用」「△△様のオンボーディング支援」）
  - メールアドレス欄も空のままは送信不可にする
  - 送信は直接APIを呼ばず、下記4番の確認ダイアログを経由すること（要件3で確認ダイアログが
    必須と決まっている）

#### 3-3. 一覧・付与・解除のエラー表示

- 付与時、既存Stripe契約がある場合の409エラー（`detail`は「このメールには既にStripe契約が
  あります（status=xxx）。先にStripe側の解約手続きを行ってから、無償提供を付与してください。」
  という文字列）は、既存の `Notice` コンポーネント（`error` prop）にそのまま表示すればよい
  （通常の文字列detailなので `e.message` をそのまま出せる）
- 付与が冪等に成功した場合（`already_granted: true`。同じメールへの重複付与）は、エラーでは
  なく情報メッセージとして「既に有効な無償提供があります」等を表示する（成功として扱う）
- 解除時、対象のSubscriptionが既にcomp以外に変わっていた場合（`subscription_touched: false`）は、
  エラーではなく「解除しましたが、対象の契約状態は既にcompではなかったため契約データは
  変更していません」等の注記を出す（バックエンドが安全側に倒して契約を壊さなかった、
  という意味なので失敗ではない）

### 4. 確認ダイアログ（要件3・評定で必須）

**新規コンポーネントを作らず、既存の `frontend/src/components/ConfirmDeleteModal.tsx` を
そのまま流用する。** このコンポーネントは名前こそ「削除」用だが、`title`/`message`/
`confirmLabel`/`checkboxLabel` をすべてpropsで渡せる汎用的な作りになっており
（チェックボックスを入れないと実行ボタンが押せない構造）、comp の付与・解除どちらにも
そのまま使い回せる。**別名の新コンポーネントを作ると同じ挙動のモーダルが2つ並ぶことになるので、
作らないこと。**

呼び出し方の例（付与時）:
```ts
<ConfirmDeleteModal
  open={confirmOpen}
  title="無償提供を付与します"
  message={`対象: ${pendingEmail}\n変更内容: 未契約 → 無償提供\nこの操作後、対象アカウントはカード登録なしで全機能を利用できるようになります。`}
  confirmLabel="付与する"
  checkboxLabel="内容を確認しました"
  onConfirm={doGrant}
  onCancel={() => setConfirmOpen(false)}
  loading={granting}
/>
```

解除時も同様に、`message` を「対象: {email}\n変更内容: 無償提供 → 未契約\nこの操作後、
対象アカウントの無償提供は終了し、通常のトライアル・課金フローに戻ります。」に変えて使う。

### 5. `is_comp` 列は追加しない（見送りの決定・§7を受けての確定）

計画書§7では「`GET /api/admin/accounts` に `is_comp` を追加するかはフロント設計時に確定する」
としていたが、**このタスクでは追加しないことに決める。** 理由:

- `subscription_status` フィールドが既に `"comp"` を返しており、上記3-1の `STATUS_LABEL` 追加
  だけでアカウント一覧テーブルの表示は成立する
- 付与理由（note）・付与日時・先行登録の解決状況といった comp 固有の詳細情報は、
  3-2で作る「無償提供の管理」セクション（`GET /api/admin/comp-grants` を直接叩く別セクション）
  で十分に表示できる。アカウント一覧テーブルの行に無理に埋め込む必要がない
- `is_comp` を追加するには `backend/routers/admin.py`（アカウント一覧API）の変更が要るが、
  **このタスクは `backend/` に一切触れない方針**なので、そもそも選択肢として取れない

この判断は変更しないこと。「アカウント一覧のcomp行にnoteも出したい」という要望が
将来出たら、それは別チケットとしてバックエンド側の変更を伴う判断になる。

## やらないこと（スコープ外）

- `backend/` のコードは一切変更しない（区切り1・2で確定済み・検証済み・本番デプロイ確認済み）
- 既存のアカウント一覧テーブル・「この画面を見る」ボタン・閲覧履歴セクションの実装は変更しない
  （STATUS_LABELへの1行追加のみ）
- `is_comp` 列の追加はしない（上記5番で確定）
- `frontend/src/pages/Billing.tsx` 以外の画面（GAP分析・ダッシュボード等）には触れない
- demo@ureshiru.com への実際のcomp付与作業は行わない（このタスクはUIを作るだけ。実際の
  付与操作は、このUIが本番に乗ったあとオーナー自身が画面から行う）
- `docs/unyou_exempt_test_emails.md` の更新は行わない（区切り4の作業。別途指示書を切り出す）

## `frontend/src/pages/Billing.tsx` の変更点

顧客側の請求・プラン画面。comp状態のアカウントで矛盾した表示（トライアル残り日数・
課金導線）が出ないようにする。

#### 変更点1: `STATUS_LABEL`（11〜17行目）に `comp: '無償提供'` を追加

```ts
const STATUS_LABEL: Record<string, string> = {
  trialing: 'トライアル中',
  active: '有効',
  past_due: '支払い遅延',
  canceled: '解約済み',
  incomplete: '手続き未完了',
  comp: '無償提供',  // ← 追加
}
```

#### 変更点2: 日付欄の表示分岐（199〜204行目付近）

現在:
```tsx
<div className="bg-gray-50 rounded p-3">
  <p className="text-xs text-gray-500">{status.status === 'trialing' ? 'トライアル終了' : '次回更新'}</p>
  <p className="font-semibold text-gray-900">
    {fmtDate(status.status === 'trialing' ? status.trial_end : status.current_period_end)}
  </p>
</div>
```

`status.status === 'comp'` のときは日付を出さず「無償提供中（期間の定めなし）」と表示する
（comp は `trial_end`/`current_period_end` とも `null` なので、`fmtDate(null)` は `—` になり
見た目がおかしくなる。分岐で防ぐ）:

```tsx
<div className="bg-gray-50 rounded p-3">
  <p className="text-xs text-gray-500">
    {status.status === 'comp' ? '契約期間' : status.status === 'trialing' ? 'トライアル終了' : '次回更新'}
  </p>
  <p className="font-semibold text-gray-900">
    {status.status === 'comp'
      ? '無償提供中（期間の定めなし）'
      : fmtDate(status.status === 'trialing' ? status.trial_end : status.current_period_end)}
  </p>
</div>
```

#### 変更点3: 「解約をご希望の場合」カードをcompには出さない（246行目付近）

現在:
```tsx
{active && status && (
  <div className="bg-white rounded-xl border shadow-sm p-6">
    <h3 className="text-sm font-semibold text-gray-800 mb-2">解約をご希望の場合</h3>
    ...
```

comp状態は「解約」という概念に当てはまらない（Stripe契約が存在しないため）。表示条件に
`status.status !== 'comp'` を追加する:

```tsx
{active && status && status.status !== 'comp' && (
  <div className="bg-white rounded-xl border shadow-sm p-6">
    <h3 className="text-sm font-semibold text-gray-800 mb-2">解約をご希望の場合</h3>
    ...
```

#### 変更不要の箇所（念のため明記。触らないこと）

- 「お支払い方法の変更」ボタン（`status.stripe_linked !== false` の分岐、210行目付近）は
  変更不要。comp アカウントは `stripe_customer_id` を持たないため `stripe_linked: false` が
  自動的に返り、既存の判定だけでボタンが自動的に非表示になる
- `!active && status?.enabled && ...`（265行目付近、未契約時のプランカード表示条件）も
  変更不要。comp は `is_active: true` を返すため、この分岐には最初から入らない

## 重要な注意: バリデーションエラーの扱い（note必須のエラー表示）

`POST /api/admin/comp-grants` は `note` が空文字・空白のみだと **422** を返すが、この
エラーレスポンスの形は他のAPIと違う。通常のエラー（`{"detail": "文字列"}`）ではなく、
FastAPI/Pydanticの標準バリデーションエラー形式（`{"detail": [{"type": ..., "msg": "Value error, 付与理由（note）を入力してください。", ...}]}`）
で返る。**`detail` が配列**なので、`frontend/src/lib/api.ts` の `parseJson()` がそのまま
`throw new Error(msg)` すると、`msg` に配列が渡り `e.message` が `[object Object]` のような
壊れた文字列になる。

**対策（このタスクで対応すること）**: `api.ts` 側を直さない（他の全APIに影響する共通関数の
挙動を変えるのは今回のスコープ外）。代わりに、**上記3-2で決めたとおり、フロント側で
note欄が空のときは送信ボタンをそもそも無効化する**ことで、この422パスをほぼ発生させない
（バックエンドの422は「万一クライアント側の判定をすり抜けた場合の最終防御線」として
機能させ、通常操作では到達させない設計にする）。万一到達してエラーメッセージが
壊れて表示されても、実害は「ボタンが無効化されているのに何らかの理由で422が返った」という
起こりにくいケースに限定される。

## APIコントラクト（バックエンド実装済み・ローカルで動作確認済み。この節を正として実装すること）

すべて `Authorization: Bearer <管理者のJWT>` が必要（管理者以外は403、未ログインは401）。
書き込み系（`POST`）はさらに、閲覧モード中（`X-Admin-View-Session`ヘッダあり）なら403になる。

### `GET /api/admin/comp-grants`

```json
{
  "grants": [
    {
      "id": 1,
      "email": "user@example.com",
      "target_user_id": "uuid文字列 または null（先行登録で未サインアップ）",
      "resolved": true,
      "granted_by_email": "admin@ureshiru.com",
      "granted_at": "2026-08-28T10:00:00",
      "revoked_at": null,
      "revoked_by_email": null,
      "note": "◯◯社の導入検証用"
    }
  ]
}
```
（有効な付与＝解除済みでないもののみ。`revoked_at` は常に `null`）

### `POST /api/admin/comp-grants`

リクエスト: `{ "email": "user@example.com", "note": "理由の文字列（必須・空不可）" }`

レスポンス（200。新規付与・重複の冪等どちらも同じ形。冪等時は `already_granted: true`）:
```json
{
  "id": 1,
  "email": "user@example.com",
  "target_user_id": "uuid文字列 または null",
  "resolved": true,
  "granted_by_email": "admin@ureshiru.com",
  "granted_at": "2026-08-28T10:00:00",
  "revoked_at": null,
  "revoked_by_email": null,
  "note": "◯◯社の導入検証用",
  "already_granted": false
}
```

エラー:
- `409`: 対象メールに既存のStripe契約がある場合。`detail`は日本語の説明文字列
- `422`: `email`/`note`のバリデーションエラー（上記「重要な注意」参照）
- `403`: 非管理者、または閲覧モード中

### `POST /api/admin/comp-grants/{id}/revoke`

レスポンス（200）:
```json
{
  "id": 1,
  "email": "user@example.com",
  "target_user_id": "uuid文字列 または null",
  "resolved": true,
  "granted_by_email": "admin@ureshiru.com",
  "granted_at": "2026-08-28T10:00:00",
  "revoked_at": "2026-08-28T11:00:00",
  "revoked_by_email": "admin@ureshiru.com",
  "note": "◯◯社の導入検証用",
  "subscription_touched": true
}
```

エラー:
- `404`: 対象の付与が見つからない（既に解除済み等）
- `403`: 非管理者、または閲覧モード中

## 検証

`npm run build`（型エラー0必須）に加え、ヘッドレスブラウザ等で以下を確認すること
（バックエンドはローカルで `SUPABASE_JWT_SECRET` を設定して認証有効化し、自作JWTで管理者アカウントを
模倣する必要がある。区切り1・2の検証で使った手順と同様。ローカルに実Supabaseが無い場合、
`GET /api/admin/accounts` は `configured:false` になるが、`GET /api/admin/comp-grants` は
Supabase Admin API設定に依存しないため、comp管理セクション自体の一覧表示・付与・解除は
ローカルでも一通り確認できる）:

- `/admin` にアクセスして「無償提供の管理」セクションが表示される
- note欄を空のまま「付与する」ボタンが無効化されていることを確認
- メール・noteを入力して送信 → 確認ダイアログが出る（対象・変更内容・影響が表示される）→
  チェックを入れないと実行ボタンが押せない → 実行 → 一覧に反映される
- 一覧の「解除」ボタン → 確認ダイアログ → 実行 → 一覧から消える（または状態が変わる）
- 既存Stripe契約ありのメールへの付与で409エラーが画面にエラーメッセージとして表示される
  （ローカルでは実際にStripe契約のあるテストユーザーを再現するのが難しい場合、コード上
  エラーハンドリングが `Notice` コンポーネントに正しく繋がっていることの確認でよい）
- `Billing.tsx`: comp状態のユーザー（Subscriptionの`status`を直接`"comp"`にしたテストデータ等）
  でログインし、「無償提供中（期間の定めなし）」表示・「解約をご希望の場合」カード非表示・
  「お支払い方法の変更」ボタン非表示（自動）を確認
- コンソールエラー0

## 納品方法

このリポジトリの標準運用に従い、変更はブランチを切ってコミット → プッシュ → Pull Request を作成する
（mainへの直接pushはしない）。**GitHub連携でpush・PR作成ができない環境の場合は、`main` からの累積差分
パッチ（SHA256・対象ファイル一覧つき、`git apply --check` の手順を明記）をチャット上で提示する形に
切り替える**（このリポジトリの標準運用。詳細はCLAUDE.mdの「Coworkからの変更の受け渡しはパッチ運用で
固定する」節を参照。累積差分は必ず現在の `main`＝PR #70マージ後の状態からのものにすること）。

PRの説明文には「`docs/jisso_keikaku_comp_management_2026-08-28.md` の区切り3に対応」と明記すること。
