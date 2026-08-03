import { useEffect, useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import Header from '../components/layout/Header'
import KPICard from '../components/dashboard/KPICard'
import AlertPanel from '../components/dashboard/AlertPanel'
import KPIChart, { MultiLineChart } from '../components/dashboard/KPIChart'
import PeriodSelector from '../components/PeriodSelector'
import EmptyState from '../components/EmptyState'
import EvaluationMatrix from '../components/EvaluationMatrix'
import AccessPlanner from '../components/dashboard/AccessPlanner'
import RevenuePlanPanel from '../components/dashboard/RevenuePlanPanel'
import TodayActions from '../components/dashboard/TodayActions'
import ActionOutcomes from '../components/dashboard/ActionOutcomes'
import { api } from '../lib/api'
import { formatCurrency, formatPercent, formatNumber } from '../lib/utils'
import { formatYen, formatYenAxis, pointDiffFromChangeRate } from '../lib/format'
import BulletChart from '../components/kpi/BulletChart'
import { usePeriodState } from '../lib/usePeriodState'
import type {
  DashboardData, Alert, TrendPoint, EvaluationResult, AccessPlan, RecommendationsResponse, OutcomesResponse,
} from '../types'

export default function Dashboard() {
  const { period, dateValue, setPeriod, setDateValue, jumpToLatest } = usePeriodState()
  const [data, setData] = useState<DashboardData | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null)
  const [accessPlan, setAccessPlan] = useState<AccessPlan | null>(null)
  const [recos, setRecos] = useState<RecommendationsResponse | null>(null)
  const [outcomes, setOutcomes] = useState<OutcomesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeChart, setActiveChart] = useState<'gross' | 'gp' | 'roi' | 'cvr' | 'roas' | 'ct' | 'cpc'>('gross')
  // 売上3分解（1層ヒーロー用）。月次・年次はgap/shop（商品分析=店舗全体軸）から取得し、
  // 週次はdashboard本体のRPP軸KPI・前期比をそのまま使う（軸を混ぜない）。
  const [decomp, setDecomp] = useState<{ current: Record<string, number | null>; changes: Record<string, number | null> } | null>(null)

  const isYearly = period === 'yearly'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const dateParam =
        period === 'monthly' ? dateValue.slice(0, 7)
        : period === 'yearly' ? dateValue.slice(0, 4)
        : dateValue
      // 年次は表示系のみ対応。診断・アラート・提案系は月次前提の設計のため呼ばない
      // （UIバックログ2026-08-03 区切りB。画面には注記を出す）。
      const yearly = period === 'yearly'
      const [dash, als, tr, evalRes, planRes, recoRes, outcomeRes, shopGap] = await Promise.all([
        api.dashboard.get(period, dateParam) as Promise<DashboardData | null>,
        yearly ? Promise.resolve(null) : api.dashboard.alerts(period, dateParam) as Promise<{ alerts?: Alert[] } | null>,
        api.dashboard.trend(8) as Promise<{ trend?: TrendPoint[] } | null>,
        yearly ? Promise.resolve(null) : api.evaluation.matrix(period, dateParam).catch(() => null),
        yearly ? Promise.resolve(null) : api.evaluation.accessPlan(period, dateParam).catch(() => null),
        yearly ? Promise.resolve(null) : api.recommendations.get(period, dateParam).catch(() => null) as Promise<RecommendationsResponse | null>,
        api.recommendations.outcomes().catch(() => null) as Promise<OutcomesResponse | null>,
        // 3分解の前期比（月次・年次のみ。週次はdashboard本体のRPP軸changesを使う）
        period === 'weekly'
          ? Promise.resolve(null)
          : api.gap.shop(period, dateParam, true).catch(() => null) as Promise<{ current?: Record<string, number | null>; changes?: Record<string, number | null> } | null>,
      ])
      setData(dash ?? null)
      setDecomp(
        shopGap && (shopGap as { current?: Record<string, number | null> }).current
          ? {
              current: (shopGap as { current: Record<string, number | null> }).current,
              changes: (shopGap as { changes?: Record<string, number | null> }).changes ?? {},
            }
          : null,
      )
      setAlerts((als as { alerts?: Alert[] } | null)?.alerts ?? [])
      setTrend(tr?.trend ?? [])
      setEvaluation((evalRes as { evaluation?: EvaluationResult } | null)?.evaluation ?? null)
      setAccessPlan((planRes as { plan?: AccessPlan } | null)?.plan ?? null)
      setRecos((recoRes as RecommendationsResponse | null) ?? null)
      setOutcomes(outcomeRes ?? null)
    } catch (e) {
      console.error('[Dashboard] データ取得エラー:', e)
      setData(null)
      setAlerts([])
      setTrend([])
      setEvaluation(null)
      setAccessPlan(null)
      setRecos(null)
      setOutcomes(null)
      setDecomp(null)
    } finally {
      setLoading(false)
    }
  }, [period, dateValue])

  useEffect(() => {
    load()
  }, [load])

  const kpis = data?.kpis
  const shop = data?.shop
  // RPP広告データが無い月でも、商品分析レポート（店舗全体）の実績があれば表示する。
  // 以前は kpis（RPP由来）の有無だけで画面全体を出し分けていたため、商品分析だけ
  // 取り込んである月が「データがありません」になっていた。
  const hasAnyData = Boolean(kpis || shop)
  const changes = data?.changes ?? {}

  // 実績（軸は混ぜない。商品分析があればそちら、無ければRPP経由）
  const actualSales = shop ? shop.sales : kpis?.gross ?? null

  // ── 着地見込み（1層ヒーロー用）───────────────────────────────
  // 対象期間が「現在進行中」のときだけ、実績 ÷ 経過割合 で単純予測する。
  // 過去期間は実績＝確定なので出さない。経過1割未満は振れが大きすぎるため出さない。
  const forecast = (() => {
    const actual = shop ? shop.sales : kpis?.gross
    if (actual == null) return null
    const today = new Date()
    let ratio: number | null = null
    if (period === 'weekly') {
      const start = new Date(dateValue)
      start.setDate(start.getDate() - (start.getDay() % 7))
      const diff = Math.floor((today.getTime() - start.getTime()) / 86400000)
      if (diff >= 0 && diff < 7) ratio = (diff + 1) / 7
    } else if (period === 'monthly') {
      if (dateValue.slice(0, 7) === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`) {
        const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
        ratio = today.getDate() / daysInMonth
      }
    } else {
      if (dateValue.slice(0, 4) === String(today.getFullYear())) {
        const startOfYear = new Date(today.getFullYear(), 0, 1)
        const dayOfYear = Math.floor((today.getTime() - startOfYear.getTime()) / 86400000) + 1
        const daysInYear = (today.getFullYear() % 4 === 0 && today.getFullYear() % 100 !== 0) || today.getFullYear() % 400 === 0 ? 366 : 365
        ratio = dayOfYear / daysInYear
      }
    }
    if (ratio == null || ratio < 0.1) return null
    return Math.round(actual / ratio)
  })()

  // ── 売上3分解（1層ヒーロー用）。軸を混ぜない ─────────────────
  // 週次: dashboard本体（RPP軸: ct/cvr/av + changes）
  // 月次・年次: gap/shop（商品分析=店舗全体軸: access/cvr/av + changes）
  // ペーサー（あるべき進捗）= 目標 × 経過割合。
  // 経過割合は forecast（= 実績 ÷ 経過割合）から逆算できるので、新しいデータは要らない。
  // ⚠️ これは線形按分。ECは日次が一様ではない（スーパーSALE等）ので、
  //    季節指数で重み付けする改良は別チケット（規約 3-4 に記載）。
  const pacer = (() => {
    const target = data?.target_sales
    if (target == null || target <= 0) return null
    if (forecast == null || forecast <= 0 || actualSales == null) return null
    const elapsed = actualSales / forecast
    if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed >= 1) return null
    return target * elapsed
  })()

  const decompCards = (() => {
    if (period === 'weekly') {
      if (!kpis) return null
      return [
        // CVRは割合なので前期比は pt（変化率から復元する）。アクセスは中立なので色を付けない
        { label: 'アクセス（RPPクリック）', value: formatNumber(kpis.ct), change: changes.ct_wow ?? null, unit: '%' as const, neutral: true },
        { label: '転換率（CVR）', value: formatPercent(kpis.cvr, 2), change: pointDiffFromChangeRate(kpis.cvr, changes.cvr_wow), unit: 'pt' as const, neutral: false },
        { label: '客単価（Av）', value: formatYen(kpis.av), change: changes.av_wow ?? null, unit: '%' as const, neutral: false },
      ]
    }
    if (!decomp) return null
    const c = decomp.current
    const ch = decomp.changes
    return [
      { label: 'アクセス人数（UU）', value: formatNumber(c.access ?? c.ct), change: ch.access ?? null, unit: '%' as const, neutral: true },
      { label: '転換率（CVR）', value: formatPercent(c.cvr, 2), change: pointDiffFromChangeRate(c.cvr, ch.cvr), unit: 'pt' as const, neutral: false },
      { label: '客単価（Av）', value: formatYen(c.av), change: ch.av ?? null, unit: '%' as const, neutral: false },
    ]
  })()

  const chartConfigs = {
    gross: { metric: 'gross' as const, label: 'RPP売上', color: '#2563eb', formatter: (v: number) => `¥${v.toLocaleString()}` },
    gp: { metric: 'gp' as const, label: '売上総利益', color: '#16a34a', formatter: (v: number) => `¥${v.toLocaleString()}` },
    roi: { metric: 'roi' as const, label: 'ROI(%)', color: '#9333ea', formatter: (v: number) => `${v.toFixed(1)}%` },
    cvr: { metric: 'cvr' as const, label: 'CVR(%)', color: '#ea580c', formatter: (v: number) => `${v.toFixed(2)}%` },
    roas: { metric: 'roas' as const, label: 'ROAS(%)', color: '#0891b2', formatter: (v: number) => `${v.toFixed(1)}%` },
    ct: { metric: 'ct' as const, label: 'アクセス（RPPクリック）', color: '#0d9488', formatter: (v: number) => v.toLocaleString() },
    cpc: { metric: 'cpc' as const, label: 'CPC(円)', color: '#dc2626', formatter: (v: number) => `¥${v.toLocaleString()}` },
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
              onJumpToLatest={jumpToLatest}
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
        {/* データなし（RPP・商品分析ともに無い期間のみ） */}
        {!loading && !hasAnyData && (
          <EmptyState onDataGenerated={load} />
        )}

        {hasAnyData && <div className="p-6 space-y-6">
        {/* 年次は表示系のみ（診断・アラート・提案は月次前提のため注記を出して非表示） */}
        {isYearly && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
            <p className="text-sm text-blue-900">
              年次表示は実績の集計ビューです（暦年・1〜12月）。改善アラート・評価マトリクス・今日やることなどの診断は月次で行うため、この画面では表示していません。
            </p>
          </div>
        )}

        {/* ═══ 1層: KGIヒーロー（売上 vs 目標・達成率・着地見込み ＋ 売上3分解）═══
            「売上目標に対して今どうか」をファーストビューで完結させる（区切りC・案A）。 */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* KGIブロック */}
          <div className="lg:col-span-2 bg-white rounded-xl border shadow-sm p-4 flex flex-col">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-gray-600">売上{data?.target_sales ? ' vs 目標' : ''}</p>
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                shop ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
              }`}>
                {shop ? '商品分析（店舗全体）' : 'RPP経由売上'}
              </span>
            </div>
            {/* 金額はカード上では万・億で丸める（規約: docs/ui_number_and_chart_rules_2026-08-04.md 1-1）。
                表・ツールチップ・CSVは丸めない */}
            <p className="text-[40px] leading-[1.05] font-bold text-gray-900 mt-1.5 tracking-tight">
              {formatYen(shop ? shop.sales : kpis?.gross)}
            </p>
            {data?.target_sales != null && data.target_sales > 0 ? (
              <>
                {/* 進捗バーではなく弾丸グラフ（規約 3-3）。進捗バーは上限100%で目標超過を表現できない。
                    ペーサー = 目標 × 経過割合。経過割合は forecast（実績÷経過割合）から逆算できる */}
                <div className="mt-3">
                  <BulletChart
                    value={actualSales ?? 0}
                    target={data.target_sales}
                    pace={pacer}
                    projection={forecast}
                    lowerIsBetter={false}
                    formatTick={(v) => formatYenAxis(v)}
                    valueLabel={formatYen(actualSales)}
                    projectionLabel={forecast != null ? `着地見込 ${formatYen(forecast)}` : undefined}
                    ariaLabel={`売上の弾丸グラフ。実績 ${formatYen(actualSales)}、目標 ${formatYen(data.target_sales)}`}
                    height={86}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-gray-500 mt-1">
                  <span>
                    {pacer != null && actualSales != null && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${
                          actualSales >= pacer
                            ? 'border-[#bfe3bf] bg-[#f2faf2] text-[#0a7a0a]'
                            : 'border-[#f0cfcf] bg-[#fdf4f4] text-[#b2312f]'
                        }`}
                      >
                        {actualSales >= pacer ? '● 順調' : '● 遅れ'}
                      </span>
                    )}
                  </span>
                  <span className="font-bold text-gray-900 text-sm tabular-nums">
                    達成率 {data.achievement_rate?.toFixed(1)}%
                  </span>
                </div>
              </>
            ) : (
              <p className="text-xs text-gray-400 mt-3">目標未設定（目標設定画面で売上目標を入力すると達成率が出ます）</p>
            )}
            <div className="flex items-center justify-between text-xs mt-auto pt-2 border-t border-gray-100">
              <span className="text-gray-500">
                {forecast != null ? 'このペースの着地見込み' : shop && kpis ? 'RPP経由' : ''}
              </span>
              <span className="font-medium text-gray-700 tabular-nums">
                {forecast != null
                  ? `${formatCurrency(forecast)}${data?.target_sales ? `（目標比 ${Math.round(forecast / data.target_sales * 100)}%）` : ''}`
                  : shop && kpis ? formatCurrency(kpis.gross) : '—'}
              </span>
            </div>
          </div>

          {/* 売上3分解: 売上 = アクセス × CVR × 客単価 */}
          {decompCards?.map((c) => (
            <div key={c.label} className="bg-white rounded-xl border shadow-sm p-4 flex flex-col justify-between">
              <p className="text-xs font-medium text-gray-500">{c.label}</p>
              <div>
                <p className="text-2xl font-bold text-gray-900 tabular-nums">{c.value}</p>
                {/* 割合の指標は pt、中立の指標（アクセス）は色を付けない（規約 1-4 / 1-7） */}
                <p className={`text-xs mt-1 ${
                  c.change == null || c.neutral ? 'text-gray-500'
                    : c.change >= 0 ? 'text-green-600' : 'text-red-500'
                }`}>
                  {c.change == null
                    ? '前期のデータなし'
                    : `${c.change >= 0 ? '+' : ''}${c.change.toFixed(c.unit === 'pt' ? 2 : 1)}${c.unit} 前期比`}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* ═══ 2層: アクション帯（今日やること・アラート・評価マトリクス）═══ */}
        {!isYearly && <TodayActions data={recos} onChanged={load} />}

        {alerts.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">改善重要アラート</h3>
            <AlertPanel alerts={alerts} />
          </div>
        )}

        {/* 評価マトリクス（17パターン・目標×YoY統一判定） */}
        {evaluation && (
          <EvaluationMatrix evaluation={evaluation} />
        )}

        {/* 実施した施策のその後（Phase 2 の学習ループ） */}
        {!isYearly && <ActionOutcomes data={outcomes} />}

        {/* RPP広告データが無い期間：商品分析（店舗全体）の実績だけで表示する。
            以前はここで「データがありません」になり、店舗全体の実績まで隠れていた。 */}
        {!kpis && shop && (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm font-medium text-amber-900">
                この期間はRPP広告データが未取込のため、広告系KPI（ROI・ROAS・CPC・CTR など）は表示できません。
              </p>
              <p className="text-xs text-amber-700 mt-1">
                下記は商品分析レポート（店舗全体）の実績です。広告KPIも見るには「データ取込み」からRPPデータを取り込んでください。
              </p>
            </div>

          </>
        )}

        {kpis && (<>
        {/* ═══ 3層(a): 利益・広告投資（RPP軸の最重要4指標。ヒーローより一段弱く）═══ */}
        <div>
          <h3 className="text-sm font-semibold text-gray-600 mb-3">利益・広告投資（RPP軸）</h3>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <KPICard
              label="Rev（営業利益）"
              value={formatYen(kpis?.rev)}
              change={changes.rev_wow}
              yoy={changes.rev_yoy}
              changeLabel="前期比"
              variant={kpis && kpis.rev < 0 ? 'danger' : 'success'}
              helpMetric="Rev"
            />
            <KPICard
              label="ROI（投資利益率）"
              value={formatPercent(kpis?.roi)}
              // ROIは割合なので前期比は pt（変化率から復元）
              change={pointDiffFromChangeRate(kpis?.roi, changes.roi_wow)}
              yoy={pointDiffFromChangeRate(kpis?.roi, changes.roi_yoy)}
              changeUnit="pt"
              changeLabel="前期比"
              alert={kpis != null && kpis.roi < 100}
              variant={kpis && kpis.roi < 100 ? 'danger' : 'default'}
              helpMetric="ROI"
            />
            <KPICard
              label="RPP売上（Gross）"
              value={formatYen(kpis?.gross)}
              change={changes.gross_wow}
              yoy={changes.gross_yoy}
              changeLabel="前期比"
              variant="primary"
              helpMetric="Gross"
            />
            <KPICard
              label="売上総利益（GP）"
              value={formatYen(kpis?.gp)}
              change={changes.gp_wow}
              yoy={changes.gp_yoy}
              changeLabel="前期比"
              helpMetric="GP"
            />
          </div>
        </div>

        {/* ═══ 3層(b): 詳細指標（効率・参考をコンパクトな表1ブロックに圧縮。既定で畳む）═══ */}
        <details className="bg-white rounded-xl border shadow-sm group">
          <summary className="px-4 py-3 text-sm font-semibold text-gray-600 cursor-pointer select-none list-none flex items-center justify-between hover:bg-gray-50 rounded-xl group-open:rounded-b-none">
            <span>詳細指標（効率・参考: ROAS / CVR / CPO / CTR / CPC など12指標）</span>
            <span className="text-xs text-gray-400 group-open:hidden">クリックで展開</span>
            <span className="text-xs text-gray-400 hidden group-open:inline">閉じる</span>
          </summary>
          <div className="overflow-x-auto border-t">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-4 py-2 text-left">指標</th>
                  <th className="px-3 py-2 text-right">実績</th>
                  <th className="px-3 py-2 text-right">前期比</th>
                  <th className="px-3 py-2 text-right">YoY</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {([
                  // goodWhenDown: 下がる方が良い指標（CPO/CPC）は変化の色を反転する
                  // 割合の指標（ROAS/CVR/CTR/GPR）の前期比は pt。変化率から復元する（規約 1-4）
                  { label: 'ROAS（売上回収率）', value: formatPercent(kpis.roas), wow: pointDiffFromChangeRate(kpis.roas, changes.roas_wow), yoy: pointDiffFromChangeRate(kpis.roas, changes.roas_yoy), unit: 'pt', goodWhenDown: false, warn: false },
                  { label: 'CVR（注文率）', value: formatPercent(kpis.cvr, 2), wow: pointDiffFromChangeRate(kpis.cvr, changes.cvr_wow), yoy: pointDiffFromChangeRate(kpis.cvr, changes.cvr_yoy), unit: 'pt', goodWhenDown: false, warn: changes.cvr_wow != null && changes.cvr_wow < -5 },
                  { label: 'CPO（注文獲得単価）', value: formatCurrency(kpis.cpo), wow: changes.cpo_wow, yoy: changes.cpo_yoy, goodWhenDown: true, warn: kpis.limit_cpo != null && kpis.limit_cpo > 0 && kpis.cpo > kpis.limit_cpo },
                  { label: 'Limit CPO（限界CPO）', value: formatCurrency(kpis.limit_cpo), wow: null, yoy: null, goodWhenDown: false, warn: false },
                  { label: 'CTR（クリック率）', value: formatPercent(kpis.ctr, 2), wow: pointDiffFromChangeRate(kpis.ctr, changes.ctr_wow), yoy: pointDiffFromChangeRate(kpis.ctr, changes.ctr_yoy), unit: 'pt', goodWhenDown: false, warn: kpis.ctr < 1 },
                  { label: 'CPC（クリック単価）', value: formatCurrency(kpis.cpc), wow: changes.cpc_wow, yoy: changes.cpc_yoy, goodWhenDown: true, warn: changes.cpc_wow != null && changes.cpc_wow > 5 },
                  { label: '客単価（Av）', value: formatCurrency(kpis.av), wow: changes.av_wow, yoy: changes.av_yoy, goodWhenDown: false, warn: false },
                  { label: 'GP率（GPR）', value: formatPercent(kpis.gpr), wow: null, yoy: null, goodWhenDown: false, warn: false },
                  // 広告費は「下がったら良い」指標。goodWhenDown:false だと上昇が緑になっていた（2026-08-04 修正）
                  { label: '広告費（AdCost）', value: formatCurrency(kpis.ad_cost), wow: changes.ad_cost_wow, yoy: changes.ad_cost_yoy, goodWhenDown: true, warn: false },
                  { label: '注文件数（CV）', value: formatNumber(kpis.cv), wow: changes.cv_wow, yoy: changes.cv_yoy, goodWhenDown: false, warn: false },
                  { label: 'クリック数（CT）', value: formatNumber(kpis.ct), wow: changes.ct_wow, yoy: changes.ct_yoy, goodWhenDown: false, warn: false },
                  { label: '店舗運営経費', value: formatCurrency(kpis.steady_cost), wow: null, yoy: null, goodWhenDown: false, warn: false },
                ]).map((row) => {
                  const unit = 'unit' in row && row.unit === 'pt' ? 'pt' : '%'
                  const cell = (v: number | null | undefined) => {
                    if (v == null) return <span className="text-gray-300">—</span>
                    const improved = row.goodWhenDown ? v < 0 : v > 0
                    return (
                      <span className={improved ? 'text-green-600' : 'text-red-500'}>
                        {v > 0 ? '+' : ''}{v.toFixed(unit === 'pt' ? 2 : 1)}{unit}
                      </span>
                    )
                  }
                  return (
                    <tr key={row.label} className={row.warn ? 'bg-red-50/60' : undefined}>
                      <td className="px-4 py-2 text-gray-700">
                        {row.label}
                        {row.warn && <span className="ml-1.5 text-[10px] text-red-600 font-medium">⚠️ 要確認</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900 tabular-nums">{row.value}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{cell(row.wow)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{cell(row.yoy)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>
        </>)}

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

        {/* ═══ 3層(c): 計画系パネル（売上予算プラン・アクセス逆算）═══
            月次予算の按分パネルのため年次表示では出さない（年間予算そのものはKGIに反映済み） */}
        {!isYearly && <RevenuePlanPanel yearMonth={dateValue.slice(0, 7)} />}
        {accessPlan && <AccessPlanner plan={accessPlan} />}
        </div>} {/* kpis && ... */}
      </div>
    </div>
  )
}
