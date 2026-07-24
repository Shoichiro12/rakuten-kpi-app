import { NavLink } from 'react-router-dom'
import { maskEmail } from '../../lib/utils'
import {
  LayoutDashboard,
  TrendingUp,
  Package,
  Upload,
  Target,
  HelpCircle,
  Megaphone,
  FileDown,
  Boxes,
  CreditCard,
  LogOut,
  UserCircle,
} from 'lucide-react'

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

interface SidebarProps {
  onOpenHelp: () => void
  userEmail?: string | null
  onSignOut?: () => void
}

export default function Sidebar({ onOpenHelp, userEmail, onSignOut }: SidebarProps) {
  return (
    <aside className="w-56 min-h-screen bg-gray-900 text-white flex flex-col shrink-0">
      <div className="px-4 py-5 border-b border-gray-700">
        <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">楽天EC</p>
        <h1 className="text-lg font-bold text-white leading-tight">KPI管理</h1>
      </div>
      <nav className="flex-1 py-4">
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                isActive
                  ? 'bg-rakuten-red text-white font-medium'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="px-3 pb-4 space-y-1 border-t border-gray-700 pt-3">
        {userEmail && (
          <NavLink
            to="/account"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-2.5 text-sm rounded-lg transition-colors ${
                isActive ? 'bg-gray-800 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`
            }
          >
            <UserCircle size={16} />
            アカウント設定
          </NavLink>
        )}
        <button
          onClick={onOpenHelp}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
        >
          <HelpCircle size={16} />
          使い方ガイド
        </button>
        {userEmail && (
          <button
            onClick={onSignOut}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            title={maskEmail(userEmail)}
          >
            <LogOut size={16} />
            <span className="truncate">ログアウト</span>
          </button>
        )}
        {userEmail && <p className="text-[11px] text-gray-600 px-3 truncate" title={maskEmail(userEmail)}>{maskEmail(userEmail)}</p>}
        <p className="text-xs text-gray-600 px-3">v1.0.0</p>
      </div>
    </aside>
  )
}
