import { useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface Props {
  onDone: () => void
}

/**
 * パスワード再設定画面。
 * 「パスワードを忘れた」メールのリンクから戻ってきたとき（PASSWORD_RECOVERY イベント）に表示される。
 * リンク経由で一時的なセッションが確立しているため、updateUser で新パスワードを設定できる。
 */
export default function ResetPassword({ onDone }: Props) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    if (password !== confirm) {
      setError('確認用パスワードが一致しません')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'パスワードの再設定に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border shadow-sm p-7">
        <div className="text-center mb-6">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">楽天EC</p>
          <h1 className="text-xl font-bold text-gray-900">パスワード再設定</h1>
          <p className="text-xs text-gray-500 mt-1">新しいパスワードを入力してください</p>
        </div>

        {done ? (
          <div className="space-y-4">
            <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              パスワードを再設定しました。
            </p>
            <button
              onClick={onDone}
              className="w-full py-2.5 bg-rakuten-red hover:opacity-90 text-white text-sm font-medium rounded-lg transition-opacity"
            >
              アプリへ進む
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">新しいパスワード</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rakuten-red"
                placeholder="6文字以上"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">新しいパスワード（確認）</label>
              <input
                type="password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rakuten-red"
              />
            </div>

            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-rakuten-red hover:opacity-90 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-opacity"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
              パスワードを再設定
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
