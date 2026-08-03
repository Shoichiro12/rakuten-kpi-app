import { deltaTone, isRate, type MetricKey } from '../../lib/metrics'
import { formatChangeRate, formatPoint } from '../../lib/format'

/**
 * 前期比バッジ。
 *
 * 規則（docs/ui_number_and_chart_rules_2026-08-04.md 1-3 / 1-6 / 1-7）:
 *   - **マイナス記号は使わない。** 符号は矢印と色が持つ（Plausible も `Math.abs(change)` で描いている）
 *   - 矢印は色と必ずセット（WCAG 1.4.1「色だけで情報を伝えない」）
 *   - 割合の指標（CVR/CTR/ROAS/ROI/GPR/達成率）の差は **% ではなく pt**
 *   - 比較できないときは空欄にせず、理由が分かる文言を出す
 *   - 良い方向は指標メタから引く。ここで up=緑 と決め打ちしない
 */

export type DeltaState =
  | { kind: 'value'; diff: number }
  /** 前期のデータが無い */
  | { kind: 'no_prev' }
  /** 前期と同じ */
  | { kind: 'no_change' }
  /** 前期が0で変化率が定義できない。絶対差を文字列で渡す（例: "+12件（前週0）"） */
  | { kind: 'from_zero'; text: string }
  /** 母数不足（例: "判定不可（クリック18）"） */
  | { kind: 'low_sample'; text: string }

interface Props {
  metric: MetricKey
  state: DeltaState
  /** 比較の基準。省略しない（基準の無い「-10%」は意味がない） */
  basis: string
  /** 括弧で補う絶対差など */
  detail?: string
  className?: string
}

const TONE = {
  good: 'text-[#0a7a0a]',
  bad: 'text-[#b2312f]',
  neutral: 'text-gray-600',
} as const

export default function Delta({ metric, state, basis, detail, className = '' }: Props) {
  const base = `text-xs text-gray-500 ${className}`

  if (state.kind === 'no_prev') return <span className={base}>{basis}のデータなし</span>
  if (state.kind === 'no_change') return <span className={base}>変化なし</span>
  if (state.kind === 'from_zero' || state.kind === 'low_sample') {
    return <span className={base}>{state.text}</span>
  }

  const tone = deltaTone(metric, state.diff)
  const up = state.diff > 0
  // 割合の指標は「差」を pt で、それ以外は変化率を % で出す
  const body = isRate(metric) ? formatPoint(state.diff) : formatChangeRate(state.diff)

  return (
    <span className={base}>
      <b className={`font-semibold ${TONE[tone]}`}>
        <span aria-hidden="true">{up ? '▲' : '▼'}</span>
        <span className="sr-only">{up ? '増加' : '減少'}</span> {body}
      </b>{' '}
      {basis}
      {detail && <span className="text-gray-400">（{detail}）</span>}
    </span>
  )
}
