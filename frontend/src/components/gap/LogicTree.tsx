import type { KPITree, KPITreeNode } from '../../types'

interface LogicTreeProps {
  data: KPITree
  selectedKPI: string | null
  onKPIClick: (key: 'access' | 'cvr' | 'av') => void
}

function nodeColor(achieve: number, hasTarget: boolean) {
  if (!hasTarget || achieve === 0) return { stroke: '#94a3b8', fill: '#f8fafc', text: '#64748b' }
  if (achieve >= 100) return { stroke: '#16a34a', fill: '#f0fdf4', text: '#15803d' }
  if (achieve >= 80) return { stroke: '#d97706', fill: '#fffbeb', text: '#b45309' }
  return { stroke: '#dc2626', fill: '#fef2f2', text: '#b91c1c' }
}

function formatVal(node: KPITreeNode): string {
  if (node.unit === 'currency') return `¥${Math.round(node.actual).toLocaleString('ja-JP')}`
  if (node.unit === 'percent') return `${node.actual.toFixed(2)}%`
  return Math.round(node.actual).toLocaleString('ja-JP')
}

function formatTarget(node: KPITreeNode): string {
  if (node.unit === 'currency') return `¥${Math.round(node.target).toLocaleString('ja-JP')}`
  if (node.unit === 'percent') return `${node.target.toFixed(2)}%`
  return Math.round(node.target).toLocaleString('ja-JP')
}

function formatGap(node: KPITreeNode): string {
  const sign = node.gap >= 0 ? '+' : ''
  if (node.unit === 'currency') return `${sign}¥${Math.round(node.gap).toLocaleString('ja-JP')}`
  if (node.unit === 'percent') return `${sign}${node.gap.toFixed(2)}%`
  return `${sign}${Math.round(node.gap).toLocaleString('ja-JP')}`
}

interface NodeBoxProps {
  x: number; y: number; w: number; h: number
  node: KPITreeNode
  hasTarget: boolean
  isRoot?: boolean
  isSelected?: boolean
  onClick?: () => void
}

function NodeBox({ x, y, w, h, node, hasTarget, isRoot, isSelected, onClick }: NodeBoxProps) {
  const { stroke, fill, text } = nodeColor(node.achieve_rate, hasTarget)
  const cx = x + w / 2
  const strokeW = isSelected ? 3 : isRoot ? 2 : 1.5

  return (
    <g
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      role={onClick ? 'button' : undefined}
    >
      <rect
        x={x} y={y} width={w} height={h} rx={12}
        fill={fill}
        stroke={isSelected ? '#2563eb' : stroke}
        strokeWidth={strokeW}
        filter={isSelected ? 'drop-shadow(0 0 6px rgba(37,99,235,0.4))' : undefined}
      />

      {/* ラベル */}
      <text
        x={cx} y={y + 22}
        textAnchor="middle"
        fontSize={isRoot ? 13 : 12}
        fontWeight="bold"
        fill="#1e293b"
      >
        {isRoot ? 'KGI：' : 'KPI：'}{node.label}
      </text>

      {hasTarget && node.target > 0 ? (
        <>
          {/* 実績 */}
          <text x={cx} y={y + 44} textAnchor="middle" fontSize={13} fontWeight="600" fill="#0f172a">
            実績: {formatVal(node)}
          </text>
          {/* 目標 */}
          <text x={cx} y={y + 61} textAnchor="middle" fontSize={11} fill="#64748b">
            目標: {formatTarget(node)}  達成率{node.achieve_rate.toFixed(0)}%
          </text>
          {/* GAP */}
          <text x={cx} y={y + 77} textAnchor="middle" fontSize={11} fontWeight="600" fill={text}>
            GAP: {formatGap(node)} ({node.gap_rate > 0 ? '+' : ''}{node.gap_rate.toFixed(1)}%)
          </text>
        </>
      ) : (
        <>
          <text x={cx} y={y + 50} textAnchor="middle" fontSize={13} fontWeight="600" fill="#0f172a">
            {formatVal(node)}
          </text>
          <text x={cx} y={y + 68} textAnchor="middle" fontSize={11} fill="#94a3b8">
            目標未設定
          </text>
        </>
      )}

      {/* クリック可能なノードの角に矢印ヒント */}
      {onClick && !isRoot && (
        <text x={x + w - 14} y={y + h - 8} fontSize={9} fill="#94a3b8">▼</text>
      )}
    </g>
  )
}

export default function LogicTree({ data, selectedKPI, onKPIClick }: LogicTreeProps) {
  // kgi/access/cvr/av のいずれかが欠けている場合はガード
  if (!data?.kgi || !data?.access || !data?.cvr || !data?.av) {
    return (
      <div className="h-48 flex items-center justify-center text-sm text-gray-400">
        データがありません
      </div>
    )
  }

  // ViewBox: 960 × 295
  const W = 960; const H = 295
  // Root (KGI)
  const RW = 300; const RH = 95; const RX = (W - RW) / 2; const RY = 8
  const rootCX = RX + RW / 2; const rootBot = RY + RH
  // Children
  const CW = 270; const CH = 95; const CY = 192
  const positions = [
    { x: 15,              kpi: 'access' as const },
    { x: (W - CW) / 2,   kpi: 'cvr'    as const },
    { x: W - CW - 15,    kpi: 'av'     as const },
  ]

  const lineY1 = rootBot + 2
  const lineY2 = CY - 2

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ maxHeight: 310 }}
      aria-label="KGI・KPIロジックツリー"
    >
      {/* 接続線 */}
      {positions.map(({ x, kpi }) => {
        const cx = x + CW / 2
        const isSelected = selectedKPI === kpi
        return (
          <path
            key={kpi}
            d={`M ${rootCX} ${lineY1} C ${rootCX} ${(lineY1 + lineY2) / 2}, ${cx} ${(lineY1 + lineY2) / 2}, ${cx} ${lineY2}`}
            fill="none"
            stroke={isSelected ? '#2563eb' : '#cbd5e1'}
            strokeWidth={isSelected ? 2.5 : 1.5}
            strokeDasharray={isSelected ? undefined : '5 3'}
          />
        )
      })}

      {/* KGIノード */}
      <NodeBox
        x={RX} y={RY} w={RW} h={RH}
        node={data.kgi}
        hasTarget={data.has_target}
        isRoot
      />

      {/* KPIノード */}
      {positions.map(({ x, kpi }) => (
        <NodeBox
          key={kpi}
          x={x} y={CY} w={CW} h={CH}
          node={data[kpi]}
          hasTarget={data.has_target}
          isSelected={selectedKPI === kpi}
          onClick={() => onKPIClick(kpi)}
        />
      ))}
    </svg>
  )
}
