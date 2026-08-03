/**
 * 弾丸グラフ（Stephen Few の設計仕様書に準拠）。
 * https://www.perceptualedge.com/articles/misc/Bullet_Graph_Design_Spec.pdf
 *
 * 1本で「実績・着地見込み・目標・ペース・良し悪しの帯」を同時に出す。
 *
 * **進捗バーの代わりに必ずこれを使うこと。** 進捗バーは上限100%なので、
 * ROAS のように目標を超える指標を表現できない。
 *
 * 仕様の要点:
 *   - 実績の棒は容器の約1/3の太さ・中央
 *   - 比較線は最大2本。2本目は75%グレー
 *   - 良し悪しの帯は色相を変えず1色の濃淡で3段（40% / 25% / 10%）。色覚特性があっても読める
 *   - 目盛りは0から始める
 *   - **低いほうが良い指標（CPC・CPO・広告費）は帯の順序を反転する**
 */

export interface BulletProps {
  /** 実績 */
  value: number
  /** 目標（濃い縦線） */
  target: number
  /** ペースなどの副次的な比較値（75%グレーの縦線）。省略可 */
  pace?: number | null
  /** 着地見込み（実績の続きに薄い棒で描く）。省略可 */
  projection?: number | null
  /** 軸の最大値。省略時は max(実績, 着地見込み, 目標) の 1.35 倍 */
  max?: number
  /** true にすると帯を反転（低いほうが良い指標） */
  lowerIsBetter?: boolean
  /** 目盛りラベルの整形 */
  formatTick?: (v: number) => string
  /** 実績の横に出す文字列 */
  valueLabel?: string
  /** 着地見込みの横に出す文字列 */
  projectionLabel?: string
  paceLabel?: string
  targetLabel?: string
  height?: number
  ariaLabel?: string
}

const INK = '#1a1a19'
const SUB = '#55534f'
const TICK = '#c9c7c2'
const MUTED = '#86837d'

export default function BulletChart({
  value,
  target,
  pace,
  projection,
  max,
  lowerIsBetter = false,
  formatTick = (v) => String(Math.round(v)),
  valueLabel,
  projectionLabel,
  paceLabel = 'ペース',
  targetLabel = '目標',
  height = 92,
  ariaLabel,
}: BulletProps) {
  const W = 640
  const hi = max ?? (Math.max(value, projection ?? 0, target) * 1.35 || 1)
  const x = (v: number) => Math.max(0, Math.min(W, (v / hi) * W))

  // 帯は目標を基準に 0〜70% / 70〜100% / 100%〜 の3段
  const b1 = x(target * 0.7)
  const b2 = x(target)
  const bands = lowerIsBetter
    ? [0.03, 0.06, 0.1] // 低いほうが良い＝右へ行くほど悪い（濃い）
    : [0.1, 0.06, 0.03]

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img" aria-label={ariaLabel}>
      <rect x="0" y="18" width={b1} height="34" fill={INK} opacity={bands[0]} />
      <rect x={b1} y="18" width={Math.max(0, b2 - b1)} height="34" fill={INK} opacity={bands[1]} />
      <rect x={b2} y="18" width={Math.max(0, W - b2)} height="34" fill={INK} opacity={bands[2]} />

      {projection != null && projection > value && (
        <rect x="0" y="28" width={x(projection)} height="14" fill={INK} opacity="0.22" />
      )}
      <rect x="0" y="28" width={x(value)} height="14" fill={INK} />

      {pace != null && <rect x={x(pace) - 1} y="14" width="2" height="42" fill={SUB} />}
      <rect x={Math.max(0, x(target) - 1.5)} y="10" width="3" height="50" fill={INK} />

      <g stroke={TICK} strokeWidth="1">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={W * f} y1="56" x2={W * f} y2="61" />
        ))}
      </g>
      <g fontSize="10" fill={MUTED} textAnchor="middle">
        {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
          <text key={f} x={i === 0 ? 2 : i === 4 ? W - 4 : W * f} y="72">
            {formatTick(hi * f)}
          </text>
        ))}
      </g>

      <g fontSize="10.5" fill={SUB}>
        {pace != null && (
          <text x={x(pace)} y="8" textAnchor="middle">
            {paceLabel}
          </text>
        )}
        <text x={x(target)} y="8" textAnchor="middle" fill={INK} fontWeight="600">
          {targetLabel}
        </text>
      </g>
      <g fontSize="11" fontWeight="600">
        {valueLabel && (
          <text x={x(value) + 6} y="39" fill={INK}>
            {valueLabel}
          </text>
        )}
        {projection != null && projectionLabel && projection > value && (
          <text x={x(projection) + 6} y="39" fill={SUB}>
            {projectionLabel}
          </text>
        )}
      </g>
    </svg>
  )
}
