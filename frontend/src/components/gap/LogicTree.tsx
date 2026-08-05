import type { KeyboardEvent } from 'react'
import type { KPITree, KPITreeNode } from '../../types'

interface LogicTreeProps {
  data: KPITree
  selectedKPI: string | null
  onKPIClick: (key: 'access' | 'cvr' | 'av') => void
}

/**
 * ノードの色。
 *
 * 以前は達成率を緑・黄・赤の3段で塗り分けていたが、**色の濃さで量を表すのは
 * 知覚の正確さで最下位**（Cleveland & McGill）。量は各ノードの中に入れた
 * 弾丸グラフ（長さ）が担い、色はしきい値を割ったときの警告だけに使う。
 * 規約: docs/ui_number_and_chart_rules_2026-08-04.md 3-1 / 3-3
 */
function nodeColor(achieve: number, hasTarget: boolean) {
  if (!hasTarget || achieve === 0) return { stroke: '#e6e5e2', fill: '#ffffff', text: '#86837d' }
  if (achieve < 80) return { stroke: '#f0cfcf', fill: '#fdf4f4', text: '#b2312f' }
  return { stroke: '#e6e5e2', fill: '#ffffff', text: '#55534f' }
}

const INK = '#1a1a19'
const SUB = '#55534f'
const MUTED = '#86837d'

/**
 * ノードの中に描く弾丸グラフ（Few の設計仕様に沿った簡易版）。
 * 実績＝濃い棒、目標＝濃い縦線、背景＝1色の濃淡3段。
 * 幅は px 指定で、親SVGの座標系にそのまま乗せる。
 */
function NodeBullet({ x, y, w, actual, target }: { x: number; y: number; w: number; actual: number; target: number }) {
  const hi = Math.max(actual, target) * 1.25 || 1
  const px = (v: number) => Math.max(0, Math.min(w, (v / hi) * w))
  const b1 = px(target * 0.8)
  const b2 = px(target)
  return (
    <g>
      <rect x={x} y={y} width={b1} height="12" fill={INK} opacity="0.10" />
      <rect x={x + b1} y={y} width={Math.max(0, b2 - b1)} height="12" fill={INK} opacity="0.06" />
      <rect x={x + b2} y={y} width={Math.max(0, w - b2)} height="12" fill={INK} opacity="0.03" />
      <rect x={x} y={y + 3} width={px(actual)} height="6" fill={INK} />
      <rect x={x + px(target) - 1} y={y - 2} width="2" height="16" fill={INK} />
    </g>
  )
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
  /** 目標が出せないときの文言。「未設定」なのか「この期間は比較しない」なのかを言い分ける */
  emptyLabel?: string
  isRoot?: boolean
  isSelected?: boolean
  onClick?: () => void
}

function NodeBox({ x, y, w, h, node, hasTarget, emptyLabel = '目標未設定', isRoot, isSelected, onClick }: NodeBoxProps) {
  const { stroke, fill, text } = nodeColor(node.achieve_rate, hasTarget)
  const cx = x + w / 2
  const strokeW = isSelected ? 3 : isRoot ? 2 : 1.5

  const ariaLabel = onClick
    ? `${node.label}　実績${formatVal(node)}${
        hasTarget && node.target > 0
          ? `　目標${formatTarget(node)}　達成率${node.achieve_rate.toFixed(0)}%`
          : ''
      }　クリックでジャンル別内訳へ`
    : undefined

  const handleKeyDown = onClick
    ? (e: KeyboardEvent<SVGGElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }
    : undefined

  return (
    <g
      onClick={onClick}
      onKeyDown={handleKeyDown}
      tabIndex={onClick ? 0 : undefined}
      role={onClick ? 'button' : undefined}
      aria-label={ariaLabel}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      className={onClick ? 'outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2' : undefined}
    >
      <rect
        x={x} y={y} width={w} height={h} rx={12}
        fill={fill}
        stroke={isSelected ? INK : stroke}
        strokeWidth={strokeW}
        
      />

      {/* ラベル */}
      <text
        x={cx} y={y + 22}
        textAnchor="middle"
        fontSize={isRoot ? 13 : 12}
        fontWeight="bold"
        fill={SUB}
      >
        {isRoot ? 'KGI：' : 'KPI：'}{node.label}
      </text>

      {hasTarget && node.target > 0 ? (
        <>
          {/* 実績（このノードの主役。左寄せ）と達成率（右） */}
          <text x={x + 14} y={y + 44} fontSize={14} fontWeight="700" fill={INK}>
            {formatVal(node)}
          </text>
          <text x={x + w - 14} y={y + 44} textAnchor="end" fontSize={12} fontWeight="600" fill={text}>
            達成率 {node.achieve_rate.toFixed(0)}%
          </text>
          {/* 弾丸グラフ: 実績を「長さ」で、目標を縦線で示す。色ではなく長さで量を伝える */}
          <NodeBullet x={x + 14} y={y + 52} w={w - 28} actual={node.actual} target={node.target} />
          <text x={x + 14} y={y + 80} fontSize={10.5} fill={MUTED}>
            目標 {formatTarget(node)}
          </text>
          <text x={x + w - 14} y={y + 80} textAnchor="end" fontSize={10.5} fontWeight="600" fill={text}>
            {formatGap(node)}
          </text>
        </>
      ) : (
        <>
          <text x={cx} y={y + 52} textAnchor="middle" fontSize={14} fontWeight="700" fill={INK}>
            {formatVal(node)}
          </text>
          <text x={cx} y={y + 72} textAnchor="middle" fontSize={11} fill={MUTED}>
            {emptyLabel}
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
      <div className="h-48 flex items-center justify-center text-sm text-gray-500">
        データがありません
      </div>
    )
  }

  // 目標が出ない理由を言い分ける。週次は「未設定」ではなく「この期間は比較しない」
  const emptyLabel = data.target_comparable === false ? '週次は目標比較なし' : '目標未設定'

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
            stroke={isSelected ? INK : '#d8d6d1'}
            strokeWidth={isSelected ? 2.5 : 1.5}
            
          />
        )
      })}

      {/* KGIノード */}
      <NodeBox
        x={RX} y={RY} w={RW} h={RH}
        node={data.kgi}
        hasTarget={data.has_target}
        emptyLabel={emptyLabel}
        isRoot
      />

      {/* KPIノード */}
      {positions.map(({ x, kpi }) => (
        <NodeBox
          key={kpi}
          x={x} y={CY} w={CW} h={CH}
          node={data[kpi]}
          hasTarget={data.has_target}
          emptyLabel={emptyLabel}
          isSelected={selectedKPI === kpi}
          onClick={() => onKPIClick(kpi)}
        />
      ))}
    </svg>
  )
}
