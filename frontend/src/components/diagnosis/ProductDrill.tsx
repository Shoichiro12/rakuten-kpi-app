import { AlertTriangle } from 'lucide-react'
import type { AccessAxis, KPIs } from '../../types'
import { ACCESS_AXIS_LABEL } from '../../types'
import { formatCount, formatRate } from '../../lib/format'
import { formatCurrency } from '../../lib/utils'
import ReliabilityNote from '../ReliabilityNote'
import { FOCUS_RING } from '../../lib/a11y'
import { orderByKpiGap, type GapKpi } from '../gap/kpiGap'

interface ProductItem {
  product_url: string
  management_no: string
  product_name: string
  genre: string
  current: KPIs
  prev: KPIs | null
  changes: Record<string, number | null>
  limit_cpo_exceeded: boolean
  access_axis?: AccessAxis
  reliable?: boolean
}

interface ProductDrillProps {
  /** 選択中のジャンルキー（見出し表示用。個々の商品の genre はサブカテゴリまで含むため使わない） */
  selectedGenre: string
  products: ProductItem[]
  loading: boolean
  selectedKpi: GapKpi
  selectedProduct: ProductItem | null
  productAxis?: AccessAxis
  shopKpis: KPIs | null
  onSelect: (p: ProductItem) => void
}

/** 「N指標が基準割れ」判定。GapAnalysis.tsxの商品テーブルと同じ基準（店舗平均比75%/85%）。 */
function countWarnings(p: ProductItem, shopKpis: KPIs | null): { count: number; lowAccess: boolean } {
  const lowAccess = p.current.ct < 100
  if (!shopKpis) return { count: p.limit_cpo_exceeded ? 1 : 0, lowAccess }
  const accessWarn = lowAccess || (shopKpis.ctr > 0 && p.current.ctr < shopKpis.ctr * 0.75)
  const cvrWarn = !lowAccess && shopKpis.cvr > 0 && p.current.cvr < shopKpis.cvr * 0.85
  const avWarn = !lowAccess && shopKpis.av > 0 && p.current.av < shopKpis.av * 0.85
  return { count: [accessWarn, cvrWarn, avWarn, p.limit_cpo_exceeded].filter(Boolean).length, lowAccess }
}

/**
 * 段4（商品）。ジャンル内の商品を選択KPIのGAPが大きい順に行表示する。
 * 主要3指標（アクセス・CVR・CPO）は固定（v5モックに準拠。ジャンル・全体像を崩さないため）。
 */
export default function ProductDrill({
  selectedGenre, products, loading, selectedKpi, selectedProduct, productAxis, shopKpis, onSelect,
}: ProductDrillProps) {
  const ordered = orderByKpiGap(products, selectedKpi)

  return (
    <div className="bg-paper rounded-xl border border-line p-5">
      <div className="flex items-baseline justify-between mb-1">
        <h3 className="text-sm font-semibold text-ink">「{selectedGenre}」の中で、何が悪いか</h3>
        <span className="text-xs text-muted">{productAxis ? ACCESS_AXIS_LABEL[productAxis] : 'アクセス'}のGAPが大きい順</span>
      </div>

      {loading ? (
        <div className="h-24 flex items-center justify-center text-sm text-muted">読み込み中...</div>
      ) : ordered.length === 0 ? (
        <div className="h-24 flex items-center justify-center text-sm text-muted">商品データがありません</div>
      ) : (
        <div className="border-t border-line mt-2">
          {ordered.map((p) => {
            const isSelected = p.product_url === selectedProduct?.product_url
            const { count, lowAccess } = countWarnings(p, shopKpis)
            return (
              <button
                key={p.product_url}
                type="button"
                onClick={() => onSelect(p)}
                aria-pressed={isSelected}
                className={`w-full flex items-center gap-4 text-left px-2 py-2.5 border-b border-line last:border-b-0 transition-colors ${FOCUS_RING} ${
                  isSelected ? 'bg-bg-alt' : 'hover:bg-bg-alt'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${count > 0 ? 'bg-alert' : 'bg-line'}`}
                />
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    {count > 0 && <AlertTriangle size={12} className="text-alert shrink-0" />}
                    <span className="block font-semibold text-sm text-ink truncate">{p.product_name}</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted mt-0.5">
                    <span>{p.management_no}</span>
                    {count > 0 && <span className="text-alert">{count}指標が基準割れ</span>}
                    <ReliabilityNote reliable={p.reliable} accessAxis={p.access_axis} variant="badge" />
                  </span>
                </span>
                <span className="w-20 text-right shrink-0">
                  <span className={`font-num block text-sm tabular-nums ${lowAccess ? 'text-alert font-semibold' : 'text-ink'}`}>
                    {formatCount(p.current.ct)}
                  </span>
                  <span className="block text-xs text-muted">アクセス</span>
                </span>
                <span className="w-20 text-right shrink-0">
                  <span className="font-num block text-sm tabular-nums text-ink">{formatRate(p.current.cvr, 2)}</span>
                  <span className="block text-xs text-muted">CVR</span>
                </span>
                <span className="w-24 text-right shrink-0">
                  <span className={`font-num block text-sm tabular-nums ${p.limit_cpo_exceeded ? 'text-alert font-semibold' : 'text-ink'}`}>
                    {formatCurrency(p.current.cpo)}
                  </span>
                  <span className="block text-xs text-muted">CPO</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
