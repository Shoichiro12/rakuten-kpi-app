import { useEffect, useState, useCallback } from 'react'
import { AlertTriangle, TrendingUp } from 'lucide-react'
import Header from '../components/layout/Header'
import PeriodSelector from '../components/PeriodSelector'
import KPIChart from '../components/dashboard/KPIChart'
import { api } from '../lib/api'
import { formatCurrency, formatPercent, formatNumber } from '../lib/utils'
import { usePeriodState } from '../lib/usePeriodState'
import type { ProductKPI, TrendPoint } from '../types'

export default function ProductKPIPage() {
  const { period, dateValue, setPeriod, setDateValue } = usePeriodState()
  const [products, setProducts] = useState<ProductKPI[]>([])
  const [genres, setGenres] = useState<string[]>([])
  const [selectedGenre, setSelectedGenre] = useState<string>('')
  const [selectedProduct, setSelectedProduct] = useState<ProductKPI | null>(null)
  const [productTrend, setProductTrend] = useState<TrendPoint[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const dateParam = period === 'monthly' ? dateValue.slice(0, 7) : dateValue
      const [prod, genreList] = await Promise.all([
        api.products.list(period, dateParam, selectedGenre || undefined) as Promise<{ products?: ProductKPI[] } | null>,
        api.products.genres() as Promise<{ genres?: string[] } | null>,
      ])
      setProducts(prod?.products ?? [])
      setGenres(genreList?.genres ?? [])
    } catch (e) {
      console.error('[ProductKPI] データ取得エラー:', e)
      setProducts([])
      setGenres([])
    } finally {
      setLoading(false)
    }
  }, [period, dateValue, selectedGenre])

  useEffect(() => { load() }, [load])

  const loadTrend = async (managementNo: string) => {
    try {
      const data = await api.products.trend(managementNo, 8) as { trend?: TrendPoint[] } | null
      setProductTrend(data?.trend ?? [])
    } catch (e) {
      console.error('[ProductKPI] トレンドデータ取得エラー:', e)
      setProductTrend([])
    }
  }

  const handleSelectProduct = (p: ProductKPI) => {
    setSelectedProduct(p)
    loadTrend(p.management_no)
  }

  const alertCount = products.filter(p => p.limit_cpo_exceeded).length

  return (
    <div className="flex flex-col h-full">
      <Header
        title="商品別KPI"
        subtitle={`${products.length}件の商品${alertCount > 0 ? ` ⚠️ ${alertCount}件要確認` : ''}`}
        actions={
          <PeriodSelector
            period={period}
            onPeriodChange={setPeriod}
            dateValue={dateValue}
            onDateChange={setDateValue}
          />
        }
      />

      <div className="flex-1 overflow-auto p-6 bg-gray-50">
        <div className="flex gap-6 h-full">
          {/* 商品一覧 */}
          <div className="flex-1 min-w-0 space-y-3">
            {/* ジャンルフィルター */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setSelectedGenre('')}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  !selectedGenre ? 'bg-gray-900 text-white' : 'bg-white border text-gray-600 hover:bg-gray-50'
                }`}
              >
                すべて
              </button>
              {genres.map(g => (
                <button
                  key={g}
                  onClick={() => setSelectedGenre(g)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    selectedGenre === g ? 'bg-gray-900 text-white' : 'bg-white border text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>

            <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
              {!loading && products.length === 0 && (
                <div className="py-12 text-center text-sm text-gray-400">
                  商品データがありません
                </div>
              )}
              {products.length > 0 && <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase sticky top-0">
                    <tr>
                      <th className="px-4 py-2.5 text-left">商品名</th>
                      <th className="px-3 py-2.5 text-right">RPP売上</th>
                      <th className="px-3 py-2.5 text-right">GP</th>
                      <th className="px-3 py-2.5 text-right">GPR</th>
                      <th className="px-3 py-2.5 text-right">CV</th>
                      <th className="px-3 py-2.5 text-right">CVR</th>
                      <th className="px-3 py-2.5 text-right">ROAS</th>
                      <th className="px-3 py-2.5 text-right">CPO</th>
                      <th className="px-3 py-2.5 text-right">LimitCPO</th>
                      <th className="px-3 py-2.5 text-right">ROI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {products.map((p) => (
                      <tr
                        key={p.product_url}
                        onClick={() => handleSelectProduct(p)}
                        className={`hover:bg-blue-50 cursor-pointer transition-colors ${
                          selectedProduct?.product_url === p.product_url ? 'bg-blue-50' : ''
                        } ${p.limit_cpo_exceeded ? 'bg-red-50 hover:bg-red-100' : ''}`}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-start gap-1.5">
                            {p.limit_cpo_exceeded && (
                              <AlertTriangle size={13} className="text-red-500 mt-0.5 shrink-0" />
                            )}
                            <div>
                              <p className="font-medium text-gray-900 leading-tight">{p.product_name}</p>
                              <p className="text-xs text-gray-400">{p.management_no}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-900 font-medium">{formatCurrency(p.gross)}</td>
                        <td className="px-3 py-2.5 text-right">{formatCurrency(p.gp)}</td>
                        <td className="px-3 py-2.5 text-right">{formatPercent(p.gpr)}</td>
                        <td className="px-3 py-2.5 text-right">{formatNumber(p.cv)}</td>
                        <td className="px-3 py-2.5 text-right">{formatPercent(p.cvr, 2)}</td>
                        <td className="px-3 py-2.5 text-right">{formatPercent(p.roas)}</td>
                        <td className={`px-3 py-2.5 text-right font-medium ${p.limit_cpo_exceeded ? 'text-red-600' : ''}`}>
                          {formatCurrency(p.cpo)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-500">{formatCurrency(p.limit_cpo)}</td>
                        <td className={`px-3 py-2.5 text-right font-medium ${p.roi < 100 ? 'text-red-600' : 'text-green-600'}`}>
                          {formatPercent(p.roi)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
            </div>
          </div>

          {/* 商品詳細パネル */}
          {selectedProduct && (
            <div className="w-72 shrink-0 space-y-3">
              <div className="bg-white rounded-xl border shadow-sm p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-gray-900 text-sm leading-snug">{selectedProduct.product_name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{selectedProduct.management_no}</p>
                  </div>
                  <TrendingUp size={16} className="text-blue-500 shrink-0" />
                </div>
                {selectedProduct.limit_cpo_exceeded && (
                  <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 mb-3">
                    ⚠️ CPO（{formatCurrency(selectedProduct.cpo)}）がLimit CPO（{formatCurrency(selectedProduct.limit_cpo)}）を超過しています
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    ['Rev', formatCurrency(selectedProduct.rev)],
                    ['ROI', formatPercent(selectedProduct.roi)],
                    ['GP', formatCurrency(selectedProduct.gp)],
                    ['GPR', formatPercent(selectedProduct.gpr)],
                    ['Av', formatCurrency(selectedProduct.av)],
                    ['CVR', formatPercent(selectedProduct.cvr, 2)],
                    ['ROAS', formatPercent(selectedProduct.roas)],
                    ['CPC', formatCurrency(selectedProduct.cpc)],
                  ].map(([label, value]) => (
                    <div key={label as string} className="bg-gray-50 rounded p-2">
                      <p className="text-gray-500">{label}</p>
                      <p className="font-semibold text-gray-900">{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {productTrend.length > 0 && (
                <div className="bg-white rounded-xl border shadow-sm p-4">
                  <p className="text-xs font-semibold text-gray-700 mb-2">売上トレンド</p>
                  <KPIChart
                    data={productTrend}
                    metric="gross"
                    label="RPP売上"
                    color="#2563eb"
                    formatter={(v) => `¥${v.toLocaleString()}`}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
