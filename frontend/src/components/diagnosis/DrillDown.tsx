import { useState, useEffect, useCallback } from 'react'
import { api } from '../../lib/api'
import Breadcrumbs from './Breadcrumbs'
import KpiTriage, { type TriageItem } from './KpiTriage'
import GenreDrill, { type GenreLevel } from './GenreDrill'
import ProductDrill from './ProductDrill'
import ActionRx from './ActionRx'
import { gapKpiLabel, type GapKpi } from '../gap/kpiGap'
import type { KPITree, KPIs, GenreKPI, AccessAxis, RecommendationsResponse } from '../../types'

export interface DecompItem {
  key: GapKpi
  label: string
  value: string
  change: number | null
  unit: '%' | 'pt'
  neutral: boolean
}

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

interface DrillDownProps {
  period: 'weekly' | 'monthly' | 'yearly'
  dateParam: string
  kpiTree: KPITree | null
  decompItems: DecompItem[] | null
  shopKpis: KPIs | null
  recos: RecommendationsResponse | null
  onActionChanged: () => void
}

/**
 * 段2〜5（要因 → ジャンル → 商品 → アクション）の段階表示コンテナ。
 * 状態は選択（kpi / genreLevel / genre / product）のみ持ち、判定・並び順・打ち手の
 * ロジックは既存GAP分析資産（kpiGap.ts / actionLibrary.ts / recommendations）をそのまま使う。
 */
export default function DrillDown({
  period, dateParam, kpiTree, decompItems, shopKpis, recos, onActionChanged,
}: DrillDownProps) {
  const [selectedKpi, setSelectedKpi] = useState<GapKpi | null>(null)
  const [genreLevel, setGenreLevel] = useState<GenreLevel>('u1')
  const [genreData, setGenreData] = useState<GenreKPI[]>([])
  const [genreAxis, setGenreAxis] = useState<string | null>(null)
  const [genreLoading, setGenreLoading] = useState(false)
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null)
  const [productData, setProductData] = useState<ProductItem[]>([])
  const [productAxis, setProductAxis] = useState<AccessAxis | undefined>(undefined)
  const [productLoading, setProductLoading] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null)

  // 期間が変わったら選択状態を全リセット（軸が変わりうるため。混在させない規約）
  useEffect(() => {
    setSelectedKpi(null)
    setGenreLevel('u1')
    setSelectedGenre(null)
    setSelectedProduct(null)
    setGenreData([])
    setProductData([])
  }, [period, dateParam])

  const loadGenres = useCallback(
    (level: GenreLevel) => {
      setGenreLoading(true)
      api.gap
        .genre(period, dateParam, true, level)
        .then((res) => {
          const r = res as { genres?: GenreKPI[]; axis?: string | null } | null
          setGenreData(r?.genres ?? [])
          setGenreAxis(r?.axis ?? null)
        })
        .catch(() => {
          setGenreData([])
          setGenreAxis(null)
        })
        .finally(() => setGenreLoading(false))
    },
    [period, dateParam],
  )

  const loadProducts = useCallback(
    (genre: string) => {
      setProductLoading(true)
      api.gap
        .product(period, dateParam, genre, false)
        .then((res) => {
          const r = res as { products?: ProductItem[]; access_axis?: AccessAxis } | null
          setProductData(r?.products ?? [])
          setProductAxis(r?.access_axis)
        })
        .catch(() => {
          setProductData([])
          setProductAxis(undefined)
        })
        .finally(() => setProductLoading(false))
    },
    [period, dateParam],
  )

  const handleSelectKpi = (kpi: GapKpi) => {
    setSelectedKpi(kpi)
    setSelectedGenre(null)
    setSelectedProduct(null)
    setGenreLevel('u1')
    loadGenres('u1')
  }

  const handleLevelChange = (level: GenreLevel) => {
    // 粒度を切り替えたら選択状態をリセット（切替直後の食い違いを防ぐ）
    setGenreLevel(level)
    setSelectedGenre(null)
    setSelectedProduct(null)
    loadGenres(level)
  }

  const handleSelectGenre = (genre: string) => {
    setSelectedGenre(genre)
    setSelectedProduct(null)
    loadProducts(genre)
  }

  // 段2の入力を統一形式に変換。月次・年次はkpiTree（目標比較あり）、週次はdecompItems（前期比のみ）。
  const triageItems: TriageItem[] = (() => {
    const comparable = !!kpiTree && kpiTree.target_comparable !== false && kpiTree.has_target
    if (comparable && kpiTree) {
      const axisLabel = kpiTree.axis === 'shop' ? 'shop' : undefined
      const nodes: Array<{ key: GapKpi; node: typeof kpiTree.access }> = [
        { key: 'access', node: kpiTree.access },
        { key: 'cvr', node: kpiTree.cvr },
        { key: 'av', node: kpiTree.av },
      ]
      return nodes.map(({ key, node }) => ({
        key,
        label: gapKpiLabel(key, axisLabel),
        value:
          node.unit === 'currency' ? `¥${Math.round(node.actual).toLocaleString()}`
            : node.unit === 'percent' ? `${node.actual.toFixed(2)}%`
              : node.actual.toLocaleString(),
        comparable: true,
        achieved: node.achieve_rate != null ? node.achieve_rate >= 100 : null,
        achieveRate: node.achieve_rate,
        change: null,
        changeUnit: '%' as const,
        neutral: false,
      }))
    }
    if (!decompItems) return []
    return decompItems.map((d) => ({
      key: d.key,
      label: d.label,
      value: d.value,
      comparable: false,
      achieved: null,
      achieveRate: null,
      change: d.change,
      changeUnit: d.unit,
      neutral: d.neutral,
    }))
  })()

  if (triageItems.length === 0) return null

  const axisLabelForBreadcrumb = kpiTree?.axis === 'shop' ? 'shop' : undefined
  const breadcrumbs = [
    {
      label: '全体',
      onClick: () => {
        setSelectedKpi(null)
        setSelectedGenre(null)
        setSelectedProduct(null)
      },
    },
    ...(selectedKpi
      ? [{
          label: gapKpiLabel(selectedKpi, axisLabelForBreadcrumb),
          onClick: () => {
            setSelectedGenre(null)
            setSelectedProduct(null)
          },
        }]
      : []),
    ...(selectedGenre ? [{ label: selectedGenre, onClick: () => setSelectedProduct(null) }] : []),
    ...(selectedProduct ? [{ label: selectedProduct.product_name }] : []),
  ]

  return (
    <div>
      <Breadcrumbs items={breadcrumbs} />

      <KpiTriage items={triageItems} selectedKpi={selectedKpi} onSelect={handleSelectKpi} />

      {selectedKpi && (
        <div className="mt-4">
          <GenreDrill
            level={genreLevel}
            onLevelChange={handleLevelChange}
            genres={genreData}
            loading={genreLoading}
            selectedGenre={selectedGenre}
            selectedKpi={selectedKpi}
            axis={genreAxis}
            onSelect={handleSelectGenre}
          />
        </div>
      )}

      {selectedKpi && selectedGenre && (
        <div className="mt-4">
          <ProductDrill
            selectedGenre={selectedGenre}
            products={productData}
            loading={productLoading}
            selectedKpi={selectedKpi}
            selectedProduct={selectedProduct}
            productAxis={productAxis}
            shopKpis={shopKpis}
            onSelect={setSelectedProduct}
          />
        </div>
      )}

      {/* 段5（アクション）は診断系のため年次では出さない（GAP分析画面のActionPanelと同じ方針） */}
      {selectedProduct && shopKpis && period !== 'yearly' && (
        <div className="mt-4">
          <ActionRx
            product={selectedProduct}
            shopKpis={shopKpis}
            weekKey={dateParam}
            recos={recos}
            onActionChanged={onActionChanged}
          />
        </div>
      )}
      {selectedProduct && period === 'yearly' && (
        <div className="mt-4 bg-paper rounded-xl border border-line p-5">
          <p className="text-xs text-muted">
            打ち手の提案は月次で行っています。この商品を月次に切り替えて確認してください。
          </p>
        </div>
      )}
    </div>
  )
}
