import { useEffect, useState } from 'react'
import { KeyRound, Loader2, Mail, ShieldAlert, Trash2, UserCircle } from 'lucide-react'
import { supabase, authEnabled } from '../lib/supabase'
import { api } from '../lib/api'

interface AccountInfo {
  auth_enabled: boolean
  email: string | null
  user_id: string | null
  total_rows: number
  can_delete: boolean
}

interface Props {
  userEmail?: string | null
}

/** メッセージ表示（成功/エラー） */
function Notice({ error, info }: { error?: string | null; info?: string | null }) {
  if (error) return <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
  if (info) return <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{info}</p>
  return null
}

const inputCls =
  'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rakuten-red'
const buttonCls =
  'inline-flex items-center gap-2 px-4 py-2 bg-rakuten-red hover:opacity-90 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-opacity'

export default function AccountSettings({ userEmail }: Props) {
  const [info, setInfo] = useState<AccountInfo | null>(null)

  // メールアドレス変更
  const [newEmail, setNewEmail] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailMsg, setEmailMsg] = useState<{ error?: string; info?: string }>({})

  // パスワード変更
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ error?: string; info?: string }>({})

  // アカウント削除
  const [confirmText, setConfirmText] = useState('')
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteMsg, setDeleteMsg] = useState<{ error?: string; info?: string }>({})

  useEffect(() => {
    api.account
      .get()
      .then((d) => setInfo(d as AccountInfo))
      .catch(() => setInfo(null))
  }, [])

  if (!authEnabled) {
    return (
      <div className="p-6 max-w-2xl">
        <h1 className="text-xl font-bold text-gray-900 mb-4">アカウント設定</h1>
        <div className="bg-white rounded-xl border p-5 text-sm text-gray-500">
          ローカル開発モード（認証無効）のため、アカウント設定は利用できません。
          Supabase の環境変数（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）を設定すると有効になります。
        </div>
      </div>
    )
  }

  const changeEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setEmailBusy(true)
    setEmailMsg({})
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail })
      if (error) throw error
      setEmailMsg({
        info: '確認メールを送信しました。新旧両方のメールアドレスに届くリンクを開くと変更が完了します。',
      })
      setNewEmail('')
    } catch (err) {
      setEmailMsg({ error: err instanceof Error ? err.message : 'メールアドレスの変更に失敗しました' })
    } finally {
      setEmailBusy(false)
    }
  }

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    if (newPassword !== confirmPassword) {
      setPwMsg({ error: '確認用パスワードが一致しません' })
      return
    }
    setPwBusy(true)
    setPwMsg({})
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setPwMsg({ info: 'パスワードを変更しました。' })
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setPwMsg({ error: err instanceof Error ? err.message : 'パスワードの変更に失敗しました' })
    } finally {
      setPwBusy(false)
    }
  }

  const deleteAccount = async () => {
    setDeleteBusy(true)
    setDeleteMsg({})
    try {
      await api.account.delete()
      // 削除成功 → サインアウトしてログイン画面へ
      await supabase?.auth.signOut()
    } catch (err) {
      setDeleteMsg({ error: err instanceof Error ? err.message : 'アカウント削除に失敗しました' })
      setDeleteBusy(false)
    }
  }

  const email = info?.email ?? userEmail ?? ''

  return (
    <div className="p-6 max-w-2xl space-y-5">
      <h1 className="text-xl font-bold text-gray-900">アカウント設定</h1>

      {/* 基本情報 */}
      <section className="bg-white rounded-xl border p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-gray-800 mb-3">
          <UserCircle size={16} className="text-gray-400" />
          基本情報
        </h2>
        <dl className="text-sm space-y-1">
          <div className="flex gap-3">
            <dt className="w-28 text-gray-500 shrink-0">メールアドレス</dt>
            <dd className="text-gray-900 break-all">{email || '-'}</dd>
          </div>
          {info && (
            <div className="flex gap-3">
              <dt className="w-28 text-gray-500 shrink-0">登録データ</dt>
              <dd className="text-gray-900">{info.total_rows.toLocaleString()} 行</dd>
            </div>
          )}
        </dl>
      </section>

      {/* メールアドレス変更 */}
      <section className="bg-white rounded-xl border p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-gray-800 mb-3">
          <Mail size={16} className="text-gray-400" />
          メールアドレス変更
        </h2>
        <form onSubmit={changeEmail} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">新しいメールアドレス</label>
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className={inputCls}
              placeholder="new@example.com"
            />
          </div>
          <Notice {...emailMsg} />
          <button type="submit" disabled={emailBusy || !newEmail} className={buttonCls}>
            {emailBusy && <Loader2 size={14} className="animate-spin" />}
            確認メールを送信
          </button>
        </form>
      </section>

      {/* パスワード変更 */}
      <section className="bg-white rounded-xl border p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-gray-800 mb-3">
          <KeyRound size={16} className="text-gray-400" />
          パスワード変更
        </h2>
        <form onSubmit={changePassword} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">新しいパスワード</label>
            <input
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className={inputCls}
              placeholder="6文字以上"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">新しいパスワード（確認）</label>
            <input
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className={inputCls}
            />
          </div>
          <Notice {...pwMsg} />
          <button type="submit" disabled={pwBusy || !newPassword} className={buttonCls}>
            {pwBusy && <Loader2 size={14} className="animate-spin" />}
            パスワードを変更
          </button>
        </form>
      </section>

      {/* アカウント削除 */}
      <section className="bg-white rounded-xl border border-red-200 p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold text-red-700 mb-2">
          <ShieldAlert size={16} />
          アカウント削除（退会）
        </h2>
        <p className="text-xs text-gray-500 mb-3">
          アカウントと登録済みの全データ（RPP実績・月次売上・目標設定など）を完全に削除します。
          この操作は取り消せません。
        </p>
        {info && !info.can_delete && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            サーバーに SUPABASE_SERVICE_ROLE_KEY が設定されていないため、現在この機能は利用できません。
          </p>
        )}
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              確認のため「削除」と入力してください
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className={inputCls}
              placeholder="削除"
            />
          </div>
          <Notice {...deleteMsg} />
          <button
            onClick={deleteAccount}
            disabled={deleteBusy || confirmText !== '削除' || (info ? !info.can_delete : false)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {deleteBusy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            アカウントを完全に削除する
          </button>
        </div>
      </section>
    </div>
  )
}
