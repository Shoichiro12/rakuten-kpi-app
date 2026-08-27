import { useState, useEffect } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Sidebar from './components/layout/Sidebar'
import Footer from './components/layout/Footer'
import ErrorBoundary from './components/ErrorBoundary'
import OnboardingModal from './components/OnboardingModal'
import FeedbackModal, { OPEN_FEEDBACK_EVENT, type FeedbackCategory } from './components/FeedbackModal'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import GapAnalysis from './pages/GapAnalysis'
import ProductKPI from './pages/ProductKPI'
import DataImport from './pages/DataImport'
import TargetSetting from './pages/TargetSetting'
import MasterSettings from './pages/MasterSettings'
import CategoryMaster from './pages/CategoryMaster'
import Billing from './pages/Billing'
import RppAnalysis from './pages/RppAnalysis'
import Reports from './pages/Reports'
import AccountSettings from './pages/AccountSettings'
import ResetPassword from './pages/ResetPassword'
import AdminAccounts from './pages/AdminAccounts'
import AdminViewBanner from './components/layout/AdminViewBanner'
import { supabase, authEnabled } from './lib/supabase'

/**
 * 画面ルーティング。ErrorBoundary で囲み、1画面の描画エラーでアプリ全体が
 * 白くなるのを防ぐ。key に経路を渡すことで、ページを移動するとエラー状態が
 * 自動的にリセットされる（useLocation は BrowserRouter の内側でのみ使えるため
 * App 本体ではなくこの子コンポーネントに置いている）。
 *
 * 法的ページ（特商法・プライバシーポリシー・利用規約）はこのアプリ内には持たない。
 * Stripeに登録しているビジネスウェブサイト（LP）側が正で、フッター等から
 * 外部リンクで飛ばす（lib/links.ts 参照）。
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
        <Route path="/master/categories" element={<CategoryMaster />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/rpp" element={<RppAnalysis />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/account" element={<AccountSettings userEmail={userEmail} />} />
        {/* 管理者専用（直接URLでアクセスする運用。サイドバーには載せない＝評定Q3） */}
        <Route path="/admin" element={<AdminAccounts />} />
      </Routes>
    </ErrorBoundary>
  )
}

// オンボーディングの内容を大きく変えたらバージョンを上げる（既存ユーザーにも一度だけ再表示される）
const ONBOARDING_KEY = 'rakuten-kpi-onboarding-v2'

export default function App() {
  const [showOnboarding, setShowOnboarding] = useState(false)
  // フィードバック窓口（不具合報告・要望・解約について）。BrowserRouter内でuseLocationを使うため
  // モーダル自体はルーター配下で描画する
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackCategory, setFeedbackCategory] = useState<FeedbackCategory>('bug')

  // 深い階層のページ（Billingの「解約について問い合わせる」等）からも
  // 種別を指定してフィードバック窓口を開けるようにする
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ category?: FeedbackCategory }>).detail
      setFeedbackCategory(detail?.category ?? 'bug')
      setShowFeedback(true)
    }
    window.addEventListener(OPEN_FEEDBACK_EVENT, handler)
    return () => window.removeEventListener(OPEN_FEEDBACK_EVENT, handler)
  }, [])
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
      {/* 管理者閲覧モードのバナーはレイアウトの外側（この列コンテナ）に置く。
          閲覧中だけ上に帯が出て、その分だけ下の枠（サイドバー＋本文）が縮む。
          下の枠は h-screen → flex-1 min-h-0 に変えただけで、relative / overflow-hidden の
          役割（下記コメント）はそのまま。fixed の帯で重ねる案は、サイドバーのロゴ行や
          各ページの Header が帯の下に隠れるため採らなかった。 */}
      <div className="flex h-screen flex-col">
      <AdminViewBanner />
      {/* relative は必須。外すとページ自体にスクロールバーが出る。
          `sr-only`（Tailwind）は position:absolute なので、包含ブロックを持つ
          位置指定の祖先が無いと ICB（＝ビューポート）基準になり、この
          `overflow-hidden` に切り取られずドキュメントの高さを押し広げてしまう。
          実際 GAP分析では Delta.tsx の読み上げ用スパン（「減少」）が本文の奥にあるため
          静的位置が y=1329 まで下がり、h-screen なのに 530px ぶん本文がスクロールする
          ＝画面右端のスクロールバーが1本余分に見える状態になっていた（2026-08-05 実測）。 */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden bg-gray-50">
        {/* 本文へスキップ（キーボード操作の入口）。
            サイドバーのナビは項目が多く、Tabだけで本文（GAP分析の改善ボタン等）に
            届くまで十数回かかる。DOM上の最初のフォーカス可能要素をここに置くことで、
            Tab 1回 → Enter で main へ飛べるようにする。

            通常は sr-only で見えず、フォーカスが当たったときだけ現れる。
            position は focus:absolute ではなく focus:fixed を使うこと。親は
            `relative overflow-hidden` なので、absolute だとこの枠に切り取られて
            フォーカスしても見えなくなる。fixed はビューポート基準で描画される
            （祖先に transform が無いため）。 */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-gray-900 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          本文へスキップ
        </a>
        <Sidebar
          onOpenHelp={reopenOnboarding}
          onOpenFeedback={() => { setFeedbackCategory('bug'); setShowFeedback(true) }}
          userEmail={session?.user?.email ?? null}
          onSignOut={signOut}
        />
        {/* main 自体はスクロールさせず、内側のラッパーをスクロール領域にする。
            こうするとフッター（法的ページへのリンク）が常に画面下に残る。
            各ページの `h-full` は flex-1 + min-h-0 の親に対して解決される。 */}
        {/* tabIndex={-1} が無いと、スキップリンクを踏んでもスクロールするだけで
            フォーカスが移らず、次の Tab がサイドバーの続きに戻ってしまう */}
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-hidden flex flex-col focus:outline-none">
          <div className="flex-1 min-h-0 overflow-auto flex flex-col">
            <AppRoutes userEmail={session?.user?.email ?? null} />
          </div>
          <Footer />
        </main>
      </div>
      </div>

      {showOnboarding && (
        <OnboardingModal onComplete={completeOnboarding} />
      )}
      {showFeedback && (
        <FeedbackModal initialCategory={feedbackCategory} onClose={() => setShowFeedback(false)} />
      )}
    </BrowserRouter>
  )
}
