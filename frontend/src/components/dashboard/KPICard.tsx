import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react'
import KPIHelp from '../KPIHelp'

interface KPICardProps {
  label: string
  value: string
  change?: number | null
  changeLabel?: string
  /** 前年同期比(%)。指定すると前期比の下に YoY 行を表示する（要件No.7） */
  yoy?: number | null
  alert?: boolean
  variant?: 'default' | 'primary' | 'success' | 'danger'
  /** カードの視覚的な重み。hero=最重要（大）、default=標準、compact=参考指標（小） */
  size?: 'hero' | 'default' | 'compact'
  suffix?: string
  helpMetric?: string
}

export default function KPICard({
  label,
  value,
  change,
  changeLabel,
  yoy,
  alert,
  variant = 'default',
  size = 'default',
  suffix,
  helpMetric,
}: KPICardProps) {
  const bg = {
    default: 'bg-white',
    primary: 'bg-blue-50 border-blue-200',
    success: 'bg-green-50 border-green-200',
    danger: 'bg-red-50 border-red-200',
  }[variant]

  // heroカードの上部アクセントバー（variantに応じて色分け）
  const heroAccent = {
    default: 'bg-gray-900',
    primary: 'bg-blue-600',
    success: 'bg-green-600',
    danger: 'bg-red-500',
  }[variant]

  const changeColor =
    change == null ? 'text-gray-400' : change > 0 ? 'text-green-600' : change < 0 ? 'text-red-500' : 'text-gray-400'

  const ChangeIcon = change == null || change === 0 ? Minus : change > 0 ? TrendingUp : TrendingDown

  const yoyColor =
    yoy == null ? 'text-gray-400' : yoy > 0 ? 'text-green-600' : yoy < 0 ? 'text-red-500' : 'text-gray-400'

  // コンパクト：参考指標用の控えめな1行レイアウト
  if (size === 'compact') {
    return (
      <div className={`rounded-lg border p-3 ${bg}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium text-gray-400 leading-tight truncate">{label}</p>
          <div className="flex items-center gap-1 shrink-0">
            {helpMetric && <KPIHelp metric={helpMetric} />}
            {alert && <AlertTriangle size={13} className="text-amber-500" />}
          </div>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span className="text-base font-semibold text-gray-700">
            {value}
            {suffix && <span className="ml-0.5 text-xs text-gray-400">{suffix}</span>}
          </span>
          {change != null && (
            <span className={`flex items-center gap-0.5 text-[11px] ${changeColor}`}>
              <ChangeIcon size={11} />
              {`${change > 0 ? '+' : ''}${change.toFixed(1)}%`}
            </span>
          )}
        </div>
      </div>
    )
  }

  const isHero = size === 'hero'

  return (
    <div className={`relative overflow-hidden rounded-xl border ${isHero ? 'p-5 shadow-md' : 'p-4 shadow-sm'} ${bg}`}>
      {isHero && <div className={`absolute inset-x-0 top-0 h-1 ${heroAccent}`} />}
      <div className="flex items-start justify-between gap-1">
        <p
          className={`font-medium uppercase tracking-wide leading-tight ${
            isHero ? 'text-sm text-gray-600' : 'text-xs text-gray-500'
          }`}
        >
          {label}
        </p>
        <div className="flex items-center gap-1 shrink-0">
          {helpMetric && <KPIHelp metric={helpMetric} />}
          {alert && <AlertTriangle size={isHero ? 18 : 15} className="text-amber-500" />}
        </div>
      </div>
      <div className={`flex items-baseline gap-1 ${isHero ? 'mt-3' : 'mt-2'}`}>
        <span className={`font-bold text-gray-900 ${isHero ? 'text-3xl md:text-4xl tracking-tight' : 'text-2xl'}`}>
          {value}
        </span>
        {suffix && <span className="text-sm text-gray-500">{suffix}</span>}
      </div>
      {(change != null || changeLabel) && (
        <div className={`flex items-center gap-1 ${isHero ? 'mt-2.5 text-sm' : 'mt-1.5 text-xs'} ${changeColor}`}>
          <ChangeIcon size={isHero ? 15 : 12} />
          <span>
            {change != null ? `${change > 0 ? '+' : ''}${change.toFixed(1)}%` : '—'}
            {changeLabel && <span className="ml-1 text-gray-400">{changeLabel}</span>}
          </span>
        </div>
      )}
      {yoy != null && (
        <div className={`mt-1 flex items-center gap-1 ${isHero ? 'text-sm' : 'text-xs'} ${yoyColor}`}>
          <span className={`text-gray-400 ${isHero ? 'text-xs' : 'text-[10px]'}`}>YoY</span>
          <span>{`${yoy > 0 ? '+' : ''}${yoy.toFixed(1)}%`}</span>
        </div>
      )}
    </div>
  )
}
