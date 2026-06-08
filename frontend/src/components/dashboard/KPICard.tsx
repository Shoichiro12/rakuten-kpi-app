import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react'
import KPIHelp from '../KPIHelp'

interface KPICardProps {
  label: string
  value: string
  change?: number | null
  changeLabel?: string
  alert?: boolean
  variant?: 'default' | 'primary' | 'success' | 'danger'
  suffix?: string
  helpMetric?: string
}

export default function KPICard({
  label,
  value,
  change,
  changeLabel,
  alert,
  variant = 'default',
  suffix,
  helpMetric,
}: KPICardProps) {
  const bg = {
    default: 'bg-white',
    primary: 'bg-blue-50 border-blue-200',
    success: 'bg-green-50 border-green-200',
    danger: 'bg-red-50 border-red-200',
  }[variant]

  const changeColor =
    change == null ? 'text-gray-400' : change > 0 ? 'text-green-600' : change < 0 ? 'text-red-500' : 'text-gray-400'

  const ChangeIcon = change == null || change === 0 ? Minus : change > 0 ? TrendingUp : TrendingDown

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${bg}`}>
      <div className="flex items-start justify-between gap-1">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">{label}</p>
        <div className="flex items-center gap-1 shrink-0">
          {helpMetric && <KPIHelp metric={helpMetric} />}
          {alert && <AlertTriangle size={15} className="text-amber-500" />}
        </div>
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-bold text-gray-900">{value}</span>
        {suffix && <span className="text-sm text-gray-500">{suffix}</span>}
      </div>
      {(change != null || changeLabel) && (
        <div className={`mt-1.5 flex items-center gap-1 text-xs ${changeColor}`}>
          <ChangeIcon size={12} />
          <span>
            {change != null ? `${change > 0 ? '+' : ''}${change.toFixed(1)}%` : '—'}
            {changeLabel && <span className="ml-1 text-gray-400">{changeLabel}</span>}
          </span>
        </div>
      )}
    </div>
  )
}
