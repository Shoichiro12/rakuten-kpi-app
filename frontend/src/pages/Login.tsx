import { useState } from 'react'
import { LogIn, Loader2, Send } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Mode = 'signin' | 'signup' | 'forgot'

/** Googleブランドの「G」ロゴ（公式配色）。外部画像に依存しないようインラインSVGで持つ。 */
function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}

/**
 * ログイン画面。メール＋パスワードに加え、Googleアカウントでのログインに対応する。
 * Supabase Auth を利用。サインアップはSupabase側で許可されている場合のみ機能する。
 * 「パスワードを忘れた」はリセットメールを送信し、リンクから ResetPassword 画面で再設定する。
 *
 * Google（OAuth）は signInWithOAuth でGoogleへリダイレクトし、認証後アプリへ戻る。
 * 戻った後は App.tsx の onAuthStateChange がセッションを拾うため、追加処理は不要。
 * Supabase側でGoogleプロバイダが未設定の場合はエラーメッセージで気づけるようにする。
 */
export default function Login() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const signInWithGoogle = async () => {
    if (!supabase) return
    setOauthLoading(true)
    setError(null)
    setInfo(null)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        // 認証後はこのアプリのトップへ戻す（Supabase側の Redirect URLs に登録が必要）
        options: { redirectTo: window.location.origin },
      })
      if (error) throw error
      // 成功時はGoogleへリダイレクトするため、ここから先は実行されない
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? `Googleログインに失敗しました: ${err.message}`
          : 'Googleログインに失敗しました',
      )
      setOauthLoading(false)
    }
  }

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

        {/* Googleログイン（パスワード再設定モードでは出さない） */}
        {mode !== 'forgot' && (
          <>
            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={oauthLoading || loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 text-gray-700 text-sm font-medium rounded-lg transition-colors"
            >
              {oauthLoading ? <Loader2 size={16} className="animate-spin" /> : <GoogleIcon />}
              Googleでログイン
            </button>
            <div className="flex items-center gap-3 my-4">
              <span className="flex-1 h-px bg-gray-200" />
              <span className="text-[11px] text-gray-400">または</span>
              <span className="flex-1 h-px bg-gray-200" />
            </div>
          </>
        )}

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
