import { useEffect, useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import Header from '../components/layout/Header'
import KPICard from '../components/dashboard/KPICard'
import AlertPanel from '../components/dashboard/AlertPanel'
import KPIChart, { MultiLineChart } from '../components/dashboard/KPIChart'
import PeriodSelector from '../components/PeriodSelector'
import EmptyState from '../components/EmptyState'
import { api } from '../lib/api'
import { formatCurrency, formatPercent, formatNumber } from '../lib/utils'
import { usePeriodState } from '../lib/usePeriodState'
import type { DashboardData, Alert, TrendPoint } from '../types'

export default function Dashboard() {
  const { period, dateValue, setPeriod, setDateValue } = usePeriodState()
  const [data, setData] = useState<DashboardData | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [activeChart, setActiveChart] = useState<'gross' | 'gp' | 'roi' | 'cvr' | 'roas'>('gross')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const dateParam = period === 'monthly' ? dateValue.slice(0, 7) : dateValue
      const [dash, als, tr] = await Promise.all([
        api.dashboard.get(period, dateParam) as Promise<DashboardData | null>,
        api.dashboard.alerts(period, dateParam) as Promise<{ alerts?: Alert[] } | null>,
        api.dashboard.trend(8) as Promise<{ trend?: TrendPoint[] } | null>,
      ])
      setData(dash ?? null)
      setAlerts(als?.alerts ?? [])
      setTrend(tr?.trend ?? [])
    } catch (e) {
      console.error('[Dashboard] データ取得エラー:', e)
      setData(null)
      setAlerts([])
      setTrend([])
    } finally {
      setLoading(false)
    }
  }, [period, dateValue])

  useEffect(() => {
    load()
  }, [load])

  const kpis = data?.kpis
  const changes = data?.changes ?? {}

  const chartConfigs = {
    gross: { metric: 'gross' as const, label: 'RPP売上', color: '#2563eb', formatter: (v: number) => `¥${v.toLocaleString()}` },
    gp: { metric: 'gp' as const, label: '売上総利益', color: '#16a34a', formatter: (v: number) => `¥${v.toLocaleString()}` },
    roi: { metric: 'roi' as const, label: 'ROI(%)', color: '#9333ea', formatter: (v: number) => `${v.toFixed(1)}%` },
    cvr: { metric: 'cvr' as const, label: 'CVR(%)', color: '#ea580c', formatter: (v: number) => `${v.toFixed(2)}%` },
    roas: { metric: 'roas' as const, label: 'ROAS(%)', color: '#0891b2', formatter: (v: number) => `${v.toFixed(1)}%` },
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title="ダッシュボード"
        subtitle={data?.period_label}
        actions={
          <div className="flex items-center gap-3">
            <PeriodSelector
              period={period}
              onPeriodChange={setPeriod}
              dateValue={dateValue}
              onDateChange={setDateValue}
            />
            <button
              onClick={load}
              disabled={loading}
              className="p-2 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-40"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto bg-gray-50">
        {/* データなし */}
        {!loading && !kpis && (
          <EmptyState onDataGenerated={load} />
        )}

        {kpis && <div className="p-6 space-y-6">
        {/* KGI達成率 */}
        {kpis && data?.target_sales && data.target_sales > 0 && (
          <div className="bg-white rounded-xl border p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-600">KGI 売上目標達成率</p>
              <span className="text-lg font-bold text-gray-900">
                {data.achievement_rate?.toFixed(1)}%
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all ${
                  (data.achievement_rate ?? 0) >= 100
                    ? 'bg-green-500'
                    : (data.achievement_rate ?? 0) >= 70
                    ? 'bg-blue-500'
                    : 'bg-amber-500'
                }`}
                style={{ width: `${Math.min(data.achievement_rate ?? 0, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>実績: {formatCurrency(kpis.gross)}</span>
              <span>目標: {formatCurrency(data.target_sales)}</span>
            </div>
          </div>
        )}

        {/* アラート */}
        {alerts.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">改善重要アラート</h3>
            <AlertPanel alerts={alerts} />
          </div>
        )}

        {/* メインKPIカード */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">サマリKPI</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KPICard
              label="Rev（営業利益）"
              value={formatCurrency(kpis?.rev)}
              change={changes.rev_wow}
              changeLabel="前期比"
              variant={kpis && kpis.rev < 0 ? 'danger' : 'default'}
              helpMetric="Rev"
            />
            <KPICard
              label="ROI（投資利益率）"
              value={formatPercent(kpis?.roi)}
              change={changes.roi_wow}
              changeLabel="前期比"
              alert={kpis != null && kpis.roi < 100}
              variant={kpis && kpis.roi < 100 ? 'danger' : 'default'}
              helpMetric="ROI"
            />
            <KPICard
              label="CPO（注文獲得単価）"
              value={formatCurrency(kpis?.cpo)}
              change={changes.cpo_wow ? -changes.cpo_wow : null}
              changeLabel="前期比"
              helpMetric="CPO"
            />
            <KPICard
              label="Limit CPO（限界CPO）"
              value={formatCurrency(kpis?.limit_cpo)}
              helpMetric="Limit CPO"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard
            label="RPP売上（Gross）"
            value={formatCurrency(kpis?.gross)}
            change={changes.gross_wow}
            changeLabel="前期比"
            variant="primary"
            helpMetric="Gross"
          />
          <KPICard
            label="売上総利益（GP）"
            value={formatCurrency(kpis?.gp)}
            change={changes.gp_wow}
            changeLabel="前期比"
            helpMetric="GP"
          />
          <KPICard
            label="GP率（GPR）"
            value={formatPercent(kpis?.gpr)}
            helpMetric="GPR"
          />
          <KPICard
            label="客単価（Av）"
            value={formatCurrency(kpis?.av)}
            helpMetric="Av"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard
            label="ROAS（売上回収率）"
            value={formatPercent(kpis?.roas)}
            change={changes.roas_wow}
            changeLabel="前期比"
            helpMetric="ROAS"
          />
          <KPICard
            label="CVR（注文率）"
            value={formatPercent(kpis?.cvr, 2)}
            change={changes.cvr_wow}
            changeLabel="前期比"
            alert={kpis != null && changes.cvr_wow != null && changes.cvr_wow < -5}
            helpMetric="CVR"
          />
          <KPICard
            label="CTR（クリック率）"
            value={formatPercent(kpis?.ctr, 2)}
            alert={kpis != null && kpis.ctr < 1}
            helpMetric="CTR"
          />
          <KPICard
            label="CPC（クリック単価）"
            value={formatCurrency(kpis?.cpc)}
            change={changes.cpc_wow ? -changes.cpc_wow : null}
            changeLabel="前期比"
            alert={kpis != null && changes.cpc_wow != null && changes.cpc_wow > 5}
            helpMetric="CPC"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard
            label="広告費（AdCost）"
            value={formatCurrency(kpis?.ad_cost)}
            change={changes.ad_cost_wow}
            changeLabel="前期比"
          />
          <KPICard label="注文件数（CV）" value={formatNumber(kpis?.cv)} change={changes.cv_wow} changeLabel="前期比" />
          <KPICard label="クリック数（CT）" value={formatNumber(kpis?.ct)} />
          <KPICard label="店舗運営経費" value={formatCurrency(kpis?.steady_cost)} />
        </div>

        {/* トレンドチャート */}
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">週次トレンド（8週間）</h3>
            <div className="flex gap-1">
              {(Object.keys(chartConfigs) as Array<keyof typeof chartConfigs>).map((key) => (
                <button
                  key={key}
                  onClick={() => setActiveChart(key)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    activeChart === key
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {chartConfigs[key].label}
                </button>
              ))}
            </div>
          </div>
          <KPIChart
            data={trend}
            metric={chartConfigs[activeChart].metric}
            label={chartConfigs[activeChart].label}
            color={chartConfigs[activeChart].color}
            formatter={chartConfigs[activeChart].formatter}
          />
        </div>

        {/* Rev vs AdCost 比較チャート */}
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">売上・利益・広告費 推移</h3>
          <MultiLineChart
            data={trend}
            metrics={[
              { key: 'gross', label: 'RPP売上', color: '#2563eb' },
              { key: 'gp', label: '売上総利益', color: '#16a34a' },
              { key: 'ad_cost', label: '広告費', color: '#dc2626' },
            ]}
            formatter={(v) => `¥${v.toLocaleString()}`}
          />
        </div>
        </div>} {/* kpis && ... */}
      </div>
    </div>
  )
}
