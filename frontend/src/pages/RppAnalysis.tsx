import { useState, useEffect, useCallback } from 'react'
import { BarChart2, RefreshCw, ChevronDown } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'
import Header from '../components/layout/Header'
import RppDiagnosisPanel from '../components/rpp/RppDiagnosisPanel'
import { api } from '../lib/api'
import { formatCurrency, formatPercent } from '../lib/utils'
import type {
  RppPeriods, RppWeeklyPeriod, RppMonthlyPeriod,
  RppSummaryResponse, RppSalesItem, RppDiagnosisResponse, RppDiagnosisItem,
} from '../types'

type PeriodType = 'weekly' | 'monthly'

/* ─── KPIミニカード（720h / 12h 併記） ─────────────────────── */
function MiniKpiCard({
  label,
  value720,
  value12,
  label720 = '720h',
  label12 = '12h',
}: {
  label: string
  value720: string
  value12: string
  label720?: string
  label12?: string
}) {
  return (
    <div className="bg-white rounded-xl border shadow-sm p-4 space-y-2">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <div className="flex items-end gap-3">
        <div>
          <p className="text-2xl font-bold text-gray-900">{value720}</p>
          <p className="text-xs text-gray-400 mt-0.5">{label720}</p>
        </div>
        <div className="pb-1">
          <p className="text-base font-semibold text-gray-500">{value12}</p>
          <p className="text-xs text-gray-400">{label12}</p>
        </div>
      </div>
    </div>
  )
}

/* ─── 期間セレクタ ────────────────────────────────────────── */
function PeriodSelect<T extends RppWeeklyPeriod | RppMonthlyPeriod>({
  options,
  value,
  onChange,
  renderLabel,
  renderValue,
}: {
  options: T[]
  value: string
  onChange: (val: string, item: T | undefined) => void
  renderLabel: (item: T) => string
  renderValue: (item: T) => string
}) {
  if (options.length === 0) {
    return <span className="text-xs text-gray-400 px-2 py-1">データなし</span>
  }
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => {
          const item = options.find((o) => renderValue(o) === e.target.value)
          onChange(e.target.value, item)
        }}
        className="appearance-none pl-3 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
      >
        {options.map((o) => (
          <option key={renderValue(o)} value={renderValue(o)}>
            {renderLabel(o)}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-gray-400"
      />
    </div>
  )
}

/* ─── 診断バッジ（テーブルの診断列） ──────────────────────── */
// 課題コード → テーブル表示用の短縮ラベル
const ISSUE_SHORT: Record<string, string> = {
  cpo_over: 'CPO超過',
  roas_low: 'ROAS<100%',
  ctr_low: 'CTR低',
  cvr_low: 'CVR低',
  cpc_spike: 'CPC急騰',
}

function DiagnosisBadges({ diag }: { diag: RppDiagnosisItem | undefined }) {
  if (!diag) {
    return <span className="text-gray-300">—</span>
  }
  if (diag.status === 'insufficient_data') {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
        データ不足
      </span>
    )
  }
  if (diag.status === 'good') {
    return (
      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700">
        良好
      </span>
    )
  }
  const shown = diag.issues.slice(0, 2)
  const rest = diag.issues.length - shown.length
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {shown.map((i) => (
        <span
          key={i.issue}
          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${
            i.confidence === 'confirmed'
              ? 'bg-red-100 text-red-700'
              : 'bg-amber-100 text-amber-700'
          }`}
          title={`${i.label}（${i.confidence === 'confirmed' ? '確定' : '要確認'}）`}
        >
          {ISSUE_SHORT[i.issue] ?? i.issue}
        </span>
      ))}
      {rest > 0 && <span className="text-[10px] text-gray-400">+{rest}</span>}
    </span>
  )
}

/* ─── メインページ ────────────────────────────────────────── */
export default function RppAnalysis() {
  const [periodType, setPeriodType] = useState<PeriodType>('weekly')
  const [periods, setPeriods] = useState<RppPeriods>({ weekly: [], monthly: [] })
  const [selectedWeekly, setSelectedWeekly] = useState<RppWeeklyPeriod | null>(null)
  const [selectedMonthly, setSelectedMonthly] = useState<RppMonthlyPeriod | null>(null)

  const [summary, setSummary] = useState<RppSummaryResponse | null>(null)
  const [salesItems, setSalesItems] = useState<RppSalesItem[]>([])
  const [salesTotal, setSalesTotal] = useState(0)
  const [diagnosis, setDiagnosis] = useState<RppDiagnosisResponse | null>(null)
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* 期間一覧を取得 */
  const loadPeriods = useCallback(async () => {
    try {
      const p = await api.rpp.periods()
      setPeriods(p)
      if (p.weekly.length > 0) setSelectedWeekly(p.weekly[0])
      if (p.monthly.length > 0) setSelectedMonthly(p.monthly[0])
    } catch (e) {
      console.error('[RppAnalysis] 期間取得エラー:', e)
    }
  }, [])

  useEffect(() => { loadPeriods() }, [loadPeriods])

  /* サマリー＆商品一覧＆診断を取得 */
  const loadData = useCallback(async () => {
    const params =
      periodType === 'weekly' && selectedWeekly
        ? {
            period_type: 'weekly' as const,
            year_month: selectedWeekly.year_month,
            date_from: selectedWeekly.date_from,
            date_to: selectedWeekly.date_to,
          }
        : periodType === 'monthly' && selectedMonthly
        ? {
            period_type: 'monthly' as const,
            year_month: selectedMonthly.year_month,
          }
        : null

    if (!params) return

    setLoading(true)
    setError(null)
    setSelectedCode(null) // 期間切替時は診断パネルを閉じる
    try {
      const [sum, sales, diag] = await Promise.all([
        api.rpp.summary(params),
        api.rpp.sales({ ...params, limit: 100 }),
        api.rpp.diagnosis(params),
      ])
      setSummary(sum)
      setSalesItems(sales?.items ?? [])
      setSalesTotal(sales?.total ?? 0)
      setDiagnosis(diag)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'データ取得に失敗しました')
      setSummary(null)
      setSalesItems([])
      setSalesTotal(0)
      setDiagnosis(null)
    } finally {
      setLoading(false)
    }
  }, [periodType, selectedWeekly, selectedMonthly])

  useEffect(() => { loadData() }, [loadData])

  const s = summary?.summary

  /* 診断結果を management_no で引けるようにする */
  const diagByCode = new Map<string, RppDiagnosisItem>(
    (diagnosis?.items ?? []).map((i) => [i.management_no, i]),
  )
  const selectedDiag = selectedCode ? diagByCode.get(selectedCode) : undefined

  /* Recharts用データ（広告費上位10件） */
  const chartData = salesItems
    .filter((i) => (i.ad_cost ?? 0) > 0)
    .sort((a, b) => (b.ad_cost ?? 0) - (a.ad_cost ?? 0))
    .slice(0, 10)
    .map((i) => ({
      name: i.product_name
        ? (i.product_name.length > 12 ? i.product_name.slice(0, 12) + '…' : i.product_name)
        : (i.item_code ?? '—'),
      adCost: i.ad_cost ?? 0,
      gross720: i.gross_720 ?? 0,
    }))

  const hasPeriodData =
    (periodType === 'weekly' && periods.weekly.length > 0) ||
    (periodType === 'monthly' && periods.monthly.length > 0)

  return (
    <div className="flex flex-col h-full">
      <Header
        title="RPP広告実績"
        subtitle="インポート済みのRPP広告データを週次・月次で確認"
        actions={
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            更新
          </button>
        }
      />

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-auto p-6 bg-gray-50 space-y-5">

        {/* タブ + 期間セレクタ */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-white border border-gray-200 rounded-lg p-0.5">
            {(['weekly', 'monthly'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setPeriodType(t)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  periodType === t
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {t === 'weekly' ? '週次' : '月次'}
              </button>
            ))}
          </div>

          {periodType === 'weekly' ? (
            <PeriodSelect<RppWeeklyPeriod>
              options={periods.weekly}
              value={selectedWeekly ? `${selectedWeekly.year_month}-${selectedWeekly.date_from}` : ''}
              onChange={(_, item) => { if (item) setSelectedWeekly(item) }}
              renderValue={(o) => `${o.year_month}-${o.date_from}`}
              renderLabel={(o) => `${o.date_from} 〜 ${o.date_to}`}
            />
          ) : (
            <PeriodSelect<RppMonthlyPeriod>
              options={periods.monthly}
              value={selectedMonthly?.year_month ?? ''}
              onChange={(_, item) => { if (item) setSelectedMonthly(item) }}
              renderValue={(o) => o.year_month}
              renderLabel={(o) => o.year_month}
            />
          )}

          {summary && (
            <span className="text-xs text-gray-400 ml-auto">
              {summary.count.toLocaleString()}件のデータ
            </span>
          )}
        </div>

        {/* エラー表示 */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* データなし（periods未登録） */}
        {!loading && !hasPeriodData && (
          <div className="bg-white rounded-xl border shadow-sm p-12 text-center">
            <BarChart2 size={40} className="mx-auto mb-4 text-gray-200" />
            <p className="text-sm font-medium text-gray-500">RPPデータがありません</p>
            <p className="text-xs text-gray-400 mt-1">
              データ取込みページからRPP広告レポートをインポートしてください
            </p>
          </div>
        )}

        {/* KPIカード・グラフ・テーブル */}
        {hasPeriodData && (
          <>
            {/* KPIカード 4枚 */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white rounded-xl border shadow-sm p-4">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">広告費</p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {s?.total_ad_cost != null ? formatCurrency(s.total_ad_cost) : 'データなし'}
                </p>
                {s?.avg_cpc != null && (
                  <p className="text-xs text-gray-400 mt-1">平均CPC: {formatCurrency(s.avg_cpc)}</p>
                )}
              </div>
              <MiniKpiCard
                label="ROAS"
                value720={s?.roas_720 != null ? `${s.roas_720.toFixed(1)}%` : 'データなし'}
                value12={s?.roas_12 != null ? `${s.roas_12.toFixed(1)}%` : '—'}
              />
              <MiniKpiCard
                label="CPO"
                value720={s?.cpo_720 != null ? formatCurrency(s.cpo_720) : 'データなし'}
                value12={s?.cpo_12 != null ? formatCurrency(s.cpo_12) : '—'}
              />
              <MiniKpiCard
                label="CVR"
                value720={s?.cvr_720 != null ? formatPercent(s.cvr_720, 2) : 'データなし'}
                value12={s?.cvr_12 != null ? formatPercent(s.cvr_12, 2) : '—'}
              />
            </div>

            {/* 売上カード */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border shadow-sm p-4">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  売上（720h基準）
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {s?.total_gross_720 != null ? formatCurrency(s.total_gross_720) : 'データなし'}
                </p>
              </div>
              <div className="bg-white rounded-xl border shadow-sm p-4">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  売上（12h基準）
                </p>
                <p className="text-2xl font-bold text-gray-900 mt-2">
                  {s?.total_gross_12 != null ? formatCurrency(s.total_gross_12) : 'データなし'}
                </p>
              </div>
            </div>

            {/* 棒グラフ（広告費上位10件） */}
            {chartData.length > 0 && (
              <div className="bg-white rounded-xl border shadow-sm p-5">
                <p className="text-sm font-bold text-gray-900 mb-4">広告費上位商品（最大10件）</p>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart
                    data={chartData}
                    margin={{ top: 5, right: 10, left: 10, bottom: 60 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10 }}
                      angle={-35}
                      textAnchor="end"
                      interval={0}
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v: number) => `￥${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      formatter={(value: number, name: string) => [formatCurrency(value), name]}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Bar dataKey="adCost" name="広告費" radius={[4, 4, 0, 0]}>
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={`hsl(${210 + i * 8}, 75%, ${52 + i * 2}%)`} />
                      ))}
                    </Bar>
                    <Bar
                      dataKey="gross720"
                      name="売上(720h)"
                      fill="#10b981"
                      radius={[4, 4, 0, 0]}
                      opacity={0.75}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* 商品別テーブル */}
            <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-bold text-gray-900">商品別実績</p>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">行クリックで診断を表示</span>
                  {salesTotal > salesItems.length && (
                    <span className="text-xs text-gray-400">
                      {salesItems.length}件表示 / 全{salesTotal}件
                    </span>
                  )}
                </div>
              </div>

              {salesItems.length === 0 && !loading && (
                <div className="px-5 py-10 text-center text-sm text-gray-400">データなし</div>
              )}

              {salesItems.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-left">
                        <th className="px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">
                          商品名
                        </th>
                        <th className="px-4 py-2.5 text-gray-500 font-medium whitespace-nowrap">
                          診断
                        </th>
                        <th className="px-4 py-2.5 text-gray-500 font-medium text-right whitespace-nowrap">
                          広告費
                        </th>
                        <th className="px-4 py-2.5 text-gray-500 font-medium text-right whitespace-nowrap">
                          売上(720h)
                        </th>
                        <th className="px-4 py-2.5 text-gray-500 font-medium text-right whitespace-nowrap">
                          ROAS(720h)
                        </th>
                        <th className="px-4 py-2.5 text-gray-500 font-medium text-right whitespace-nowrap">
                          CPO(720h)
                        </th>
                        <th className="px-4 py-2.5 text-gray-500 font-medium text-right whitespace-nowrap">
                          CVR(720h)
                        </th>
                        <th className="px-4 py-2.5 text-gray-500 font-medium text-right whitespace-nowrap">
                          CV(720h)
                        </th>
                        <th className="px-4 py-2.5 text-gray-500 font-medium text-right whitespace-nowrap">
                          売上(12h)
                        </th>
                        <th className="px-4 py-2.5 text-gray-500 font-medium text-right whitespace-nowrap">
                          ROAS(12h)
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {salesItems.map((item) => {
                        const diag = item.item_code ? diagByCode.get(item.item_code) : undefined
                        const isSelected = item.item_code != null && item.item_code === selectedCode
                        return (
                        <tr
                          key={item.id}
                          onClick={() => { if (item.item_code && diag) setSelectedCode(item.item_code) }}
                          className={`transition-colors ${
                            isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                          } ${item.item_code && diag ? 'cursor-pointer' : ''}`}
                        >
                          <td className="px-4 py-2.5 max-w-[180px]">
                            <p className="font-medium text-gray-800 truncate">
                              {item.product_name || item.item_code || '—'}
                            </p>
                            {item.item_code && item.product_name && (
                              <p className="text-gray-400 truncate">{item.item_code}</p>
                            )}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <DiagnosisBadges diag={diag} />
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium text-gray-900 whitespace-nowrap">
                            {item.ad_cost != null ? formatCurrency(item.ad_cost) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">
                            {item.gross_720 != null ? formatCurrency(item.gross_720) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            {item.roas_720 != null ? (
                              <span
                                className={
                                  item.roas_720 >= 300
                                    ? 'text-green-600 font-medium'
                                    : item.roas_720 < 100
                                    ? 'text-red-500'
                                    : 'text-gray-700'
                                }
                              >
                                {item.roas_720.toFixed(1)}%
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">
                            {item.cpo_720 != null ? formatCurrency(item.cpo_720) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">
                            {item.cvr_720 != null ? formatPercent(item.cvr_720, 2) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">
                            {item.cv_720 != null ? item.cv_720.toLocaleString() : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right text-gray-600 whitespace-nowrap">
                            {item.gross_12 != null ? formatCurrency(item.gross_12) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            {item.roas_12 != null ? (
                              <span
                                className={
                                  item.roas_12 >= 300
                                    ? 'text-green-600'
                                    : item.roas_12 < 100
                                    ? 'text-red-500'
                                    : 'text-gray-600'
                                }
                              >
                                {item.roas_12.toFixed(1)}%
                              </span>
                            ) : '—'}
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {loading && (
                <div className="px-5 py-8 text-center text-sm text-gray-400">
                  <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-gray-300" />
                  読み込み中...
                </div>
              )}
            </div>
          </>
        )}
        </div>

        {/* 診断パネル（行クリックで表示。ActionPanelとトンマナを揃える） */}
        {selectedDiag && diagnosis && (
          <RppDiagnosisPanel
            item={selectedDiag}
            diagnosis={diagnosis}
            onClose={() => setSelectedCode(null)}
          />
        )}
      </div>
    </div>
  )
}
