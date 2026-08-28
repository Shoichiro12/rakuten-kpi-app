import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, Loader2, RefreshCw, ShieldAlert } from 'lucide-react'
import Header from '../components/layout/Header'
import { api } from '../lib/api'
import { getViewSession, parseServerDate, setViewSession } from '../lib/adminView'
import { formatCount } from '../lib/format'
import type { AdminAccountRow, AdminAccountsResponse, AdminViewSessionRecord } from '../types'

/**
 * 管理者用アカウント一覧（計画書 docs/jisso_keikaku_admin_viewer_2026-08-26.md 区切り3）。
 *
 * `/admin` に直接アクセスして使う社内専用画面。サイドバーには載せない（評定Q3で確定）。
 * 管理者以外がアクセスすると `/api/admin/accounts` が403を返すので、その旨を表示するだけで
 * 画面側に別の権限判定は持たない（判定の単一の真実は backend/admin_guard.py）。
 */

const STATUS_LABEL: Record<string, string> = {
  trialing: 'トライアル中',
  active: '契約中',
  past_due: '支払い確認中',
  unpaid: '未払い',
  canceled: '解約済み',
}

function statusLabel(status: string | null): string {
  if (!status) return '未契約'
  return STATUS_LABEL[status] ?? status
}

/** 社内専用画面なので素朴な日時表示でよいが、`Invalid Date` は出さない */
function formatDateTime(value: string | null): string {
  const d = parseServerDate(value)
  if (!d) return '—'
  return d.toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/** メッセージ表示（AccountSettings.tsx の Notice と同じ形） */
function Notice({ error, info }: { error?: string | null; info?: string | null }) {
  if (error) return <p className="text-xs text-alert bg-alert-bg border border-alert/30 rounded-lg px-3 py-2">{error}</p>
  if (info) return <p className="text-xs text-up bg-up-bg border border-up/30 rounded-lg px-3 py-2">{info}</p>
  return null
}

const TH = 'px-3 py-2 text-left text-xs font-bold text-sub whitespace-nowrap'
const TD = 'px-3 py-2 text-sm text-ink align-middle'

export default function AdminAccounts() {
  const navigate = useNavigate()
  const [data, setData] = useState<AdminAccountsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startingId, setStartingId] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const current = getViewSession()

  // 閲覧履歴（監査ログ）。折りたたみを開いたときだけ取得する
  const [history, setHistory] = useState<AdminViewSessionRecord[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.admin.accounts()
      setData(res ?? { accounts: [], configured: false, count: 0 })
    } catch (e) {
      console.error('[AdminAccounts] 取得エラー:', e)
      setError(e instanceof Error ? e.message : 'アカウント一覧の取得に失敗しました')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const loadHistory = async () => {
    if (history) return
    setHistoryError(null)
    try {
      const res = await api.admin.viewSessions()
      setHistory(res?.sessions ?? [])
    } catch (e) {
      console.error('[AdminAccounts] 閲覧履歴の取得エラー:', e)
      setHistoryError(e instanceof Error ? e.message : '閲覧履歴の取得に失敗しました')
    }
  }

  const startView = async (row: AdminAccountRow) => {
    setStartingId(row.user_id)
    setStartError(null)
    try {
      const res = await api.admin.startViewSession(row.user_id)
      // 生トークンはこのレスポンスにしか無い。必要な項目だけ sessionStorage に保存する
      setViewSession({
        id: res.id,
        session_token: res.session_token,
        target_user_id: res.target_user_id,
        target_email: res.target_email,
        expires_at: res.expires_at,
      })
      navigate('/')
    } catch (e) {
      console.error('[AdminAccounts] 閲覧開始エラー:', e)
      setStartError(e instanceof Error ? e.message : '閲覧セッションを開始できませんでした')
      setStartingId(null)
    }
  }

  return (
    <div className="h-full flex flex-col">
      <Header
        title="アカウント一覧（管理者）"
        subtitle="顧客アカウントの画面を読み取り専用で閲覧できます。閲覧の開始・終了は記録されます"
        actions={
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-sub border rounded-lg px-2.5 py-1.5 hover:bg-bg-alt disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
            再読み込み
          </button>
        }
      />

      <div className="p-6 space-y-4">
        {current && (
          <Notice info={`現在 ${current.target_email ?? current.target_user_id} を閲覧中です。別のアカウントの「この画面を見る」を押すと、いまの閲覧は自動的に終了します。`} />
        )}
        <Notice error={startError} />

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            読み込み中...
          </div>
        )}

        {!loading && error && (
          <div className="bg-paper rounded-xl border border-line p-5 space-y-2">
            <p className="flex items-center gap-2 text-sm font-bold text-alert">
              <ShieldAlert size={16} aria-hidden="true" />
              アカウント一覧を取得できませんでした
            </p>
            <p className="text-sm text-sub">{error}</p>
            <p className="text-xs text-muted">この画面は管理者アカウント（環境変数 ADMIN_USER_ID に設定したユーザー）でログインしている場合のみ利用できます。</p>
          </div>
        )}

        {!loading && !error && data && !data.configured && (
          <div className="bg-paper rounded-xl border border-line p-5 text-sm text-sub">
            Supabase Admin APIが未設定のため一覧を取得できません（環境変数 <code className="font-num">SUPABASE_URL</code> / <code className="font-num">SUPABASE_SERVICE_ROLE_KEY</code> を確認してください）。
          </div>
        )}

        {!loading && !error && data && data.configured && (
          <div className="bg-paper rounded-xl border border-line overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-bg-alt border-b border-line">
                <tr>
                  <th className={TH}>メール</th>
                  <th className={TH}>店舗名</th>
                  <th className={TH}>登録日</th>
                  <th className={TH}>最終ログイン</th>
                  <th className={TH}>課金状態</th>
                  <th className={`${TH} text-center`}>データ取込</th>
                  <th className={TH}><span className="sr-only">操作</span></th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.length === 0 && (
                  <tr>
                    <td colSpan={7} className={`${TD} text-muted text-center py-6`}>登録アカウントがありません</td>
                  </tr>
                )}
                {data.accounts.map((row) => {
                  const isCurrent = current?.target_user_id === row.user_id
                  return (
                    <tr key={row.user_id} className="border-t border-line hover:bg-bg-alt">
                      <td className={`${TD} break-all`}>
                        {row.email ?? <span className="text-muted">（メール不明）</span>}
                        {isCurrent && <span className="ml-2 rounded-full bg-alert-bg px-2 py-0.5 text-xs font-bold text-alert">閲覧中</span>}
                      </td>
                      <td className={TD}>{row.shop_name ?? <span className="text-muted">—</span>}</td>
                      <td className={`${TD} tabular-nums whitespace-nowrap`}>{formatDateTime(row.created_at)}</td>
                      <td className={`${TD} tabular-nums whitespace-nowrap`}>
                        {row.last_sign_in_at ? formatDateTime(row.last_sign_in_at) : <span className="text-muted">未ログイン</span>}
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>{statusLabel(row.subscription_status)}</td>
                      <td
                        className={`${TD} text-center tabular-nums`}
                        title={`RPP ${formatCount(row.rpp_rows)} 行 / 商品分析 ${formatCount(row.monthly_rows)} 行`}
                      >
                        {row.has_data ? <span className="text-up font-bold">✓</span> : <span className="text-muted">−</span>}
                      </td>
                      <td className={`${TD} text-right whitespace-nowrap`}>
                        <button
                          type="button"
                          onClick={() => startView(row)}
                          disabled={startingId !== null}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-ink-strong px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-strong focus-visible:ring-offset-2"
                        >
                          {startingId === row.user_id
                            ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                            : <Eye size={13} aria-hidden="true" />}
                          この画面を見る
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="px-3 py-2 text-xs text-muted border-t border-line tabular-nums">{formatCount(data.count)} 件</p>
          </div>
        )}

        {!loading && !error && data && (
          <details className="bg-paper rounded-xl border border-line" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) loadHistory() }}>
            <summary className="cursor-pointer px-5 py-3 text-sm font-bold text-ink select-none">閲覧履歴（監査ログ・自分が開始した分）</summary>
            <div className="px-5 pb-4">
              <Notice error={historyError} />
              {!history && !historyError && (
                <p className="text-xs text-muted">読み込み中...</p>
              )}
              {history && history.length === 0 && (
                <p className="text-xs text-muted">閲覧履歴はまだありません</p>
              )}
              {history && history.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead className="border-b border-line">
                      <tr>
                        <th className={TH}>対象</th>
                        <th className={TH}>開始</th>
                        <th className={TH}>終了</th>
                        <th className={TH}>失効</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((s) => (
                        <tr key={s.id} className="border-t border-line">
                          <td className={`${TD} text-xs break-all`}>{s.target_email ?? s.target_user_id}</td>
                          <td className={`${TD} text-xs tabular-nums whitespace-nowrap`}>{formatDateTime(s.started_at)}</td>
                          <td className={`${TD} text-xs tabular-nums whitespace-nowrap`}>
                            {s.ended_at ? formatDateTime(s.ended_at) : <span className="text-alert font-bold">未終了</span>}
                          </td>
                          <td className={`${TD} text-xs tabular-nums whitespace-nowrap`}>{formatDateTime(s.expires_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
