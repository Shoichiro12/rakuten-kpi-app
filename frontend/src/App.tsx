import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Sidebar from './components/layout/Sidebar'
import ErrorBoundary from './components/ErrorBoundary'
import OnboardingModal from './components/OnboardingModal'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import GapAnalysis from './pages/GapAnalysis'
import ProductKPI from './pages/ProductKPI'
import DataImport from './pages/DataImport'
import TargetSetting from './pages/TargetSetting'
import RppAnalysis from './pages/RppAnalysis'
import Reports from './pages/Reports'
import AccountSettings from './pages/AccountSettings'
import ResetPassword from './pages/ResetPassword'
import { supabase, authEnabled } from './lib/supabase'

/**
 * 画面ルーティング。ErrorBoundary で囲み、1画面の描画エラーでアプリ全体が
 * 白くなるのを防ぐ。key に経路を渡すことで、ページを移動するとエラー状態が
 * 自動的にリセットされる（useLocation は BrowserRouter の内側でのみ使えるため
 * App 本体ではなくこの子コンポーネントに置いている）。
 */
function AppRoutes({ userEmail }: { userEmail: string | null }) {
  const location = useLocation()
  return (
    <ErrorBoundary key={location.pathname} label="この画面">
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/gap" element={<GapAnalysis />} />
        <Route path="/products" element={<ProductKPI />} />
        <Route path="/import" element={<DataImport />} />
        <Route path="/targets" element={<TargetSetting />} />
        <Route path="/rpp" element={<RppAnalysis />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/account" element={<AccountSettings userEmail={userEmail} />} />
      </Routes>
    </ErrorBoundary>
  )
}

const ONBOARDING_KEY = 'rakuten-kpi-onboarding-v1'

export default function App() {
  const [showOnboarding, setShowOnboarding] = useState(false)
  // 認証: 無効(ローカル)なら常に通す。有効なら Supabase セッションの有無でゲート。
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!authEnabled)
  // パスワード再設定メールのリンクから戻ってきた状態（PASSWORD_RECOVERY）
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

  useEffect(() => {
    const done = localStorage.getItem(ONBOARDING_KEY)
    if (!done) setShowOnboarding(true)
  }, [])

  const completeOnboarding = () => {
    localStorage.setItem(ONBOARDING_KEY, 'done')
    setShowOnboarding(false)
  }

  const reopenOnboarding = () => {
    setShowOnboarding(true)
  }

  const signOut = () => { supabase?.auth.signOut() }

  // 認証セッション確認中はローディング表示
  if (!authReady) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-sm text-gray-400">読み込み中...</div>
  }
  // パスワード再設定メールのリンク経由なら再設定画面を最優先で表示
  if (recovering) {
    return <ResetPassword onDone={() => setRecovering(false)} />
  }
  // 認証有効かつ未ログインならログイン画面
  if (authEnabled && !session) {
    return <Login />
  }

  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        <Sidebar onOpenHelp={reopenOnboarding} userEmail={session?.user?.email ?? null} onSignOut={signOut} />
        <main className="flex-1 overflow-auto flex flex-col">
          <AppRoutes userEmail={session?.user?.email ?? null} />
        </main>
      </div>

      {showOnboarding && (
        <OnboardingModal onComplete={completeOnboarding} />
      )}
    </BrowserRouter>
  )
}
