/**
 * スパークライン（Tufte の定義: 軸も目盛りも凡例も持たない、語と同じ大きさの図）。
 * 表の行に埋めて使う。
 *
 * **正常範囲をグレーの帯で背景に敷く**のが要点。帯から外れたところが目を引くので、
 * 警告列を別に立てなくてよくなる（例: CTR 1%、ROI 100%）。
 *
 * ⚠️ 縦スケールの注意（Few「Best Practices for Scaling Sparklines」）:
 *   `sharedMin` / `sharedMax` を渡さないと**行ごとに独立スケール**になる。
 *   その場合は「形」は比べられるが「大きさ」は比べられない。
 *   大きさを比べさせたい一覧では、列全体で共通スケールを渡すこと。
 */

interface Props {
  values: (number | null)[]
  /** 正常範囲の下限・上限（グレー帯）。片側だけでもよい */
  band?: { min?: number; max?: number }
  /** 列全体で共通スケールにするときに渡す */
  sharedMin?: number
  sharedMax?: number
  /** 最後の点を強調する色 */
  endTone?: 'ink' | 'good' | 'bad'
  width?: number
  height?: number
  ariaLabel?: string
}

const TONE = { ink: '#1a1a19', good: '#0a7a0a', bad: '#b2312f' } as const

export default function Sparkline({
  values,
  band,
  sharedMin,
  sharedMax,
  endTone = 'ink',
  width = 96,
  height = 24,
  ariaLabel,
}: Props) {
  const pts = values.filter((v): v is number => v != null && Number.isFinite(v))
  if (pts.length < 2) {
    return <span className="text-[11px] text-gray-300">—</span>
  }

  const lo = sharedMin ?? Math.min(...pts, band?.min ?? Infinity)
  const hi = sharedMax ?? Math.max(...pts, band?.max ?? -Infinity)
  const span = hi - lo || 1
  const y = (v: number) => height - ((v - lo) / span) * height
  const step = width / (values.length - 1)

  const path = values
    .map((v, i) => (v == null ? null : `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(v).toFixed(1)}`))
    .filter(Boolean)
    .join(' ')

  const last = values[values.length - 1]
  const bandTop = band?.max != null ? y(band.max) : 0
  const bandBottom = band?.min != null ? y(band.min) : height

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      {band && (
        <rect x="0" y={Math.max(0, bandTop)} width={width} height={Math.max(1, bandBottom - bandTop)}
              fill="#1a1a19" opacity="0.07" />
      )}
      <path d={path} fill="none" stroke={TONE[endTone]} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {last != null && <circle cx={width} cy={y(last)} r="2" fill={TONE[endTone]} />}
    </svg>
  )
}
