import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Sidebar from './components/layout/Sidebar'
import Footer from './components/layout/Footer'
import ErrorBoundary from './components/ErrorBoundary'
import OnboardingModal from './components/OnboardingModal'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import GapAnalysis from './pages/GapAnalysis'
import ProductKPI from './pages/ProductKPI'
import DataImport from './pages/DataImport'
import TargetSetting from './pages/TargetSetting'
import MasterSettings from './pages/MasterSettings'
import Billing from './pages/Billing'
import RppAnalysis from './pages/RppAnalysis'
import Reports from './pages/Reports'
import AccountSettings from './pages/AccountSettings'
import ResetPassword from './pages/ResetPassword'
import Tokushoho from './pages/legal/Tokushoho'
import Privacy from './pages/legal/Privacy'
import Terms from './pages/legal/Terms'
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
        <Route path="/master" element={<MasterSettings />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/rpp" element={<RppAnalysis />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/account" element={<AccountSettings userEmail={userEmail} />} />
      </Routes>
    </ErrorBoundary>
  )
}

const ONBOARDING_KEY = 'rakuten-kpi-onboarding-v1'

interface ShellProps {
  authReady: boolean
  recovering: boolean
  session: Session | null
  showOnboarding: boolean
  onCompleteOnboarding: () => void
  onReopenOnboarding: () => void
  onSignOut: () => void
  onRecoveryDone: () => void
}

/**
 * 認証ゲート＋アプリ本体（サイドバー・各画面・フッター）。
 *
 * 法的ページ（/legal/*）はこのゲートの外側でルーティングしているため、
 * 未ログインでも閲覧できる（特商法は購入前の表示を求めており、Stripeの審査でも
 * 購入手続き前に到達できるURLであることが確認される）。
 */
function Shell({
  authReady,
  recovering,
  session,
  showOnboarding,
  onCompleteOnboarding,
  onReopenOnboarding,
  onSignOut,
  onRecoveryDone,
}: ShellProps) {
  // 認証セッション確認中はローディング表示
  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-sm text-gray-400">
        読み込み中...
      </div>
    )
  }
  // パスワード再設定メールのリンク経由なら再設定画面を最優先で表示
  if (recovering) {
    return <ResetPassword onDone={onRecoveryDone} />
  }
  // 認証有効かつ未ログインならログイン画面
  if (authEnabled && !session) {
    return <Login />
  }

  return (
    <>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        <Sidebar
          onOpenHelp={onReopenOnboarding}
          userEmail={session?.user?.email ?? null}
          onSignOut={onSignOut}
        />
        {/* main 自体はスクロールさせず、内側のラッパーをスクロール領域にする。
            こうするとフッター（法的ページへのリンク）が常に画面下に残る。
            各ページの `h-full` は flex-1 + min-h-0 の親に対して解決される。 */}
        <main className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 min-h-0 overflow-auto flex flex-col">
            <AppRoutes userEmail={session?.user?.email ?? null} />
          </div>
          <Footer />
        </main>
      </div>

      {showOnboarding && <OnboardingModal onComplete={onCompleteOnboarding} />}
    </>
  )
}

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

  return (
    <BrowserRouter>
      <Routes>
        {/* 法的ページ: 認証ゲートより前に置き、未ログインでも閲覧できるようにする */}
        <Route path="/legal/tokushoho" element={<Tokushoho />} />
        <Route path="/legal/privacy" element={<Privacy />} />
        <Route path="/legal/terms" element={<Terms />} />
        {/* それ以外はすべてアプリ本体（内部で認証ゲート） */}
        <Route
          path="*"
          element={
            <Shell
              authReady={authReady}
              recovering={recovering}
              session={session}
              showOnboarding={showOnboarding}
              onCompleteOnboarding={completeOnboarding}
              onReopenOnboarding={reopenOnboarding}
              onSignOut={signOut}
              onRecoveryDone={() => setRecovering(false)}
            />
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
