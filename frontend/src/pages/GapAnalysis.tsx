import { useEffect, useState, useCallback } from 'react'
import { AlertTriangle } from 'lucide-react'
import Header from '../components/layout/Header'
import PeriodSelector from '../components/PeriodSelector'
import LogicTree from '../components/gap/LogicTree'
import StepIndicator from '../components/gap/StepIndicator'
import GenreCards from '../components/gap/GenreCards'
import ActionPanel from '../components/gap/ActionPanel'
import EvaluationMatrix from '../components/EvaluationMatrix'
import { api } from '../lib/api'
import { formatCurrency, formatPercent, formatNumber } from '../lib/utils'
import { usePeriodState } from '../lib/usePeriodState'
import type { KPIs, GenreKPI, KPITree, EvaluationResult } from '../types'

interface ShopData { current: KPIs; prev: KPIs | null; changes: Record<string, number | null> }
interface ProductItem {
  product_url: string; management_no: string; product_name: string; genre: string
  current: KPIs; prev: KPIs | null; changes: Record<string, number | null>; limit_cpo_exceeded: boolean
}

function ChangeCell({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-gray-400">—</span>
  const up = value > 0
  return <span className={`font-medium ${up ? 'text-green-600' : 'text-red-500'}`}>{up ? '+' : ''}{value.toFixed(1)}%</span>
}

export default function GapAnalysis() {
  const { period, dateValue, setPeriod, setDateValue } = usePeriodState()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selectedKPI, setSelectedKPI] = useState<'access' | 'cvr' | 'av' | null>(null)
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null)

  const [treeData, setTreeData] = useState<KPITree | null>(null)
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null)
  const [shopData, setShopData] = useState<ShopData | null>(null)
  const [genreData, setGenreData] = useState<GenreKPI[]>([])
  // 集計軸（'shop'=商品分析／null=RPP）。月次と週次でCVRの母数が変わるため保持する。
  const [genreAxis, setGenreAxis] = useState<string | null>(null)
  const [productData, setProductData] = useState<ProductItem[]>([])
  const [loading, setLoading] = useState(false)

  const dateParam = period === 'monthly' ? dateValue.slice(0, 7) : dateValue

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tree, shop, genre, evalRes] = await Promise.all([
        api.gap.kpiTree(period, dateParam) as Promise<KPITree | null>,
        api.gap.shop(period, dateParam) as Promise<ShopData | null>,
        api.gap.genre(period, dateParam) as Promise<{ genres?: GenreKPI[]; axis?: string | null } | null>,
        api.evaluation.matrix(period, dateParam).catch(() => null),
      ])
      setTreeData(tree ?? null)
      setShopData(shop ?? null)
      setGenreData(genre?.genres ?? [])
      setGenreAxis(genre?.axis ?? null)
      setEvaluation(evalRes?.evaluation ?? null)
    } catch (e) {
      console.error('[GapAnalysis] データ取得エラー:', e)
      // エラー時は既存の表示を維持しつつ、空状態に戻す
      setTreeData(null)
      setShopData(null)
      setGenreData([])
      setEvaluation(null)
    } finally {
      setLoading(false)
    }
  }, [period, dateParam])

  const loadProducts = useCallback(async (genre?: string) => {
    try {
      const prod = await api.gap.product(period, dateParam, genre) as { products?: ProductItem[] } | null
      setProductData(prod?.products ?? [])
    } catch (e) {
      console.error('[GapAnalysis] 商品データ取得エラー:', e)
      setProductData([])
    }
  }, [period, dateParam])


  useEffect(() => { load() }, [load])

  const handleKPIClick = (kpi: 'access' | 'cvr' | 'av') => {
    setSelectedKPI(kpi)
    setSelectedGenre(null)
    setSelectedProduct(null)
    setStep(2)
    loadProducts()
  }

  const handleGenreSelect = (genre: string) => {
    setSelectedGenre(genre)
    setSelectedProduct(null)
    setStep(3)
    loadProducts(genre)
  }

  const handleStepClick = (s: 1 | 2 | 3) => {
    setStep(s)
    if (s === 1) { setSelectedKPI(null); setSelectedGenre(null); setSelectedProduct(null) }
    if (s === 2) { setSelectedGenre(null); setSelectedProduct(null) }
    if (s === 3 && !selectedGenre) setStep(2)
  }

  const weekKey = period === 'monthly' ? dateValue.slice(0, 7) : dateValue

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="GAP分析"
        subtitle="KGI・KPIロジックツリーから課題を特定し改善アクションへ"
        actions={
          <PeriodSelector
            period={period}
            onPeriodChange={setPeriod}
            dateValue={dateValue}
            onDateChange={setDateValue}
          />
        }
      />

      <div className="flex flex-1 overflow-hidden">
        {/* メインコンテンツ */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-gray-50 min-w-0">

          {/* STEP インジケーター */}
          <StepIndicator currentStep={step} onStepClick={handleStepClick} />

          {/* 評価マトリクス（17パターン・目標×YoY統一判定） */}
          {evaluation && <EvaluationMatrix evaluation={evaluation} />}

          {/* ロジックツリー */}
          <div className="bg-white rounded-xl border shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-gray-900">ロジックツリー — KGI・KPI比較</h3>
                <p className="text-xs text-gray-500 mt-0.5">KPIノードをクリックするとジャンル別ドリルダウンに進みます</p>
              </div>
              {!treeData?.has_target && (
                <a
                  href="/targets"
                  className="text-xs text-blue-500 hover:text-blue-700 border border-blue-200 rounded-lg px-3 py-1.5"
                >
                  目標設定へ →
                </a>
              )}
            </div>

            {treeData ? (
              <LogicTree
                data={treeData}
                selectedKPI={selectedKPI}
                onKPIClick={handleKPIClick}
              />
            ) : (
              <div className="h-48 flex items-center justify-center text-sm text-gray-400">
                {loading ? '読み込み中...' : 'データがありません'}
              </div>
            )}

            {!treeData?.has_target && (
              <p className="mt-3 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                💡 「目標設定」画面でKGI/KPI目標を設定すると、達成率・GAP分析が有効になります
              </p>
            )}
          </div>

          {/* STEP2: ジャンルカード */}
          {(step >= 2 || selectedKPI) && genreData.length > 0 && (
            <div className="bg-white rounded-xl border shadow-sm p-5">
              <GenreCards
                axis={genreAxis}
                genres={genreData}
                selectedGenre={selectedGenre}
                selectedKPI={selectedKPI}
                onSelect={handleGenreSelect}
              />
            </div>
          )}

          {/* STEP3: 商品一覧テーブル */}
          {step === 3 && selectedGenre && (
            <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">商品別KPI</h3>
                  <p className="text-xs text-gray-500">{selectedGenre} — {productData.length}件</p>
                </div>
                <button
                  onClick={() => { setSelectedProduct(null); setStep(2) }}
                  className="text-xs text-blue-500 hover:text-blue-700"
                >
                  ← ジャンル一覧へ
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="px-4 py-2.5 text-left">商品名</th>
                      <th className="px-3 py-2.5 text-right">売上</th>
                      <th className="px-3 py-2.5 text-right">前期比</th>
                      <th className="px-3 py-2.5 text-right">GP</th>
                      <th className="px-3 py-2.5 text-right">アクセス</th>
                      <th className="px-3 py-2.5 text-right">CV</th>
                      <th className="px-3 py-2.5 text-right">CVR</th>
                      <th className="px-3 py-2.5 text-right">ROAS</th>
                      <th className="px-3 py-2.5 text-right">CPO</th>
                      <th className="px-3 py-2.5 text-center">アクション</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {productData.map((p) => {
                      const isSelected = selectedProduct?.product_url === p.product_url
                      // 優先度: 在庫 > アクセス > 客単価 = CVR（講座ロジック準拠）
                      const accessWarn = p.current.ct < 100 ||
                        (shopData && shopData.current.ctr > 0 && p.current.ctr < shopData.current.ctr * 0.75)
                      const lowAccess = p.current.ct < 100
                      // アクセス母数不足(100未満)の場合、CVR・客単価の警告は表示しない（信用できない数値のため）
                      const cvrWarn = !lowAccess && shopData && p.current.cvr < shopData.current.cvr * 0.85
                      const avWarn = !lowAccess && shopData && p.current.av < shopData.current.av * 0.85
                      return (
                        <tr
                          key={p.product_url}
                          onClick={() => setSelectedProduct(isSelected ? null : p)}
                          className={`cursor-pointer transition-colors ${
                            isSelected ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'
                          } ${p.limit_cpo_exceeded ? 'bg-red-50 hover:bg-red-100' : ''}`}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5">
                              {p.limit_cpo_exceeded && <AlertTriangle size={12} className="text-red-500 shrink-0" />}
                              <div>
                                <p className="font-medium text-gray-900 text-xs leading-tight">{p.product_name}</p>
                                <p className="text-gray-400 text-xs">{p.management_no}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-medium text-xs">{formatCurrency(p.current.gross)}</td>
                          <td className="px-3 py-2.5 text-right text-xs"><ChangeCell value={p.changes.gross} /></td>
                          <td className="px-3 py-2.5 text-right text-xs">{formatCurrency(p.current.gp)}</td>
                          <td className={`px-3 py-2.5 text-right text-xs font-medium ${accessWarn ? 'text-red-600' : ''}`}>
                            {formatNumber(p.current.ct)}
                            {accessWarn && ' ⚠️'}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs">{formatNumber(p.current.cv)}</td>
                          <td className={`px-3 py-2.5 text-right text-xs font-medium ${cvrWarn ? 'text-red-600' : ''}`}>
                            {formatPercent(p.current.cvr, 2)}
                            {cvrWarn && ' ⚠️'}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs">{formatPercent(p.current.roas)}</td>
                          <td className={`px-3 py-2.5 text-right text-xs ${p.limit_cpo_exceeded ? 'text-red-600 font-bold' : ''}`}>
                            {formatCurrency(p.current.cpo)}
                          </td>
                          <td className="px-3 py-2.5 text-center text-xs">
                            <button
                              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                                isSelected
                                  ? 'bg-blue-600 text-white'
                                  : accessWarn || cvrWarn || avWarn || p.limit_cpo_exceeded
                                  ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                              }`}
                            >
                              {isSelected ? '閉じる' : accessWarn || cvrWarn || avWarn || p.limit_cpo_exceeded ? '⚠️ 改善' : '改善策'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 参照用: ジャンル別KPI テーブル */}
          {genreData.length > 0 && (
            <details className="group">
              <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600 select-none list-none flex items-center gap-1">
                <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                ジャンル別KPI（参照用テーブル）
              </summary>
              <div className="mt-2 bg-white rounded-xl border shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <tr>
                        <th className="px-4 py-2 text-left">ジャンル</th>
                        <th className="px-4 py-2 text-right">RPP売上</th>
                        <th className="px-4 py-2 text-right">前期比</th>
                        <th className="px-4 py-2 text-right">GP</th>
                        <th className="px-4 py-2 text-right">CVR</th>
                        <th className="px-4 py-2 text-right">客単価</th>
                        <th className="px-4 py-2 text-right">ROAS</th>
                        <th className="px-4 py-2 text-right">ROI</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {genreData.map((g) => (
                        <tr key={g.genre} className="hover:bg-gray-50">
                          <td className="px-4 py-2.5 font-medium text-gray-900 text-xs">{g.genre}</td>
                          <td className="px-4 py-2.5 text-right text-xs">{formatCurrency(g.current.gross)}</td>
                          <td className="px-4 py-2.5 text-right text-xs"><ChangeCell value={g.changes.gross} /></td>
                          <td className="px-4 py-2.5 text-right text-xs">{formatCurrency(g.current.gp)}</td>
                          <td className="px-4 py-2.5 text-right text-xs">{formatPercent(g.current.cvr, 2)}</td>
                          <td className="px-4 py-2.5 text-right text-xs">{formatCurrency(g.current.av)}</td>
                          <td className="px-4 py-2.5 text-right text-xs">{formatPercent(g.current.roas)}</td>
                          <td className="px-4 py-2.5 text-right text-xs">{formatPercent(g.current.roi)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
          )}
        </div>

        {/* アクションパネル（右サイド） */}
        {selectedProduct && shopData && (
          <ActionPanel
            product={selectedProduct}
            shopKpis={shopData.current}
            weekKey={weekKey}
            onClose={() => setSelectedProduct(null)}
          />
        )}
      </div>
    </div>
  )
}
