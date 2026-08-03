/**
 * Recharts の共通設定。**新しいグラフはここを import して組むこと。**
 * 規則は docs/ui_number_and_chart_rules_2026-08-04.md の 3-5 / 3-6。
 *
 * 決まっていること:
 *   - グリッドは**実線の極薄**。破線にしない（破線は「しきい値」「予測」に読まれる）
 *   - グリッド線の間隔は8px以上
 *   - 系列が1本のときは**凡例を出さない**（タイトルが名前を兼ねる）
 *   - 同時に描く系列は2本を基本、多くて4本。5本を超えるならスモールマルチプルにする
 *   - グラフの高さは最低50px、80pxで頭打ち（それ以上高くしても読み取り精度は上がらない）
 *   - 未確定の期間は点線にする
 */

export const CHART_INK = '#1a1a19'
export const CHART_SUB = '#55534f'
export const CHART_MUTED = '#86837d'
export const CHART_GRID = '#eeedea'
export const CHART_AXIS = '#d8d6d1'

/** 系列の色。**順番どおりに使い、循環させないこと。** 4本を超えたら分割する */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'] as const

/** 状態色（良い/注意/深刻/重大）。系列色に流用しない */
export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const

/** <CartesianGrid {...GRID} /> */
export const GRID = {
  stroke: CHART_GRID,
  strokeWidth: 1,
  vertical: false,
} as const

/** <XAxis {...AXIS} /> / <YAxis {...AXIS} /> */
export const AXIS = {
  tick: { fontSize: 11, fill: CHART_MUTED },
  tickLine: false,
  axisLine: { stroke: CHART_AXIS },
} as const

/** <Tooltip {...TOOLTIP} /> */
export const TOOLTIP = {
  contentStyle: {
    fontSize: 12,
    borderRadius: 8,
    border: '1px solid #e6e5e2',
    boxShadow: '0 4px 12px rgba(0,0,0,.06)',
  },
  labelStyle: { fontWeight: 600, color: CHART_INK },
} as const

/** 未確定期間の線に付ける */
export const INCOMPLETE_STROKE = { strokeDasharray: '3 4' } as const

/** 既定の高さ。80pxを超えても読み取り精度は上がらないが、ラベル帯のぶんは確保する */
export const CHART_HEIGHT = 220
