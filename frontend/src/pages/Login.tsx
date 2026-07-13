import { useState } from 'react'
import { LogIn, Loader2, Send } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Mode = 'signin' | 'signup' | 'forgot'

/**
 * メール＋パスワードのログイン画面。
 * Supabase Auth を利用。サインアップはSupabase側で許可されている場合のみ機能する。
 * 「パスワードを忘れた」はリセットメールを送信し、リンクから ResetPassword 画面で再設定する。
 */
export default function Login() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const switchMode = (m: Mode) => {
    setMode(m)
    setError(null)
    setInfo(null)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supabase) return
    setLoading(true)
    setError(null)
    setInfo(null)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        // 成功時は onAuthStateChange（App側）が画面を切り替える
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        })
        if (error) throw error
        setInfo('パスワード再設定用のメールを送信しました。メール内のリンクを開いてください。')
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (data.session) {
          // メール確認が無効ならそのままログイン状態になる
        } else {
          setInfo('確認メールを送信しました。メール内のリンクを開いてから再度ログインしてください。')
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'ログインに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const subtitle =
    mode === 'signin' ? 'ログインしてください' : mode === 'signup' ? 'アカウントを作成' : 'パスワードを再設定'

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border shadow-sm p-7">
        <div className="text-center mb-6">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">楽天EC</p>
          <h1 className="text-xl font-bold text-gray-900">KPI管理</h1>
          <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">メールアドレス</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rakuten-red"
              placeholder="you@example.com"
            />
          </div>
          {mode !== 'forgot' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">パスワード</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rakuten-red"
                placeholder="6文字以上"
              />
            </div>
          )}

          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
          {info && <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{info}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-rakuten-red hover:opacity-90 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-opacity"
          >
            {loading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : mode === 'forgot' ? (
              <Send size={16} />
            ) : (
              <LogIn size={16} />
            )}
            {mode === 'signin' ? 'ログイン' : mode === 'signup' ? 'アカウント作成' : '再設定メールを送信'}
          </button>
        </form>

        <div className="mt-4 space-y-1">
          {mode === 'signin' && (
            <>
              <button
                onClick={() => switchMode('signup')}
                className="w-full text-center text-xs text-gray-500 hover:text-gray-700"
              >
                アカウントをお持ちでない方はこちら
              </button>
              <button
                onClick={() => switchMode('forgot')}
                className="w-full text-center text-xs text-gray-500 hover:text-gray-700"
              >
                パスワードをお忘れですか？
              </button>
            </>
          )}
          {mode !== 'signin' && (
            <button
              onClick={() => switchMode('signin')}
              className="w-full text-center text-xs text-gray-500 hover:text-gray-700"
            >
              ログイン画面に戻る
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
