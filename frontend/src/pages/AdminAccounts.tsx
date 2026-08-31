import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, Gift, Loader2, Mail, RefreshCw, ShieldAlert } from 'lucide-react'
import Header from '../components/layout/Header'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import { api } from '../lib/api'
import { getViewSession, parseServerDate, setViewSession } from '../lib/adminView'
import { formatCount } from '../lib/format'
import type { AdminAccountRow, AdminAccountsResponse, AdminViewSessionRecord, CompGrant } from '../types'

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
  comp: '無償提供',
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

const INPUT_CLS =
  'w-full border border-line rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ink-strong'

/**
 * 招待メールの送信前プレビュー（backend/mail_templates.py::invite_body() の移植。
 * 文言は一言一句バックエンドと同じにすること。リンク部分だけは実際のリンクが
 * まだ無いためプレースホルダにする）。バックエンドに文面生成のAPIは無い。
 */
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

/**
 * 無償提供（comp）の管理セクション（計画書 docs/jisso_keikaku_comp_management_2026-08-28.md 区切り3）。
 *
 * 付与操作の起点になるため、閲覧履歴のような折りたたみにはせず常時表示のカードにする
 * （一覧もマウント時に自動取得）。付与・解除とも確認ダイアログ必須（評定・要件3）。
 * 確認ダイアログは既存の ConfirmDeleteModal を流用する（汎用propsを持つため。
 * 同じ挙動のモーダルを別名で増やさないこと）。
 *
 * note（付与理由）はバックエンドで必須（空は422。ただし422のdetailは配列形式で
 * parseJson() のメッセージが壊れるため、フロント側で空のままの送信ボタンを無効化して
 * この経路を通常操作では発生させない。指示書「重要な注意」参照）。
 */
function CompManagement({ onMutated }: { onMutated: () => void }) {
  const [grants, setGrants] = useState<CompGrant[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ error?: string; info?: string }>({})
  // 確認ダイアログの対象。付与は入力値のスナップショット、解除は対象行
  const [confirmGrant, setConfirmGrant] = useState<{ email: string; note: string } | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState<CompGrant | null>(null)

  // ── メールで招待（計画書 docs/jisso_keikaku_comp_invite_2026-08-31.md 区切り3） ──
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteNote, setInviteNote] = useState('')
  const [inviteMessage, setInviteMessage] = useState('')
  const [confirmInvite, setConfirmInvite] = useState<{ email: string; note: string; message: string } | null>(null)
  const [resendingId, setResendingId] = useState<number | null>(null)

  const loadGrants = useCallback(async () => {
    setListError(null)
    try {
      const res = await api.admin.comp.list()
      setGrants(res?.grants ?? [])
    } catch (e) {
      console.error('[CompManagement] 一覧取得エラー:', e)
      setListError(e instanceof Error ? e.message : '無償提供の一覧を取得できませんでした')
      setGrants(null)
    }
  }, [])

  useEffect(() => { loadGrants() }, [loadGrants])

  const doGrant = async () => {
    if (!confirmGrant) return
    setBusy(true)
    setMsg({})
    try {
      const res = await api.admin.comp.grant(confirmGrant.email, confirmGrant.note)
      if (res.already_granted) {
        // 冪等成功（同じメールへの重複付与）。エラーではなく情報として扱う
        setMsg({ info: `${res.email} には既に有効な無償提供があります（新しい付与は作成していません）。` })
      } else {
        setMsg({
          info: res.resolved
            ? `${res.email} に無償提供を付与しました。`
            : `${res.email} を先行登録しました。このメールでサインアップされると自動で確定します。`,
        })
      }
      setEmail('')
      setNote('')
      await loadGrants()
      onMutated()
    } catch (e) {
      // 409（既存Stripe契約あり）等。detail は日本語文字列なのでそのまま出す
      console.error('[CompManagement] 付与エラー:', e)
      setMsg({ error: e instanceof Error ? e.message : '無償提供の付与に失敗しました' })
    } finally {
      setBusy(false)
      setConfirmGrant(null)
    }
  }

  const doRevoke = async () => {
    if (!confirmRevoke) return
    setBusy(true)
    setMsg({})
    try {
      const res = await api.admin.comp.revoke(confirmRevoke.id)
      if (res.subscription_touched) {
        setMsg({ info: `${res.email} の無償提供を解除しました。対象アカウントは通常の未契約状態に戻ります。` })
      } else {
        // バックエンドが安全側に倒して契約データを触らなかったケース。失敗ではない
        setMsg({ info: `${res.email} の無償提供を解除しました（対象の契約状態は既に無償提供ではなかったため、契約データは変更していません）。` })
      }
      await loadGrants()
      onMutated()
    } catch (e) {
      console.error('[CompManagement] 解除エラー:', e)
      setMsg({ error: e instanceof Error ? e.message : '無償提供の解除に失敗しました' })
    } finally {
      setBusy(false)
      setConfirmRevoke(null)
    }
  }

  const doInvite = async () => {
    if (!confirmInvite) return
    setBusy(true)
    setMsg({})
    try {
      const res = await api.admin.comp.invite(confirmInvite.email, confirmInvite.note, confirmInvite.message)
      if (res.already_granted) {
        // 招待では通常falseだが、念のため両方に対応する（冪等成功はエラーにしない）
        setMsg({ info: `${res.email} には既に有効な無償提供があります。招待メールを送信しました。` })
      } else {
        setMsg({ info: `${res.email} に招待メールを送信しました。` })
      }
      setInviteEmail('')
      setInviteNote('')
      setInviteMessage('')
      await loadGrants()
      onMutated()
    } catch (e) {
      // 409（既存アカウント→直接付与への案内）・502（メール送信失敗→再送への案内）とも
      // バックエンドの detail が日本語の説明文字列なのでそのまま表示する
      console.error('[CompManagement] 招待エラー:', e)
      setMsg({ error: e instanceof Error ? e.message : '招待の送信に失敗しました' })
      // 502（メール送信失敗）でもアカウント作成とcomp付与は完了している＝一覧に
      // 「送信失敗」の行が増えているはずなので、エラー時も必ず一覧を再取得する
      // （見えないとユーザーが「再送」ボタンに気づけない）
      await loadGrants()
      onMutated()
    } finally {
      setBusy(false)
      setConfirmInvite(null)
    }
  }

  const doResend = async (grantId: number) => {
    setResendingId(grantId)
    setMsg({})
    try {
      const res = await api.admin.comp.resendInvite(grantId)
      setMsg({ info: `${res.email} に招待メールを再送しました。` })
      await loadGrants()
    } catch (e) {
      // 429（60秒以内の連打防止）等。detail は日本語文字列なのでそのまま表示する
      console.error('[CompManagement] 再送エラー:', e)
      setMsg({ error: e instanceof Error ? e.message : '招待メールの再送に失敗しました' })
      await loadGrants()
    } finally {
      setResendingId(null)
    }
  }

  const canSubmit = email.trim() !== '' && note.trim() !== '' && !busy
  const canInvite = inviteEmail.trim() !== '' && inviteNote.trim() !== '' && !busy

  return (
    <section className="bg-paper rounded-xl border border-line p-5 space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
        <Gift size={16} className="text-sage-deep" aria-hidden="true" />
        無償提供の管理
      </h2>
      <p className="text-xs text-muted">
        対象アカウントはカード登録・課金なしで全機能を利用できます。未登録のメールを入力した場合は先行登録になり、
        そのメールでのサインアップ時に自動で確定します。付与・解除はすべて記録されます。
      </p>

      <Notice {...msg} />
      <Notice error={listError} />

      {/* 有効な付与の一覧 */}
      {grants === null && !listError && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          読み込み中...
        </p>
      )}
      {grants && grants.length === 0 && (
        <p className="text-xs text-muted border border-line rounded-lg px-3 py-2.5">無償提供中のアカウントはありません</p>
      )}
      {grants && grants.length > 0 && (
        <div className="overflow-x-auto border border-line rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-bg-alt border-b border-line">
              <tr>
                <th className={TH}>メール</th>
                <th className={TH}>状態</th>
                <th className={TH}>招待</th>
                <th className={TH}>付与した管理者</th>
                <th className={TH}>付与日時</th>
                <th className={TH}>理由</th>
                <th className={TH}><span className="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody>
              {grants.map((g) => (
                <tr key={g.id} className="border-t border-line hover:bg-bg-alt">
                  <td className={`${TD} break-all`}>{g.email}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    {g.resolved
                      ? <span className="rounded-full bg-up-bg px-2 py-0.5 text-xs font-bold text-up">サインアップ済み</span>
                      : <span className="rounded-full bg-bg-alt px-2 py-0.5 text-xs font-bold text-sub">先行登録中（未サインアップ）</span>}
                  </td>
                  {/* 招待列: invite_status で出し分け。「再送」は招待経由の行にだけ出す
                      （直接付与の行に出すと400になるため）。再送は契約状態を変えない
                      メール送信の再実行なので、確認ダイアログは付けない（解除とは性質が違う） */}
                  <td className={`${TD} whitespace-nowrap text-xs`}>
                    {g.invite_status === null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        {g.invite_status === 'failed'
                          ? <span className="font-bold text-alert">送信失敗</span>
                          : <span className="tabular-nums">{formatDateTime(g.invited_at)} 送信</span>}
                        <button
                          type="button"
                          onClick={() => doResend(g.id)}
                          disabled={busy || resendingId !== null}
                          className="rounded-lg border border-line px-2 py-1 text-xs font-bold text-sub hover:bg-bg-alt disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-strong"
                        >
                          {resendingId === g.id ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : '再送'}
                        </button>
                      </span>
                    )}
                  </td>
                  <td className={`${TD} break-all`}>{g.granted_by_email ?? <span className="text-muted">—</span>}</td>
                  <td className={`${TD} tabular-nums whitespace-nowrap`}>{formatDateTime(g.granted_at)}</td>
                  <td className={`${TD} text-xs`}>{g.note}</td>
                  <td className={`${TD} text-right whitespace-nowrap`}>
                    <button
                      type="button"
                      onClick={() => setConfirmRevoke(g)}
                      disabled={busy}
                      className="rounded-lg border border-alert/40 px-3 py-1.5 text-xs font-bold text-alert hover:bg-alert-bg disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-alert"
                    >
                      解除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 付与フォーム。送信は必ず確認ダイアログ（ConfirmDeleteModal 流用）を経由する */}
      <form
        className="border-t border-line pt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!canSubmit) return
          setConfirmGrant({ email: email.trim(), note: note.trim() })
        }}
      >
        <p className="text-xs font-bold text-ink">新しく付与する</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-sub mb-1" htmlFor="comp-email">メールアドレス</label>
            <input
              id="comp-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={INPUT_CLS}
              placeholder="user@example.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-sub mb-1" htmlFor="comp-note">理由（必須）</label>
            <input
              id="comp-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={INPUT_CLS}
              placeholder="例: ◯◯社の導入検証用 / △△様のオンボーディング支援"
            />
          </div>
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink-strong px-4 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-strong focus-visible:ring-offset-2"
        >
          {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Gift size={13} aria-hidden="true" />}
          付与する
        </button>
      </form>

      {/* メールで招待（アカウント作成＋comp付与＋招待メール送信を1回で行う）。
          既存の直接付与フォームとは別のフォーム＝「入口を2つにするだけで、付与のロジックは1つ」
          という計画書の設計方針どおり並存させる。未登録メール専用（既存アカウントは409で
          直接付与への案内が返る） */}
      <form
        className="border-t border-line pt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!canInvite) return
          setConfirmInvite({ email: inviteEmail.trim(), note: inviteNote.trim(), message: inviteMessage })
        }}
      >
        <p className="text-xs font-bold text-ink flex items-center gap-1.5">
          <Mail size={13} className="text-sage-deep" aria-hidden="true" />
          メールで招待する（未登録のメール向け。アカウント作成と招待メール送信まで行います）
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-sub mb-1" htmlFor="invite-email">メールアドレス</label>
            <input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className={INPUT_CLS}
              placeholder="user@example.com"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-sub mb-1" htmlFor="invite-note">理由（必須）</label>
            <input
              id="invite-note"
              type="text"
              value={inviteNote}
              onChange={(e) => setInviteNote(e.target.value)}
              className={INPUT_CLS}
              placeholder="例: ◯◯社の導入検証用 / △△様のオンボーディング支援"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-sub mb-1" htmlFor="invite-message">メッセージ（任意・メール本文に差し込まれます）</label>
          <textarea
            id="invite-message"
            value={inviteMessage}
            onChange={(e) => setInviteMessage(e.target.value)}
            maxLength={1000}
            rows={3}
            className={INPUT_CLS}
            placeholder="例: 先日お話しした無償利用のご案内です。"
          />
        </div>
        {/* 送信前プレビュー: 入力を変更するとリアルタイムに更新される（レンダリング時に毎回計算） */}
        <div>
          <p className="text-xs font-medium text-sub mb-1">送信されるメールのプレビュー</p>
          <pre className="whitespace-pre-wrap rounded-lg border border-line bg-bg-alt px-3 py-2.5 text-xs leading-relaxed text-ink font-mono overflow-x-auto">
            {buildInvitePreview(inviteEmail.trim() || 'user@example.com', inviteMessage)}
          </pre>
        </div>
        <button
          type="submit"
          disabled={!canInvite}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink-strong px-4 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-ink-strong focus-visible:ring-offset-2"
        >
          {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Mail size={13} aria-hidden="true" />}
          招待メールを送る
        </button>
      </form>

      {/* 確認ダイアログ（要件3・評定で必須）。ConfirmDeleteModal は汎用propsなのでそのまま流用 */}
      <ConfirmDeleteModal
        open={confirmGrant !== null}
        title="無償提供を付与します"
        message={`対象: ${confirmGrant?.email ?? ''}\n変更内容: 未契約 → 無償提供\nこの操作後、対象アカウントはカード登録なしで全機能を利用できるようになります。`}
        confirmLabel="付与する"
        checkboxLabel="内容を確認しました"
        onConfirm={doGrant}
        onCancel={() => setConfirmGrant(null)}
        loading={busy}
      />
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
      <ConfirmDeleteModal
        open={confirmRevoke !== null}
        title="無償提供を解除します"
        message={`対象: ${confirmRevoke?.email ?? ''}\n変更内容: 無償提供 → 未契約\nこの操作後、対象アカウントの無償提供は終了し、通常のトライアル・課金フローに戻ります。`}
        confirmLabel="解除する"
        checkboxLabel="内容を確認しました"
        onConfirm={doRevoke}
        onCancel={() => setConfirmRevoke(null)}
        loading={busy}
      />
    </section>
  )
}

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

        {/* 無償提供（comp）の管理。アカウント一覧APIが configured:false でも
            /api/admin/comp-grants は Supabase Admin API 設定に依存しないため、
            一覧の状態に関わらず常時表示する。付与・解除でアカウント一覧の
            課金状態列（無償提供）も変わるため onMutated で再取得する */}
        <CompManagement onMutated={load} />

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
