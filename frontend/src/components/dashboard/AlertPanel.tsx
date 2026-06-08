import { AlertTriangle, XCircle } from 'lucide-react'
import type { Alert } from '../../types'

interface AlertPanelProps {
  alerts: Alert[]
}

export default function AlertPanel({ alerts }: AlertPanelProps) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
        改善が必要なアラートはありません
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {alerts.map((a, i) => (
        <div
          key={i}
          className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm ${
            a.type === 'danger'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          {a.type === 'danger' ? (
            <XCircle size={16} className="mt-0.5 shrink-0 text-red-500" />
          ) : (
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
          )}
          <div>
            <span className="font-semibold">[{a.metric}]</span> {a.message}
          </div>
        </div>
      ))}
    </div>
  )
}
