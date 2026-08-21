import { useEffect, useState, useCallback } from 'react'
import { AlertTriangle, TrendingUp, PackageX } from 'lucide-react'
import Header from '../components/layout/Header'
import PeriodSelector from '../components/PeriodSelector'
import KPIChart from '../components/dashboard/KPIChart'
import ReliabilityNote from '../components/ReliabilityNote'
import { api } from '../lib/api'
import { formatCurrency, formatPercent, formatNumber } from '../lib/utils'
import { usePeriodState } from '../lib/usePeriodState'
import { useTableSort } from '../components/table/useTableSort'
import SortableTh from '../components/table/SortableTh'
import type { ProductKPI, TrendPoint, InventoryAlert } from '../types'

/**
 * 表のセル用。**単位はセルに書かない**（見出しに1回だけ置く。規約 1-2）。
 * 表は丸めない＝生値のまま（Few「表は正確な値を確認する場所、グラフは傾向を見る場所」）。
 */
const num = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('ja-JP')
const pct = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits)

export default function ProductKPIPage() {
  const { period, dateValue, setPeriod, setDateValue, jumpToLatest } = usePeriodState()
  const sort = useTableSort<ProductKPI>()
  const [products, setProducts] = useState<ProductKPI[]>([])
  const [genres, setGenres] = useState<string[]>([])
  const [selectedGenre, setSelectedGenre] = useState<string>('')
  const [selectedProduct, setSelectedProduct] = useState<ProductKPI | null>(null)
  const [productTrend, setProductTrend] = useState<TrendPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [showInactive, setShowInactive] = useState(false)   // 廃盤商品も表示するか
  const [invAlerts, setInvAlerts] = useState<InventoryAlert[]>([])

  useEffect(() => {
    api.inventory.alerts()
      .then((d) => setInvAlerts(d.items ?? []))
      .catch((e: unknown) => { console.error('[ProductKPI] 在庫アラート取得エラー:', e); setInvAlerts([]) })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const dateParam =
        period === 'monthly' ? dateValue.slice(0, 7)
        : period === 'yearly' ? dateValue.slice(0, 4)
        : dateValue
      const [prod, genreList] = await Promise.all([
        api.products.list(period, dateParam, selectedGenre || undefined, showInactive) as Promise<{ products?: ProductKPI[] } | null>,
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
  }, [period, dateValue, selectedGenre, showInactive])

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
        subtitle={loading && products.length === 0 ? '読み込み中…' : `${products.length}件の商品${alertCount > 0 ? ` ⚠️ ${alertCount}件要確認` : ''}`}
        actions={
          <PeriodSelector
            period={period}
            onPeriodChange={setPeriod}
            dateValue={dateValue}
            onDateChange={setDateValue}
            onJumpToLatest={jumpToLatest}
          />
        }
      />

      <div className="flex-1 overflow-auto p-6 bg-bg-alt">
        <div className="flex gap-6 h-full">
          {/* 商品一覧 */}
          <div className="flex-1 min-w-0 space-y-3">
            {/* 在庫アラート（欠品・在庫僅少を機会損失順） */}
            {invAlerts.length > 0 && (
              <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b bg-amber-50 flex items-center gap-2">
                  <PackageX size={15} className="text-amber-600" />
                  <p className="text-sm font-semibold text-amber-800">
                    在庫アラート {invAlerts.length}件
                    <span className="ml-2 font-normal text-amber-600 text-xs">
                      欠品 {invAlerts.filter(a => a.status === 'out').length} / 僅少 {invAlerts.filter(a => a.status === 'low').length}
                    </span>
                  </p>
                </div>
                <ul className="divide-y divide-bg-alt max-h-56 overflow-y-auto">
                  {invAlerts.map((a) => (
                    <li key={a.management_no} className="px-4 py-2 flex items-center gap-3 text-sm">
                      <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${a.status === 'out' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                        {a.status === 'out' ? '欠品' : '僅少'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-ink">{a.product_name || a.management_no}</p>
                        <p className="text-xs text-muted">
                          {a.status === 'out'
                            ? (a.zero_stock_days > 0 ? `在庫0日数 ${a.zero_stock_days}日` : '在庫なし')
                            : `残り約${a.days_left ?? '—'}日（在庫${a.stock_count.toLocaleString()}点）`}
                        </p>
                      </div>
                      <span className="shrink-0 text-right text-xs text-muted">
                        <span className="text-muted">機会損失 </span>
                        <span className="font-semibold text-sub">約{formatCurrency(a.value_at_risk)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ジャンルフィルター */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setSelectedGenre('')}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  !selectedGenre ? 'bg-ink-strong text-white' : 'bg-white border text-sub hover:bg-bg-alt'
                }`}
              >
                すべて
              </button>
              {genres.map(g => (
                <button
                  key={g}
                  onClick={() => setSelectedGenre(g)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    selectedGenre === g ? 'bg-ink-strong text-white' : 'bg-white border text-sub hover:bg-bg-alt'
                  }`}
                >
                  {g}
                </button>
              ))}
              <label className="ml-auto flex items-center gap-1.5 text-xs text-sub cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={e => setShowInactive(e.target.checked)}
                  className="rounded border-line"
                />
                廃盤も表示
              </label>
            </div>

            {/* 一覧は「判断用」の列だけに圧縮する（2026-08-20 レビュー採用）。
                全指標（GP/GPR/CV/CVR/ROAS/Limit CPO など）は右の詳細パネルへ集約し、
                表とパネルで同じKPIを二重に出さない（表=どれを見るか決める場所、
                パネル=正確な値を確認する場所。規約4章の役割分担）。 */}
            <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
              {!loading && products.length === 0 && (
                <div className="py-12 text-center text-sm text-muted">
                  商品データがありません
                </div>
              )}
              {products.length > 0 && <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  {/* 単位はセルではなく見出しに1回だけ置く（右寄せの邪魔になるため）。規約 1-2 */}
                  <thead className="bg-bg-alt text-xs text-muted sticky top-0">
                    <tr>
                      <SortableTh label="商品名" sortKey="product_name" sort={sort} align="left" className="pl-1" />
                      <th className="px-3 py-2.5 text-left font-medium whitespace-nowrap">状態</th>
                      <SortableTh label="RPP売上（円）" sortKey="gross" sort={sort} />
                      <SortableTh label="ROI（%）" sortKey="roi" sort={sort} />
                      <SortableTh label="CPO（円）" sortKey="cpo" sort={sort} />
                      <th className="px-3 py-2.5 text-center font-medium whitespace-nowrap">詳細</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bg-alt">
                    {sort.apply(products).map((p) => {
                      const isSelected = selectedProduct?.product_url === p.product_url
                      const issues: string[] = []
                      // しきい値は生の数値で判定する（規約）。赤=即対応の意味色に統一
                      if (p.limit_cpo_exceeded) issues.push('CPO超過')
                      if (p.roi < 100) issues.push('ROI100%割れ')
                      return (
                      <tr
                        key={p.product_url}
                        onClick={() => handleSelectProduct(p)}
                        className={`cursor-pointer transition-colors ${
                          p.limit_cpo_exceeded ? 'bg-red-50 hover:bg-red-100' : isSelected ? 'bg-sage-soft' : 'hover:bg-sage-soft'
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-start gap-1.5">
                            {p.limit_cpo_exceeded && (
                              <AlertTriangle size={13} className="text-red-500 mt-0.5 shrink-0" />
                            )}
                            <div>
                              <p className="font-medium text-ink-strong leading-tight">
                                {p.product_name}
                                {p.is_active === false && (
                                  <span className="ml-1.5 align-middle px-1.5 py-0.5 rounded bg-line text-muted text-xs font-medium">廃盤</span>
                                )}
                              </p>
                              <div className="flex items-center gap-1.5">
                                <p className="text-xs text-muted">{p.management_no}</p>
                                <ReliabilityNote reliable={p.reliable} accessAxis={p.access_axis} variant="badge" />
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          {issues.length > 0 ? (
                            <span className="inline-flex flex-wrap gap-1">
                              {issues.map((label) => (
                                <span key={label} className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 whitespace-nowrap">
                                  {label}
                                </span>
                              ))}
                            </span>
                          ) : (
                            // 課題なしは色を付けない（全行が色付きになると何も目立たない。規約 2-3）
                            <span className="text-xs text-muted">良好</span>
                          )}
                        </td>
                        {/* 表は丸めない（生値）。数値は右寄せ＋等幅（tabular-nums）。規約 1-2 / 4 */}
                        <td className="px-3 py-2.5 text-right text-ink-strong font-medium tabular-nums">{num(p.gross)}</td>
                        <td className={`px-3 py-2.5 text-right font-medium tabular-nums ${p.roi < 100 ? 'text-red-600' : ''}`}>
                          {pct(p.roi)}
                        </td>
                        <td className={`px-3 py-2.5 text-right font-medium tabular-nums ${p.limit_cpo_exceeded ? 'text-red-600' : ''}`}>
                          {num(p.cpo)}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSelectProduct(p) }}
                            aria-expanded={isSelected}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                              isSelected ? 'bg-sage-deep text-white' : 'bg-bg-alt text-sub hover:bg-line'
                            }`}
                          >
                            {isSelected ? '表示中' : '詳細'}
                          </button>
                        </td>
                      </tr>
                      )
                    })}
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
                    <p className="font-semibold text-ink-strong text-sm leading-snug">{selectedProduct.product_name}</p>
                    <p className="text-xs text-muted mt-0.5">{selectedProduct.management_no}</p>
                  </div>
                  <TrendingUp size={16} className="text-sage-deep shrink-0" />
                </div>
                {selectedProduct.limit_cpo_exceeded && (
                  <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700 mb-3">
                    ⚠️ CPO（{formatCurrency(selectedProduct.cpo)}）がLimit CPO（{formatCurrency(selectedProduct.limit_cpo)}）を超過しています
                  </div>
                )}
                {/* 一覧から外した指標もここに集約する（一覧=判断用・パネル=確認用の役割分担） */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    ['RPP売上', formatCurrency(selectedProduct.gross)],
                    ['Rev', formatCurrency(selectedProduct.rev)],
                    ['ROI', formatPercent(selectedProduct.roi)],
                    ['GP', formatCurrency(selectedProduct.gp)],
                    ['GPR', formatPercent(selectedProduct.gpr)],
                    ['CV', formatNumber(selectedProduct.cv)],
                    ['CVR', formatPercent(selectedProduct.cvr, 2)],
                    ['Av', formatCurrency(selectedProduct.av)],
                    ['ROAS', formatPercent(selectedProduct.roas)],
                    ['CPC', formatCurrency(selectedProduct.cpc)],
                    ['CPO', formatCurrency(selectedProduct.cpo)],
                    ['Limit CPO', formatCurrency(selectedProduct.limit_cpo)],
                  ].map(([label, value]) => (
                    <div key={label as string} className="bg-bg-alt rounded p-2">
                      <p className="text-muted">{label}</p>
                      <p className="font-semibold text-ink-strong">{value}</p>
                    </div>
                  ))}
                </div>
                <ReliabilityNote
                  reliable={selectedProduct.reliable}
                  accessAxis={selectedProduct.access_axis}
                  className="mt-2"
                />
              </div>

              {productTrend.length > 0 && (
                <div className="bg-white rounded-xl border shadow-sm p-4">
                  <p className="text-xs font-semibold text-sub mb-2">売上トレンド</p>
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
