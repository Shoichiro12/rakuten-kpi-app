import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/layout/Sidebar'
import OnboardingModal from './components/OnboardingModal'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import GapAnalysis from './pages/GapAnalysis'
import ProductKPI from './pages/ProductKPI'
import DataImport from './pages/DataImport'
import TargetSetting from './pages/TargetSetting'
import RppAnalysis from './pages/RppAnalysis'
import { supabase, authEnabled } from './lib/supabase'

const ONBOARDING_KEY = 'rakuten-kpi-onboarding-v1'

export default function App() {
  const [showOnboarding, setShowOnboarding] = useState(false)
  // 認証: 無効(ローカル)なら常に通す。有効なら Supabase セッションの有無でゲート。
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!authEnabled)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
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
  // 認証有効かつ未ログインならログイン画面
  if (authEnabled && !session) {
    return <Login />
  }

  return (
    <BrowserRouter>
      <div className="flex h-screen overflow-hidden bg-gray-50">
        <Sidebar onOpenHelp={reopenOnboarding} userEmail={session?.user?.email ?? null} onSignOut={signOut} />
        <main className="flex-1 overflow-auto flex flex-col">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/gap" element={<GapAnalysis />} />
            <Route path="/products" element={<ProductKPI />} />
            <Route path="/import" element={<DataImport />} />
            <Route path="/targets" element={<TargetSetting />} />
            <Route path="/rpp" element={<RppAnalysis />} />
          </Routes>
        </main>
      </div>

      {showOnboarding && (
        <OnboardingModal onComplete={completeOnboarding} />
      )}
    </BrowserRouter>
  )
}
