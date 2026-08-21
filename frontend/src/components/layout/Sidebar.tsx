import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { maskEmail } from '../../lib/utils'
import { HELP_URL, EXTERNAL_LINK_PROPS } from '../../lib/links'
import { FOCUS_RING_ON_DARK } from '../../lib/a11y'
import {
  LayoutDashboard,
  TrendingUp,
  Package,
  Upload,
  Target,
  HelpCircle,
  BookOpen,
  Megaphone,
  MessageSquarePlus,
  FileDown,
  Boxes,
  CreditCard,
  LogOut,
  UserCircle,
  ExternalLink,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const nav = [
  { to: '/', icon: LayoutDashboard, label: 'ダッシュボード' },
  { to: '/gap', icon: TrendingUp, label: 'GAP分析' },
  { to: '/products', icon: Package, label: '商品別KPI' },
  { to: '/rpp', icon: Megaphone, label: 'RPP広告実績' },
  { to: '/import', icon: Upload, label: 'データ取込み' },
  { to: '/master', icon: Boxes, label: '商品マスタ・原価' },
  { to: '/targets', icon: Target, label: '目標設定' },
  { to: '/reports', icon: FileDown, label: 'レポート出力' },
  { to: '/billing', icon: CreditCard, label: '請求・プラン' },
]

/** 折りたたみ状態の永続化キー（ブラウザごとに保持） */
const STORAGE_KEY = 'ureshiru:sidebar-collapsed'

/** localStorage はプライベートモード等で例外を投げることがあるので必ず握りつぶす */
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
  } catch {
    /* 保存できなくても動作に影響させない */
  }
}

/**
 * 折りたたみ時にアイコンの意味を補うツールチップ。
 * - `title` 属性は表示が遅く、キーボードフォーカスでは出ないため使わない
 * - これはあくまで見た目の補助なので aria-hidden。読み上げ用の名前は各要素の aria-label が担う
 * - トランジションは opacity のみ（transition-all は使わない）＋ prefers-reduced-motion 対応
 */
function Tooltip({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-gray-800 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg ring-1 ring-white/10 transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
    >
      {label}
    </span>
  )
}

/** タブレットの二度押し遅延も潰す。リング自体は lib/a11y の共有定数 */
const FOCUS_RING = `touch-manipulation ${FOCUS_RING_ON_DARK}`

/** ナビ行（上段）のクラス。折りたたみ時はアイコンを中央寄せにする */
function navRowClass(collapsed: boolean, isActive: boolean) {
  const base = `group relative flex items-center text-sm transition-colors ${FOCUS_RING}`
  if (collapsed) {
    return `${base} justify-center py-0.5 ${isActive ? 'text-white' : 'text-gray-400'}`
  }
  return `${base} gap-3 px-4 py-3 ${
    isActive ? 'bg-sage-deep text-white font-medium' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
  }`
}

/** 下段（アカウント・ヘルプ等）のクラス */
function subRowClass(collapsed: boolean, isActive = false) {
  const base = `group relative flex items-center text-sm transition-colors ${FOCUS_RING}`
  if (collapsed) {
    return `${base} w-full justify-center py-0.5 rounded-lg ${isActive ? 'text-white' : 'text-gray-400'}`
  }
  return `${base} w-full gap-2.5 px-3 py-2.5 rounded-lg ${
    isActive ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
  }`
}

interface RowContentProps {
  collapsed: boolean
  icon: LucideIcon
  label: string
  isActive?: boolean
  iconSize?: number
  /** 展開時のみラベル右に出す要素（外部リンクアイコンなど） */
  trailing?: React.ReactNode
}

/**
 * 行の中身。折りたたみ時は
 *  - アイコンを角丸ボックスで囲み、アクティブなら赤で塗る
 *  - さらに行の左端に縦バーを出す（幅64pxだと塗りだけでは現在地を見落としやすいため）
 */
function RowContent({ collapsed, icon: Icon, label, isActive = false, iconSize = 18, trailing }: RowContentProps) {
  if (collapsed) {
    return (
      <>
        {isActive && (
          <span aria-hidden="true" className="absolute inset-y-1 left-0 w-[3px] rounded-r-full bg-sage" />
        )}
        <span
          className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
            isActive ? 'bg-sage-deep text-white' : 'group-hover:bg-gray-800 group-hover:text-white'
          }`}
        >
          <Icon size={iconSize} aria-hidden="true" />
        </span>
        <Tooltip label={label} />
      </>
    )
  }
  return (
    <>
      <Icon size={iconSize} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {trailing}
    </>
  )
}

interface SidebarProps {
  onOpenHelp: () => void
  /** フィードバック窓口（不具合報告・要望）を開く */
  onOpenFeedback: () => void
  userEmail?: string | null
  onSignOut?: () => void
}

export default function Sidebar({ onOpenHelp, onOpenFeedback, userEmail, onSignOut }: SidebarProps) {
  // lazy initializer で初回描画から確定値にする（展開→折りたたみのちらつき防止）
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed)

  useEffect(() => {
    writeCollapsed(collapsed)
  }, [collapsed])

  return (
    <aside
      className={`${collapsed ? 'w-16' : 'w-56'} min-h-screen bg-ink-strong text-white flex flex-col shrink-0`}
    >
      <div
        className={`flex items-center border-b border-gray-700 ${
          collapsed ? 'justify-center px-2 py-4' : 'justify-between gap-2 px-4 py-5'
        }`}
      >
        {!collapsed && (
          <div className="min-w-0">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">楽天EC</p>
            <h1 className="text-lg font-bold text-white leading-tight">KPI管理</h1>
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? 'サイドバーを展開する' : 'サイドバーを折りたたむ'}
          aria-expanded={!collapsed}
          className={`group relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-800 hover:text-white focus-visible:ring-offset-0 ${FOCUS_RING}`}
        >
          {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          {collapsed && <Tooltip label="サイドバーを展開する" />}
        </button>
      </div>

      <nav className="flex-1 py-4">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            aria-label={collapsed ? label : undefined}
            className={({ isActive }) => navRowClass(collapsed, isActive)}
          >
            {({ isActive }) => <RowContent collapsed={collapsed} icon={Icon} label={label} isActive={isActive} />}
          </NavLink>
        ))}
      </nav>

      <div className={`pb-4 space-y-1 border-t border-gray-700 pt-3 ${collapsed ? 'px-2' : 'px-3'}`}>
        {userEmail && (
          <NavLink
            to="/account"
            aria-label={collapsed ? 'アカウント設定' : undefined}
            className={({ isActive }) => subRowClass(collapsed, isActive)}
          >
            {({ isActive }) => (
              <RowContent
                collapsed={collapsed}
                icon={UserCircle}
                label="アカウント設定"
                isActive={isActive}
                iconSize={16}
              />
            )}
          </NavLink>
        )}
        <button
          type="button"
          onClick={onOpenHelp}
          aria-label={collapsed ? '使い方ガイド' : undefined}
          className={subRowClass(collapsed)}
        >
          <RowContent collapsed={collapsed} icon={HelpCircle} label="使い方ガイド" iconSize={16} />
        </button>
        {/* 詳細マニュアルはLP側のヘルプページが正（lib/links.ts 参照） */}
        <a
          href={HELP_URL}
          {...EXTERNAL_LINK_PROPS}
          aria-label={collapsed ? 'ヘルプページ' : undefined}
          className={subRowClass(collapsed)}
        >
          <RowContent
            collapsed={collapsed}
            icon={BookOpen}
            label="ヘルプページ"
            iconSize={16}
            trailing={<ExternalLink size={12} aria-hidden="true" className="text-gray-600" />}
          />
        </a>
        <button
          type="button"
          onClick={onOpenFeedback}
          aria-label={collapsed ? '不具合・要望を送る' : undefined}
          className={subRowClass(collapsed)}
        >
          <RowContent collapsed={collapsed} icon={MessageSquarePlus} label="不具合・要望を送る" iconSize={16} />
        </button>
        {userEmail && (
          <button
            type="button"
            onClick={onSignOut}
            aria-label={collapsed ? 'ログアウト' : undefined}
            className={subRowClass(collapsed)}
          >
            <RowContent collapsed={collapsed} icon={LogOut} label="ログアウト" iconSize={16} />
          </button>
        )}
        {!collapsed && userEmail && (
          <p className="text-xs text-gray-600 px-3 truncate" title={maskEmail(userEmail)}>
            {maskEmail(userEmail)}
          </p>
        )}
        {!collapsed && <p className="text-xs text-gray-600 px-3">v1.0.0</p>}
      </div>
    </aside>
  )
}
