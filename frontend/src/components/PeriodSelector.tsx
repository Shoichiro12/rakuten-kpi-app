import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PeriodSelectorProps {
  period: 'weekly' | 'monthly'
  onPeriodChange: (p: 'weekly' | 'monthly') => void
  dateValue: string
  onDateChange: (d: string) => void
}

export default function PeriodSelector({
  period,
  onPeriodChange,
  dateValue,
  onDateChange,
}: PeriodSelectorProps) {
  const shiftDate = (direction: 1 | -1) => {
    if (period === 'weekly') {
      const d = new Date(dateValue)
      d.setDate(d.getDate() + direction * 7)
      onDateChange(d.toISOString().split('T')[0])
    } else {
      const [year, month] = dateValue.split('-').map(Number)
      const next = new Date(year, month - 1 + direction, 1)
      onDateChange(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
        <button
          onClick={() => onPeriodChange('weekly')}
          className={`px-3 py-1.5 transition-colors ${
            period === 'weekly' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          週次
        </button>
        <button
          onClick={() => onPeriodChange('monthly')}
          className={`px-3 py-1.5 border-l border-gray-200 transition-colors ${
            period === 'monthly' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          月次
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => shiftDate(-1)}
          className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
        >
          <ChevronLeft size={16} />
        </button>
        {period === 'weekly' ? (
          <input
            type="date"
            value={dateValue}
            onChange={(e) => onDateChange(e.target.value)}
            className="border border-gray-200 rounded px-2 py-1 text-sm text-gray-700"
          />
        ) : (
          <input
            type="month"
            value={dateValue.slice(0, 7)}
            onChange={(e) => onDateChange(e.target.value + '-01')}
            className="border border-gray-200 rounded px-2 py-1 text-sm text-gray-700"
          />
        )}
        <button
          onClick={() => shiftDate(1)}
          className="p-1.5 rounded hover:bg-gray-100 text-gray-600"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}
