# Cowork タスク指示書: 管理画面からの無償アカウント招待（メール送信つき） 区切り3（フロントエンド）

対象リポジトリ: `rakuten-kpi-app`（このファイルが置かれているリポジトリそのもの）。
このファイル1本だけ読めば作業できるように、背景から書く。

## 背景

このプロダクト「ウレシル」は楽天出店者向けのKPI管理SaaS。管理者専用画面 `/admin`
（`frontend/src/pages/AdminAccounts.tsx`）には既に「無償提供（comp）の管理」セクションが
実装済み・本番稼働中（計画書 `docs/jisso_keikaku_comp_management_2026-08-28.md`）。これは
**既にSupabaseにアカウントがあるメール**に対して、無料で全機能を使える状態（comp）を
付与・解除する機能。

今回の追加機能は、その上に乗る**「メールアドレスだけでアカウントを新規作成し、comp付与＋
招待メール送信までを一度に行う」**もの。実装計画書は
`docs/jisso_keikaku_comp_invite_2026-08-31.md`（§9が確認事項＝評定確定内容）。

バックエンド（区切り1・2）は実装・検証済みで
[PR #84](https://github.com/Shoichiro12/rakuten-kpi-app/pull/84) としてブランチ
`claude/jisso-keikaku-comp-invite-58a4c3` にpush済み（まだmain未マージの可能性がある。
作業開始前に `git log origin/main` でこのPRがマージ済みか確認し、**未マージなら
マージを待つか、mainではなくこのブランチから作業ブランチを切ること**）。ローカルの
自作HS256トークン＋Supabase/SMTPをフェイクに差し替えたuvicorn実起動で29項目検証済み
（詳細はCLAUDE.md申し送り台帳の当該行、またはPR #84の説明文を参照）。

**このタスクはその区切り3＝フロントエンドの実装。バックエンドのAPIは既に確定・動作
しているので、`backend/` のコードは一切変更しない。**

### 仕組みのおさらい（フロント実装に必要な分だけ）

- 招待は「メールアドレスと理由（note）・任意のメッセージを入れて送信ボタンを押す」だけの
  1ステップ操作。裏側でバックエンドが (1) Supabaseにアカウントを新規作成 (2) 既存のcomp付与
  ロジックを通す (3) 招待メール（ログイン用リンク入り）を送信、の3つを1リクエストで行う
- **既に登録済みのメールを招待しようとすると409で拒否される。** その場合は既存の
  「無償提供の管理」セクションの通常の付与フォーム（`CompManagement`。招待ではなく直接付与）
  を使ってもらう、という案内をエラーメッセージがそのまま伝える（`detail`は日本語の
  文字列なので `Notice` にそのまま表示すればよい）
- 招待メールの送信自体が失敗しても（SMTPの一時的な障害等）、**アカウント作成とcomp付与は
  取り消されない**。一覧に「未送信」状態で残り、「再送」ボタンから送り直せる
  （作り直しはしない。同じメールへ再度「招待する」を送ると409になる＝これが正しい動線ではない。
  必ず一覧の「再送」ボタンを使うこと）
- 再送は前回の送信から60秒以内だと429で拒否される（連打防止。フロントは「しばらく
  お待ちください」等を出せばよく、カウントダウン等の作り込みは不要）
- 招待経由でない（直接付与された）行に対して再送を呼ぶと400になる。**一覧に招待経由の行と
  直接付与の行が混在する**ため、「再送」ボタンは招待経由の行にだけ出すこと（判定方法は
  下記の型・APIコントラクト節を参照）
- 招待リンクを開いたユーザーは、パスワードを設定する画面（既存のパスワード再設定画面を流用）
  に遷移し、設定完了後そのままダッシュボードが開く。comp付与済みなので課金導線は出ない
  （既存のcomp対応がそのまま効くため、この点はフロント側で何もしなくてよい）

## やること

### 1. `frontend/src/types/index.ts` の `CompGrant` に2フィールドを追加

現在の定義（1104〜1115行目付近）:
```ts
export interface CompGrant {
  id: number
  email: string
  target_user_id: string | null
  resolved: boolean
  granted_by_email: string | null
  granted_at: string
  revoked_at: string | null
  revoked_by_email: string | null
  note: string
}
```

これに2フィールドを追加する（バックエンドは既にこの2つを返している。§14の実装で追加済み）:

```ts
export interface CompGrant {
  id: number
  email: string
  target_user_id: string | null
  resolved: boolean
  granted_by_email: string | null
  granted_at: string
  revoked_at: string | null
  revoked_by_email: string | null
  note: string
  /** 招待メールの最終送信日時（ISO8601）。null = 招待経由でない通常のcomp付与 */
  invited_at: string | null
  /** 'sent' | 'failed' | null（null = 招待経由でない） */
  invite_status: 'sent' | 'failed' | null
}
```

**既存の `CompManagement`（`AdminAccounts.tsx`）や `CompGrantCreateResponse` /
`CompGrantRevokeResponse` は自動的にこの2フィールドを持つようになるが、既存コードは
これらを参照していないので挙動は変わらない。** 型を広げるだけの変更。

続けて、同じセクション（1120行目付近、`CompGrantCreateResponse` の下）に招待専用の
レスポンス型を追加する:

```ts
export interface CompInviteResponse extends CompGrant {
  /** true = 既に有効な付与があり、新規作成せずそれを返した（冪等）。招待では通常false */
  already_granted: boolean
}
```

（`POST /invites` と `POST /invites/{id}/resend` は同じ形のレスポンスを返すので、型は
共用する。`resend` のレスポンスには `already_granted` が無いが、TypeScript の構造的型付けで
「余分なフィールドが無い」ことは許容されるため、`CompInviteResponse` をそのまま両方の
戻り値型として使ってよい。resend 側は使わないフィールドとして無視すればよい）

### 2. `frontend/src/lib/api.ts` の `admin.comp` に `invite`/`resend` を追加

現在の `admin.comp`（699〜714行目付近）の末尾に追記する。**既存の `list`/`grant`/`revoke`
は変更しない。**

```ts
comp: {
  /** 有効な無償提供の一覧 */
  list: () =>
    request<import('../types').CompGrantListResponse>('/admin/comp-grants'),
  /** 付与する（note必須。空のままの送信はフロント側でボタン無効化して防ぐ） */
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
  /* ─── 招待（アカウント作成＋comp付与＋メール送信を1回で行う。計画書
     docs/jisso_keikaku_comp_invite_2026-08-31.md 区切り1・2はバックエンド実装済み。PR #84） ─── */
  /** 招待する（email/note必須。message任意。既存アカウントは409） */
  invite: (email: string, note: string, message: string) =>
    request<import('../types').CompInviteResponse>('/admin/invites', {
      method: 'POST',
      body: JSON.stringify({ email, note, message: message || undefined }),
    }),
  /** 招待メールを再送する（同一アカウントへリンクを発行し直すだけ） */
  resendInvite: (grantId: number) =>
    request<import('../types').CompInviteResponse>(`/admin/invites/${grantId}/resend`, {
      method: 'POST',
    }),
},
```

### 3. `frontend/src/pages/AdminAccounts.tsx` の拡張

このファイルの `CompManagement` コンポーネント（67〜280行目）に手を入れる。
**既存のアカウント一覧テーブル・閲覧履歴セクション・`startView` 関数などは変更しない。**

#### 3-1. 一覧テーブルに「招待」列を追加

現在の一覧テーブル（172〜210行目）は「メール／状態／付与した管理者／付与日時／理由／操作」の
6列。ここに **「招待」列を1つ追加する**（「状態」列の右あたり、「理由」列の前が読みやすい）。
中身は `g.invite_status` で出し分ける:

- `g.invite_status === null` → 招待経由でない行。ダッシュ（`—`。既存の他セルと同じ書き方）
- `g.invite_status === 'sent'` → 送信日時（`formatDateTime(g.invited_at)`）＋
  `target_user_id` が解決済み（`g.resolved === true`）なら本人がまだログインしていないか
  どうかは comp-grants API からは分からない（このAPIは `last_sign_in_at` を返さない）ので、
  **ログイン済みかどうかの表示は今回のcomp一覧には出さない**（指示書§0で書いた「一覧に
  『招待』列」は送信状態のみで十分。アカウント一覧テーブル側には既に「最終ログイン」列が
  あるので、ログイン確認はそちらで代替できる。無理に両テーブルを突き合わせる作り込みは
  しないこと）
- `g.invite_status === 'failed'` → 「送信失敗」を目立つ色で表示（`text-alert` 等、既存の
  警告表現に合わせる）

同じ列（または隣）に **「再送」ボタン**を置く。表示条件は `g.invite_status !== null`
（＝招待経由の行にだけ出す。直接付与の行に出すと400エラーになるため）。ボタンの押下で
確認ダイアログは不要（再送はメール送信の再実行だけで、契約状態を変える操作ではないため。
既存の「解除」ボタンとは性質が違う）。ローディング中は他の行の操作と同様に `disabled`。

再送の実装イメージ:
```ts
const [resendingId, setResendingId] = useState<number | null>(null)

const doResend = async (grantId: number) => {
  setResendingId(grantId)
  setMsg({})
  try {
    const res = await api.admin.comp.resendInvite(grantId)
    setMsg({ info: `${res.email} に招待メールを再送しました。` })
    await loadGrants()
  } catch (e) {
    console.error('[CompManagement] 再送エラー:', e)
    setMsg({ error: e instanceof Error ? e.message : '招待メールの再送に失敗しました' })
  } finally {
    setResendingId(null)
  }
}
```
（429＝連打防止のエラーメッセージもバックエンドの `detail` がそのまま日本語文字列なので、
`Notice` にそのまま表示すればよい。フロント側で60秒のカウントダウン等は作り込まない）

#### 3-2. 「メールで招待」ブロックを新設

既存の「新しく付与する」フォーム（213〜255行目、直接付与用）とは**別のフォームとして**
その直後に配置する。**既存の直接付与フォームは変更しない。**「入口を2つにするだけで、
付与のロジックは1つ」という計画書の設計方針どおり、直接付与フォームと並存させる。

- 入力欄: メールアドレス（必須）・理由=note（必須）・メッセージ（任意、複数行の
  `<textarea>`。1000文字までなのでフロント側にも `maxLength={1000}` を付けてよい）
- **送信前プレビュー**: 実際に送るメール本文をそのまま表示する。バックエンドに文面生成の
  APIは無い（`backend/mail_templates.py` はバックエンド内部でしか使わない）ので、
  **フロント側で同じ文面を組み立てて表示する**。以下のロジックをそのまま実装すること
  （`backend/mail_templates.py::invite_body()` の移植。文言は一言一句このとおりにする。
  リンク部分だけは実際のリンクがまだ無いため `[実際のリンクはメール送信時に発行されます]`
  のようなプレースホルダにする）:

```ts
function buildInvitePreview(email: string, message: string): string {
  const trimmedMessage = message.trim()
  const lines = [
    `${email} 様`,
    '',
    '楽天市場向けの売上・広告KPI管理ツール「ウレシル」の中村です。',
    `${email} 様のアカウントを無償でご用意しましたので、ご案内します。`,
  ]
  if (trimmedMessage) lines.push('', trimmedMessage)
  lines.push(
    '',
    '■ はじめかた',
    '1. 下のリンクを開く（有効期限: 発行から1時間）',
    '   [実際のリンクはメール送信時に発行されます]',
    '2. パスワードを決めて保存する',
    '3. そのままダッシュボードが開きます',
    '',
    '■ ご利用について',
    '・費用はかかりません。カード登録も不要です',
    '・無償提供の終了時は、事前にこちらからご連絡します',
    '・使い方はアプリ内の「使い方ガイド」か、こちらをご覧ください',
    '  https://ureshiru.com/help.html',
    '',
    'ご不明な点はこのメールに返信いただくか、info@ureshiru.com までご連絡ください。',
    '',
    '--',
    'ウレシル（運営: 中村祥一郎）',
    'https://ureshiru.com',
    '利用規約 https://ureshiru.com/terms.html',
    'プライバシーポリシー https://ureshiru.com/privacy.html',
  )
  return lines.join('\n')
}
```

  プレビューは `<pre>` 等の等幅・改行保持表示で、入力（メール・メッセージ）を変更すると
  リアルタイムに更新される作りにする（別ボタンで都度生成、ではなくレンダリング時に毎回計算）

- 送信ボタン: 「招待メールを送る」。押下で確認ダイアログ（`ConfirmDeleteModal` を流用。
  下記4番参照）を開く。確認後に実際に `api.admin.comp.invite()` を呼ぶ
- 成功時（`already_granted` は招待では通常falseだが、念のため両方に対応する）:
  ```ts
  setMsg({ info: `${res.email} に招待メールを送信しました。` })
  ```
- 失敗時: `catch` した `e.message` をそのまま表示する。**409（既存アカウント）のエラー文言は
  バックエンドが「無償提供の付与は既存アカウントへの『無償提供を付与』から行ってください」と
  案内する文字列を返すので、そのまま表示すれば十分**（フロント側で追加の案内文を足す必要はない）。
  502（メール送信失敗）のときも、バックエンドの `detail`（「アカウントと無償提供の付与は
  完了しています。メール送信に失敗したので再送してください。」）をそのまま表示すればよい。
  **この502は失敗ではあるが、実際にはアカウント作成とcomp付与は完了しているので、
  一覧を再取得すること**（`await loadGrants()` を `catch` 節でも呼ぶ。招待フォームの成功時
  だけでなく、502エラー時も一覧に「送信失敗」の行が増えているはずなので、それが見えないと
  ユーザーが「再送」ボタンに気づけない）

### 4. 確認ダイアログは `ConfirmDeleteModal` を流用（既存パターンを踏襲）

直接付与・解除と同じく、新規コンポーネントは作らず `frontend/src/components/ConfirmDeleteModal.tsx`
を使う。

```tsx
<ConfirmDeleteModal
  open={confirmInvite !== null}
  title="招待メールを送信します"
  message={`宛先: ${confirmInvite?.email ?? ''}\nこのメールアドレスでアカウントが作成され、無償提供が有効になります。\n上記のプレビューのとおりメールが送信されます。`}
  confirmLabel="送信する"
  checkboxLabel="内容を確認しました"
  onConfirm={doInvite}
  onCancel={() => setConfirmInvite(null)}
  loading={busy}
/>
```

再送（3-1）には確認ダイアログを付けない（上記のとおり性質が違うため）。

### 5. `type=invite` でのパスワード設定画面

招待リンクを開いたユーザーが最初に見る画面。**新しいページを作るのではなく、既存の
`frontend/src/pages/ResetPassword.tsx`（パスワード再設定画面）を流用する。**

#### 背景（なぜ単純に `PASSWORD_RECOVERY` イベントに乗れないか）

現在 `frontend/src/App.tsx`（83〜97行目・119〜122行目）は、Supabaseの
`onAuthStateChange` が発火する `PASSWORD_RECOVERY` イベントだけを見て `ResetPassword` を
表示している:

```ts
const [recovering, setRecovering] = useState(false)

useEffect(() => {
  if (!supabase) return
  supabase.auth.getSession().then(({ data }) => {
    setSession(data.session)
    setAuthReady(true)
  })
  const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
    if (event === 'PASSWORD_RECOVERY') setRecovering(true)
    setSession(s)
  })
  return () => sub.subscription.unsubscribe()
}, [])
...
if (recovering) {
  return <ResetPassword onDone={() => setRecovering(false)} />
}
```

**招待リンク（`type=invite`）ではSupabaseは `PASSWORD_RECOVERY` イベントを発火しない**
（invite用の専用イベントは無い。招待リンクを開くとそのまま `SIGNED_IN` 相当の扱いになる）。
そのため、招待かどうかは **URLのハッシュ/クエリに含まれる `type=invite` を直接見て判定する
必要がある**。この判定はSupabaseクライアントがハッシュを消費してしまう前に行う必要があるため、
`useState` の遅延初期化（lazy initializer）でマウント時の一度だけ読む:

```ts
const [isInviteLink] = useState(() => {
  // ハッシュ形式（#access_token=...&type=invite）とクエリ形式（?type=invite）の両対応。
  // Supabaseのバージョンやリダイレクト方式でどちらも起こり得るため両方見る。
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const searchParams = new URLSearchParams(window.location.search)
  return hashParams.get('type') === 'invite' || searchParams.get('type') === 'invite'
})
```

これを `App.tsx` の `recovering` state の近くに追加し、表示条件を拡張する:

```ts
if (recovering || isInviteLink) {
  return <ResetPassword onDone={() => { setRecovering(false) }} isInvite={isInviteLink} />
}
```

**注意**: `isInviteLink` は一度trueになったら（ページをリロードしない限り）ずっとtrueのまま
でよい（`recovering` のように `false` に戻すロジックは不要。`onDone` 内で `setRecovering(false)`
だけ呼べば、次のレンダリングで `recovering` も `isInviteLink` も両方falseなら通常のログイン
判定に進む。ただし `isInviteLink` は `useState` の初期値のみで更新されないので、
`onDone` の中で明示的に `false` へセットする必要はない——**ページ遷移せずアプリ本体の
表示に進めるためには、`isInviteLink` も見なくなるように、`onDone` を呼んだあとの分岐で
別途 `isInviteLink` を無視するフラグを持たせる**か、シンプルに **`isInviteLink` 自体を
`useState` ではなく `let` 変数に一度だけ読ませてから `recovering` 同様の可変stateへ
コピーする**方式にしてもよい。実装のしやすい方でよいが、**「パスワード設定完了後に
アプリ本体（ダッシュボード）へ実際に遷移できること」を必ず動作確認すること**（下記
検証節参照）。

#### `ResetPassword.tsx` の変更

`isInvite` propを追加し、見出しだけ出し分ける（フォーム・送信ロジック・`updateUser` の
呼び出しは完全に共通のまま。招待もパスワード再設定も「今のセッションに新しいパスワードを
設定する」という点で処理は同一）:

```tsx
interface Props {
  onDone: () => void
  isInvite?: boolean
}

export default function ResetPassword({ onDone, isInvite = false }: Props) {
  ...
  <h1 className="text-xl font-bold text-gray-900">
    {isInvite ? 'パスワードを設定してください' : 'パスワード再設定'}
  </h1>
  <p className="text-xs text-gray-500 mt-1">
    {isInvite ? 'ログインに使うパスワードを決めてください' : '新しいパスワードを入力してください'}
  </p>
  ...
  {done && (
    <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
      {isInvite ? 'パスワードを設定しました。' : 'パスワードを再設定しました。'}
    </p>
  )}
  ...
  <button type="submit" ...>
    {loading ? <Loader2 .../> : <KeyRound .../>}
    {isInvite ? 'パスワードを設定' : 'パスワードを再設定'}
  </button>
```

「アプリへ進む」ボタン（`onDone` を呼ぶボタン）はそのまま共通でよい（文言も変更不要）。

#### Googleログインについて（対応不要・念のための確認事項）

計画書§3-5の補足のとおり、本番でGoogleログインは無効
（`VITE_ENABLE_GOOGLE_LOGIN` 未設定）。招待メールの文面にもGoogleログインへの言及は無い。
**このタスクでGoogleログイン関連のコードには一切触れないこと。**

## やらないこと（スコープ外）

- `backend/` のコードは一切変更しない（区切り1・2で確定済み・検証済み）
- 既存の「無償提供の管理」セクションの直接付与フォーム・一覧の既存5列（メール／状態／
  付与した管理者／付与日時／理由）・解除ボタンの実装は変更しない（招待列の追加・招待
  ブロックの新設のみ）
- 招待メール本文の管理画面編集機能は作らない（差し込みメッセージのみ。計画書§7で明記済み）
- HTMLメールのプレビュー（リッチテキスト表示）は作らない。プレーンテキストの `<pre>` 表示でよい
- 招待の一括送信（CSV等）は作らない
- Googleログインの有効化・関連コードの変更はしない
- サイドバーへのナビ項目追加はしない（`/admin` は既存どおり直接アクセスのみ。§3の
  管理者閲覧機能の評定Q3を踏襲）

## APIコントラクト（バックエンド実装済み・ローカルで動作確認済み。この節を正として実装すること）

すべて `Authorization: Bearer <管理者のJWT>` が必要（管理者以外は403、未ログインは401）。
書き込み系（`POST`）はさらに、閲覧モード中（`X-Admin-View-Session`ヘッダあり）なら403になる。

### `POST /api/admin/invites`

リクエスト:
```json
{ "email": "user@example.com", "note": "理由の文字列（必須・空不可）", "message": "任意のメッセージ（省略可・1000字まで）" }
```

レスポンス（200）:
```json
{
  "id": 5,
  "email": "user@example.com",
  "target_user_id": "uuid文字列",
  "resolved": true,
  "granted_by_email": "admin@ureshiru.com",
  "granted_at": "2026-08-31T10:00:00",
  "revoked_at": null,
  "revoked_by_email": null,
  "note": "理由の文字列",
  "invited_at": "2026-08-31T10:00:00.123456",
  "invite_status": "sent",
  "already_granted": false
}
```

エラー:
- `400`: `email`/`note`/`message` のバリデーションエラー（形式不正・空・文字数超過）。
  `detail`は日本語の説明文字列
- `409`: 対象メールが既にSupabaseに登録済み。`detail`は「既存アカウントへの付与から
  行ってください」という趣旨の日本語文字列
- `403`: 非管理者、または閲覧モード中
- `501`: サーバーにSupabase Admin API（`SUPABASE_SERVICE_ROLE_KEY`）が未設定
- `502`: 招待リンクの発行、またはメール送信に失敗（`detail`にどちらが失敗したか含まれる。
  メール送信失敗の場合はアカウント・comp付与は完了済みという文言）

### `POST /api/admin/invites/{grant_id}/resend`

リクエストボディなし。レスポンス形（200）は `POST /invites` と同じ形
（`already_granted` フィールドは含まれない）。

エラー:
- `404`: 対象の付与が見つからない（解除済み等）
- `400`: 対象の付与が招待経由でない（直接付与された行）
- `429`: 前回の送信から60秒以内
- `403`: 非管理者、または閲覧モード中
- `502`: メール送信に失敗（`invite_status` は `"failed"` になり、一覧に残る）

## 検証

`npm run build`（型エラー0必須）に加え、ヘッドレスブラウザ等で以下を確認すること
（バックエンドはローカルで `SUPABASE_JWT_SECRET`/`ADMIN_USER_ID` を設定して認証を有効化し、
自作JWTで管理者アカウントを模倣する。区切り1・2の検証で使った手順と同様。実Supabase/実SMTPが
無い場合、`supabase_admin`/`notifications.send_invite` をフェイクに差し替えてサーバーを
起動する必要がある——区切り1・2の検証スクリプトと同じ考え方でよい。**このタスクは
バックエンドを変更しないので、フェイク差し替えはテスト実行時だけの一時的なものにし、
`backend/` のソース自体は変更しないこと**）:

- `/admin` にアクセスして「無償提供の管理」セクションに「メールで招待」ブロックが表示される
- メール・理由を入力すると送信前プレビューにメール本文が表示される。メッセージ欄に入力すると
  プレビューに反映される。メッセージが空のときプレビューに連続空行が出ない
- note欄を空のまま送信ボタンが無効化されている（既存の直接付与フォームと同じ挙動）
- 送信 → 確認ダイアログ → チェックを入れないと実行ボタンが押せない → 実行 → 一覧に新しい行が
  「送信済み」（招待列）で反映される
- 既存アカウントのメールで招待すると409エラーがメッセージとして表示される
- 一覧の招待経由の行にだけ「再送」ボタンが出る（直接付与の行には出ない）
- 再送ボタンを押すと成功メッセージが出て一覧が更新される。60秒以内に連続で押すと429エラーが
  表示される
- （バックエンドをフェイクでメール送信失敗させた場合）502エラー後も一覧に「送信失敗」の行が
  残り、「再送」ボタンから送り直せることを確認
- `type=invite` のURLハッシュを手動で付けて（例: 開発サーバーで
  `http://localhost:5173/#access_token=dummy&type=invite`）アクセスすると、通常のログイン画面
  ではなく「パスワードを設定してください」の画面が出ることを確認（実際の
  `updateUser` 呼び出しが通るかは実Supabaseが必要なので、**画面の出し分けだけ確認できれば
  十分**。フォーム送信自体のE2Eは区切り4でオーナーが実施する）
- 通常のパスワード再設定（`PASSWORD_RECOVERY`）の既存動作に回帰が無いことを確認
  （見出しが「パスワード再設定」のまま出ること）
- コンソールエラー0

## 納品方法

このリポジトリの標準運用に従い、ブランチを切ってコミット → プッシュ → Pull Request を作成する
（mainへの直接pushはしない）。**GitHub連携でpush・PR作成ができない環境の場合は、`main` からの
累積差分パッチ（SHA256・対象ファイル一覧つき、`git apply --check` の手順を明記）をチャット上で
提示する形に切り替える**（このリポジトリの標準運用。詳細はCLAUDE.mdの「Coworkからの変更の
受け渡しはパッチ運用で固定する」節を参照）。**このタスクの時点でPR #84（区切り1・2）が
まだmainに未マージの場合、差分の起点は `main` ではなく `claude/jisso-keikaku-comp-invite-58a4c3`
にすること**（型定義・APIの前提がこのブランチにしか無いため）。マージ済みなら通常どおり
`main` を起点にしてよい。

PRの説明文には「`docs/jisso_keikaku_comp_invite_2026-08-31.md` の区切り3に対応」と明記すること。
