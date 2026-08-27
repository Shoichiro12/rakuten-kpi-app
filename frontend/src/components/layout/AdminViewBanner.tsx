import { useCallback, useEffect, useState } from 'react'
import { Eye, Loader2, LogOut } from 'lucide-react'
import { api } from '../../lib/api'
import {
  ADMIN_VIEW_CHANGED_EVENT,
  clearViewSession,
  getViewSession,
  parseServerDate,
  type AdminViewSessionState,
} from '../../lib/adminView'

/**
 * 管理者閲覧モードのバナー（計画書 docs/jisso_keikaku_admin_viewer_2026-08-26.md 区切り3）。
 *
 * 閲覧セッションが有効な間（lib/adminView.ts にセッションがある間）だけ、レイアウト最上部に
 * 常時表示する。「読み取り専用」の明記は評定Q2で必須要件として確定しているので省略しない。
 * 書き込み系ボタンの個別 disabled 化はしない（評定Q2で見送り）。保存を押すとバックエンドの
 * 403「閲覧モードは読み取り専用です」が各ページの既存エラー表示に乗る。
 *
 * 残り時間は厳密なカウントダウンではなく、表示のたび＋1分ごとに再計算する目安。
 */

function remainingLabel(expiresAt: string, now: number): string {
  const exp = parseServerDate(expiresAt)
  if (!exp) return ''
  const diffMin = Math.floor((exp.getTime() - now) / 60000)
  if (diffMin <= 0) return '期限切れ'
  if (diffMin >= 60) {
    const h = Math.floor(diffMin / 60)
    const m = diffMin % 60
    return m > 0 ? `残り約${h}時間${m}分` : `残り約${h}時間`
  }
  return `残り約${diffMin}分`
}

export default function AdminViewBanner() {
  const [session, setSession] = useState<AdminViewSessionState | null>(() => getViewSession())
  const [now, setNow] = useState(() => Date.now())
  const [ending, setEnding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 開始（AdminAccounts → setViewSession）・終了・401自動解除のたびに読み直す
  const refresh = useCallback(() => {
    setSession(getViewSession())
    setNow(Date.now())
  }, [])

  useEffect(() => {
    window.addEventListener(ADMIN_VIEW_CHANGED_EVENT, refresh)
    return () => window.removeEventListener(ADMIN_VIEW_CHANGED_EVENT, refresh)
  }, [refresh])

  // 残り時間の目安を1分ごとに更新（セッションが無ければタイマーも張らない）
  useEffect(() => {
    if (!session) return
    const t = window.setInterval(() => setNow(Date.now()), 60000)
    return () => window.clearInterval(t)
  }, [session])

  if (!session) return null

  const endView = async () => {
    setEnding(true)
    setError(null)
    try {
      // /api/admin/* は X-Admin-View-Session の影響を受けない（バックエンド側で除外済み）ので、
      // トークンを付けたまま呼んでよい。先にローカル状態を消す必要は無い
      await api.admin.endViewSession(session.id)
    } catch (e) {
      // サーバー側で既に終了・失効していても、この端末の閲覧状態は消して構わない
      // （残しておくと以降のAPIが401で止まり続ける）。メッセージは出すが処理は続行する
      console.warn('[AdminViewBanner] 閲覧終了APIエラー:', e)
      setError(e instanceof Error ? e.message : '閲覧の終了に失敗しました')
    }
    clearViewSession()
    // 対象アカウントのデータで開いていた各画面の state を確実に捨てるためフルリロードで /admin へ
    window.location.href = '/admin'
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 bg-alert text-white text-sm"
    >
      <span className="inline-flex items-center gap-2 font-bold">
        <Eye size={16} aria-hidden="true" />
        閲覧モード: <span className="font-num break-all">{session.target_email ?? session.target_user_id}</span>
        （読み取り専用）
      </span>
      <span>保存・削除はできません</span>
      <span className="text-white/80 tabular-nums">{remainingLabel(session.expires_at, now)}</span>
      {error && <span className="text-white/90 text-xs">{error}</span>}
      <button
        type="button"
        onClick={endView}
        disabled={ending}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-1 text-xs font-bold text-alert hover:bg-white disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        {ending ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <LogOut size={13} aria-hidden="true" />}
        閲覧を終了
      </button>
    </div>
  )
}
