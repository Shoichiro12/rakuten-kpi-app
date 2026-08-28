/**
 * 管理者閲覧モードのセッション状態（計画書 docs/jisso_keikaku_admin_viewer_2026-08-26.md 区切り3）。
 *
 * サーバーが発行した閲覧セッショントークンをブラウザ側で保持する薄いストア。
 * `api.ts` の authHeaders() がここから取り出して `X-Admin-View-Session` ヘッダに載せる。
 *
 * 保存先は sessionStorage（localStorage ではない）。閲覧セッションは顧客データへの
 * 読み取り経路そのものなので、ブラウザ（タブ）を閉じたら消える方を選んでいる。
 * サーバー側にも2時間の自動失効があるが、それとは別にブラウザ側でも残さない。
 *
 * sessionStorage はプライベートモード等で例外を投げることがあるので必ず握りつぶす
 * （Sidebar.tsx の localStorage と同じ作法）。
 */

const STORAGE_KEY = 'ureshiru:admin-view-session'

/**
 * 閲覧セッションの開始・終了を同一タブ内の他コンポーネント（AdminViewBanner）へ伝える
 * イベント名。sessionStorage の `storage` イベントは別タブにしか飛ばないため、
 * 自タブ内は自前で通知する（FeedbackModal の OPEN_FEEDBACK_EVENT と同じ作法）。
 */
export const ADMIN_VIEW_CHANGED_EVENT = 'ureshiru:admin-view-changed'

function notifyChanged(): void {
  try {
    window.dispatchEvent(new Event(ADMIN_VIEW_CHANGED_EVENT))
  } catch {
    /* 通知できなくても保存自体は成立している */
  }
}

/**
 * サーバーが返す日時文字列を Date にする。
 * バックエンドの AdminViewSession は `datetime.utcnow()`（naive UTC）を JSON 化しているため
 * `2026-08-28T12:00:00.000000` のようにタイムゾーン表記が無い。これをそのまま `new Date()` に
 * 渡すとブラウザのローカル時刻として解釈され、JSTでは残り時間が9時間ずれる。
 * 末尾にオフセット表記が無ければ UTC（`Z`）として扱う。Supabase 由来の `+00:00` 付きはそのまま。
 * 小数秒は3桁に丸める（仕様上 `.SSS` までが安全なため）。
 */
export function parseServerDate(value: string | null | undefined): Date | null {
  if (!value) return null
  let s = value.trim()
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(s)
  s = s.replace(/(\.\d{3})\d+/, '$1')
  if (!hasOffset) s += 'Z'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export interface AdminViewSessionState {
  id: number
  session_token: string
  target_user_id: string
  target_email: string | null
  expires_at: string // ISO8601
}

function isState(v: unknown): v is AdminViewSessionState {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === 'number'
    && typeof o.session_token === 'string'
    && typeof o.target_user_id === 'string'
    && (o.target_email === null || typeof o.target_email === 'string')
    && typeof o.expires_at === 'string'
  )
}

/** 現在の閲覧セッション情報。無ければ null */
export function getViewSession(): AdminViewSessionState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isState(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** セッショントークンだけを返す（api.ts の authHeaders() 用） */
export function getViewToken(): string | null {
  return getViewSession()?.session_token ?? null
}

/** 閲覧セッション開始APIのレスポンスから必要な項目だけを保存する */
export function setViewSession(session: AdminViewSessionState): void {
  const state: AdminViewSessionState = {
    id: session.id,
    session_token: session.session_token,
    target_user_id: session.target_user_id,
    target_email: session.target_email,
    expires_at: session.expires_at,
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* 保存できなくても動作に影響させない（このタブ内の閲覧は次のリロードで解除される） */
  }
  notifyChanged()
}

export function clearViewSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 消せなくても動作に影響させない */
  }
  notifyChanged()
}
