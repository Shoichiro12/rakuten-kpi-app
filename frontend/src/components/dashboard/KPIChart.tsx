import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts'
import type { TrendPoint } from '../../types'

interface KPIChartProps {
  data: TrendPoint[]
  metric: keyof TrendPoint
  label: string
  color?: string
  type?: 'line' | 'bar'
  formatter?: (v: number) => string
}

export default function KPIChart({
  data,
  metric,
  label,
  color = '#2563eb',
  type = 'line',
  formatter = (v) => v.toLocaleString('ja-JP'),
}: KPIChartProps) {
  const tickFormatter = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`
    return String(v)
  }

  if (!data || data.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center text-sm text-gray-400 bg-gray-50 rounded-lg">
        データなし
      </div>
    )
  }

  if (type === 'bar') {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={tickFormatter} tick={{ fontSize: 11 }} width={50} />
          <Tooltip formatter={(v: number) => formatter(v)} labelStyle={{ fontWeight: 600 }} />
          <Bar dataKey={metric as string} name={label} fill={color} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={tickFormatter} tick={{ fontSize: 11 }} width={50} />
        <Tooltip formatter={(v: number) => formatter(v)} labelStyle={{ fontWeight: 600 }} />
        <Legend />
        <Line
          type="monotone"
          dataKey={metric as string}
          name={label}
          stroke={color}
          strokeWidth={2}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

interface MultiLineChartProps {
  data: TrendPoint[]
  metrics: { key: keyof TrendPoint; label: string; color: string }[]
  formatter?: (v: number) => string
}

export function MultiLineChart({ data, metrics, formatter = (v) => v.toLocaleString() }: MultiLineChartProps) {
  const tickFormatter = (v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`
    return String(v)
  }

  if (!data || data.length === 0) {
    return (
      <div className="h-[220px] flex items-center justify-center text-sm text-gray-400 bg-gray-50 rounded-lg">
        データなし
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={tickFormatter} tick={{ fontSize: 11 }} width={50} />
        <Tooltip formatter={(v: number) => formatter(v)} labelStyle={{ fontWeight: 600 }} />
        <Legend />
        {metrics.map(({ key, label, color }) => (
          <Line
            key={key as string}
            type="monotone"
            dataKey={key as string}
            name={label}
            stroke={color}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
