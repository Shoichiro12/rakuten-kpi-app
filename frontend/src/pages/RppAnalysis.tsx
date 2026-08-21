import { useState, useEffect, useCallback } from 'react'
import { BarChart2, RefreshCw, ChevronDown } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import Header from '../components/layout/Header'
import RppDiagnosisPanel from '../components/rpp/RppDiagnosisPanel'
import { useTableSort } from '../components/table/useTableSort'
import SortableTh from '../components/table/SortableTh'
import { GRID, SERIES } from '../components/chart/defaults'
import { formatYenAxis } from '../lib/format'
import { api } from '../lib/api'
import { formatCurrency, formatPercent } from '../lib/utils'
import { FOCUS_RING, TAP_TARGET } from '../lib/a11y'
import type {
  RppPeriods, RppWeeklyPeriod, RppMonthlyPeriod,
  RppSummaryResponse, RppSalesItem, RppDiagnosisResponse, RppDiagnosisItem,
} from '../types'

type PeriodType = 'weekly' | 'monthly'

/**
 * 表のセル用。**単位はセルに書かない**（見出しに1回だけ置く。規約 1-2）。
 * 表は丸めない＝生値のまま。
 */
const rppNum = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString('ja-JP')
const rppPct = (v: number | null | undefined, digits = 1) =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits)

/* ─── 計測基準（アトリビューション期間）───────────────────────
   720h/12h を全カード・全列で併記すると同じ数値系が3回繰り返される、という
   レビュー指摘（2026-08-20）を受けて、基準は画面で1つ選ぶ方式にした。
   既定は720h（集計・KPI計算の正は720hのまま不変。CLAUDE.mdのCSV仕様参照）。
   もう一方は各カードの比較値として小さく残す＝情報は消さない。 */
export type RppBasis = '720' | '12'
const BASIS_LABEL: Record<RppBasis, string> = { '720': '720h', '12': '12h' }

/* ─── KPIミニカード（選択基準を主・もう一方を比較で併記） ────── */
function MiniKpiCard({
  label,
  primary,
  secondary,
  basis,
}: {
  label: string
  primary: string
  secondary: string
  basis: RppBasis
}) {
  const other: RppBasis = basis === '720' ? '12' : '720'
  return (
    <div className="bg-white rounded-xl border shadow-sm p-4 space-y-2">
      <p className="text-xs font-medium text-muted">{label}</p>
      <div className="flex items-end gap-3">
        <div>
          <p className="text-2xl font-bold text-ink-strong">{primary}</p>
          <p className="text-xs text-muted mt-0.5">{BASIS_LABEL[basis]}</p>
        </div>
        <div className="pb-1">
          <p className="text-base font-semibold text-muted">{secondary}</p>
          <p className="text-xs text-muted">{BASIS_LABEL[other]}</p>
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
    return <span className="text-xs text-muted px-2 py-1">データなし</span>
  }
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => {
          const item = options.find((o) => renderValue(o) === e.target.value)
          onChange(e.target.value, item)
        }}
        className="appearance-none pl-3 pr-8 py-1.5 text-sm border border-line rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sage-deep cursor-pointer"
      >
        {options.map((o) => (
          <option key={renderValue(o)} value={renderValue(o)}>
            {renderLabel(o)}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted"
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
    return <span className="text-line">—</span>
  }
  if (diag.status === 'gated') {
    // ゲート判定（在庫・ページ品質）に該当 → 診断分類の対象外。バッジで理由を示す
    const short = diag.gate?.gate === 'stock' ? '在庫なし' : 'ページ未完成'
    return (
      <span
        className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700"
        title={diag.gate?.label}
      >
        {short}
      </span>
    )
  }
  if (diag.status === 'insufficient_data') {
    return (
      <span
        className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-bg-alt text-muted"
        title={diag.phase?.phase === 'new' ? '新商品フェーズのため基準50クリックで判定' : undefined}
      >
        データ不足{diag.phase?.phase === 'new' ? '（新商品）' : ''}
      </span>
    )
  }
  // 診断分類バッジ（8分類・第2段階）。良好型は従来の「良好」表示を使う
  const cls = diag.classification
  const TONE_BADGE: Record<string, string> = {
    danger: 'bg-red-100 text-red-700',
    warning: 'bg-amber-100 text-amber-700',
    info: 'bg-sky-100 text-sky-700',
    success: 'bg-green-100 text-green-700',
  }
  const clsBadge = cls && cls.type !== 'good' ? (
    <span
      className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${TONE_BADGE[cls.tone] ?? 'bg-bg-alt text-sub'}`}
      title={cls.summary}
    >
      {cls.label}
    </span>
  ) : null

  if (diag.status === 'good') {
    return clsBadge ?? (
      <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
        良好
      </span>
    )
  }
  const shown = diag.issues.slice(0, 2)
  const rest = diag.issues.length - shown.length
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {clsBadge}
      {shown.map((i) => (
        <span
          key={i.issue}
          className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium whitespace-nowrap ${
            i.confidence === 'confirmed'
              ? 'bg-red-100 text-red-700'
              : 'bg-amber-100 text-amber-700'
          }`}
          title={`${i.label}（${i.confidence === 'confirmed' ? '確定' : '要確認'}）`}
        >
          {ISSUE_SHORT[i.issue] ?? i.issue}
        </span>
      ))}
      {rest > 0 && <span className="text-xs text-muted">+{rest}</span>}
    </span>
  )
}

/* ─── メインページ ────────────────────────────────────────── */
export default function RppAnalysis() {
  const [periodType, setPeriodType] = useState<PeriodType>('weekly')
  // 表示基準（アトリビューション期間）。既定=720h。切替はフロント表示のみで集計は変えない
  const [basis, setBasis] = useState<RppBasis>('720')
  const [periods, setPeriods] = useState<RppPeriods>({ weekly: [], monthly: [] })
  const [selectedWeekly, setSelectedWeekly] = useState<RppWeeklyPeriod | null>(null)
  const [selectedMonthly, setSelectedMonthly] = useState<RppMonthlyPeriod | null>(null)

  const [summary, setSummary] = useState<RppSummaryResponse | null>(null)
  const [salesItems, setSalesItems] = useState<RppSalesItem[]>([])
  const sort = useTableSort<RppSalesItem>()
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

  /* 選択基準で商品行の値を引くヘルパー（表・グラフ共通） */
  const pick = useCallback((item: RppSalesItem, field: 'gross' | 'cv' | 'roas' | 'cpo' | 'cvr') =>
    basis === '720' ? item[`${field}_720`] : item[`${field}_12`], [basis])

  /* サマリの主値・比較値を選択基準で振り分ける（カード用） */
  const pair = (v720: number | null | undefined, v12: number | null | undefined) =>
    basis === '720' ? { main: v720, sub: v12 } : { main: v12, sub: v720 }
  const roasV = pair(s?.roas_720, s?.roas_12)
  const cpoV = pair(s?.cpo_720, s?.cpo_12)
  const cvrV = pair(s?.cvr_720, s?.cvr_12)
  const grossV = pair(s?.total_gross_720, s?.total_gross_12)

  /* Recharts用データ（広告費上位10件）。売上は選択基準に追従する */
  const chartData = salesItems
    .filter((i) => (i.ad_cost ?? 0) > 0)
    .sort((a, b) => (b.ad_cost ?? 0) - (a.ad_cost ?? 0))
    .slice(0, 10)
    .map((i) => ({
      name: i.product_name
        ? (i.product_name.length > 12 ? i.product_name.slice(0, 12) + '…' : i.product_name)
        : (i.item_code ?? '—'),
      adCost: i.ad_cost ?? 0,
      gross: pick(i, 'gross') ?? 0,
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
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-line rounded-lg hover:bg-bg-alt disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            更新
          </button>
        }
      />

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-auto p-6 bg-bg-alt space-y-5">

        {/* タブ + 期間セレクタ */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-white border border-line rounded-lg p-0.5">
            {(['weekly', 'monthly'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setPeriodType(t)}
                className={`px-4 text-sm font-medium rounded-md transition-colors ${TAP_TARGET} ${FOCUS_RING} ${
                  periodType === t
                    ? 'bg-sage-deep text-white shadow-sm'
                    : 'text-sub hover:text-ink-strong'
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

          {/* 表示基準の切替。720h/12hの併記を全カード・全列で繰り返さないための単一の切替点 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">表示基準</span>
            <div className="flex bg-white border border-line rounded-lg p-0.5">
              {(['720', '12'] as const).map((b) => (
                <button
                  key={b}
                  onClick={() => setBasis(b)}
                  aria-pressed={basis === b}
                  className={`px-3 text-sm font-medium rounded-md transition-colors ${TAP_TARGET} ${FOCUS_RING} ${
                    basis === b
                      ? 'bg-ink-strong text-white shadow-sm'
                      : 'text-sub hover:text-ink-strong'
                  }`}
                >
                  {BASIS_LABEL[b]}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted hidden lg:inline">
              クリック後{basis === '720' ? '720時間（30日）' : '12時間'}以内の売上で集計
            </span>
          </div>

          {summary && (
            <span className="text-xs text-muted ml-auto">
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
            <BarChart2 size={40} className="mx-auto mb-4 text-line" />
            <p className="text-sm font-medium text-muted">RPPデータがありません</p>
            <p className="text-xs text-muted mt-1">
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
                <p className="text-xs font-medium text-muted">広告費</p>
                <p className="text-2xl font-bold text-ink-strong mt-2">
                  {s?.total_ad_cost != null ? formatCurrency(s.total_ad_cost) : 'データなし'}
                </p>
                {s?.avg_cpc != null && (
                  <p className="text-xs text-muted mt-1">平均CPC: {formatCurrency(s.avg_cpc)}</p>
                )}
              </div>
              <MiniKpiCard
                basis={basis}
                label="ROAS"
                primary={roasV.main != null ? `${roasV.main.toFixed(1)}%` : 'データなし'}
                secondary={roasV.sub != null ? `${roasV.sub.toFixed(1)}%` : '—'}
              />
              <MiniKpiCard
                basis={basis}
                label="CPO"
                primary={cpoV.main != null ? formatCurrency(cpoV.main) : 'データなし'}
                secondary={cpoV.sub != null ? formatCurrency(cpoV.sub) : '—'}
              />
              <MiniKpiCard
                basis={basis}
                label="CVR"
                primary={cvrV.main != null ? formatPercent(cvrV.main, 2) : 'データなし'}
                secondary={cvrV.sub != null ? formatPercent(cvrV.sub, 2) : '—'}
              />
            </div>

            {/* 売上カード（選択基準を主・もう一方は比較行に退避。同格2枚には戻さない） */}
            <div className="bg-white rounded-xl border shadow-sm p-4 max-w-md">
              <p className="text-xs font-medium text-muted">
                売上（{BASIS_LABEL[basis]}基準）
              </p>
              <p className="text-2xl font-bold text-ink-strong mt-2">
                {grossV.main != null ? formatCurrency(grossV.main) : 'データなし'}
              </p>
              <p className="text-xs text-muted mt-1">
                {BASIS_LABEL[basis === '720' ? '12' : '720']}基準: {grossV.sub != null ? formatCurrency(grossV.sub) : '—'}
              </p>
            </div>

            {/* 棒グラフ（広告費上位10件） */}
            {chartData.length > 0 && (
              <div className="bg-white rounded-xl border shadow-sm p-5">
                <p className="text-sm font-bold text-ink-strong mb-4">広告費上位商品（最大10件）</p>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart
                    data={chartData}
                    margin={{ top: 5, right: 10, left: 10, bottom: 60 }}
                  >
                    {/* 破線は「しきい値」「予測」に読まれるので実線の極薄にする（規約 3-5） */}
                    <CartesianGrid {...GRID} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10 }}
                      angle={-35}
                      textAnchor="end"
                      interval={0}
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      tickFormatter={(v: number) => formatYenAxis(v)}
                    />
                    <Tooltip
                      formatter={(value: number, name: string) => [formatCurrency(value), name]}
                      contentStyle={{ fontSize: 12 }}
                    />
                    {/* 1系列＝1色。棒ごとに色相をずらすと「長さ」と「色」で同じ情報を二重に
                        エンコードすることになり、色という自由なチャンネルを無駄に使う（規約 3-1） */}
                    <Bar dataKey="adCost" name="広告費" fill={SERIES[0]} radius={[3, 3, 0, 0]} />
                    <Bar
                      dataKey="gross"
                      name={`売上(${BASIS_LABEL[basis]})`}
                      fill={SERIES[2]}
                      radius={[4, 4, 0, 0]}
                      opacity={0.75}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* 商品別テーブル */}
            <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-bg-alt flex items-center justify-between">
                <p className="text-sm font-bold text-ink-strong">商品別実績</p>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted">行クリックで診断を表示</span>
                  {salesTotal > salesItems.length && (
                    <span className="text-xs text-muted">
                      {salesItems.length}件表示 / 全{salesTotal}件
                    </span>
                  )}
                </div>
              </div>

              {salesItems.length === 0 && !loading && (
                <div className="px-5 py-10 text-center text-sm text-muted">データなし</div>
              )}

              {salesItems.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      {/* 列は選択基準のみ表示する（720h/12hの二重列には戻さない。
                          もう一方の基準は上の切替で見る）。診断列は商品名の直後＝判断に使う列を
                          識別列の直後に置く規約（4章） */}
                      <tr className="bg-bg-alt text-left text-muted font-medium">
                        <SortableTh label="商品名" sortKey="product_name" sort={sort} align="left" className="px-1" />
                        <th className="px-4 py-2.5 whitespace-nowrap">診断</th>
                        <SortableTh label="広告費（円）" sortKey="ad_cost" sort={sort} className="px-1" />
                        <SortableTh label={`売上 ${BASIS_LABEL[basis]}（円）`} sortKey={`gross_${basis}`} sort={sort} className="px-1" />
                        <SortableTh label={`ROAS ${BASIS_LABEL[basis]}（%）`} sortKey={`roas_${basis}`} sort={sort} className="px-1" />
                        <SortableTh label={`CPO ${BASIS_LABEL[basis]}（円）`} sortKey={`cpo_${basis}`} sort={sort} className="px-1" />
                        <SortableTh label={`CVR ${BASIS_LABEL[basis]}（%）`} sortKey={`cvr_${basis}`} sort={sort} className="px-1" />
                        <SortableTh label={`CV ${BASIS_LABEL[basis]}（件）`} sortKey={`cv_${basis}`} sort={sort} className="px-1" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-bg-alt">
                      {sort.apply(salesItems).map((item) => {
                        const diag = item.item_code ? diagByCode.get(item.item_code) : undefined
                        const isSelected = item.item_code != null && item.item_code === selectedCode
                        return (
                        <tr
                          key={item.id}
                          onClick={() => { if (item.item_code && diag) setSelectedCode(item.item_code) }}
                          className={`transition-colors ${
                            isSelected ? 'bg-sage-soft' : 'hover:bg-bg-alt'
                          } ${item.item_code && diag ? 'cursor-pointer' : ''}`}
                        >
                          <td className="px-4 py-2.5 max-w-[180px]">
                            <p className="font-medium text-ink truncate">
                              {item.product_name || item.item_code || '—'}
                            </p>
                            {item.item_code && item.product_name && (
                              <p className="text-muted truncate">{item.item_code}</p>
                            )}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {item.item_code && diag ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setSelectedCode(item.item_code!)
                                }}
                                aria-expanded={isSelected}
                                className={`rounded ${FOCUS_RING}`}
                              >
                                <DiagnosisBadges diag={diag} />
                              </button>
                            ) : (
                              <DiagnosisBadges diag={diag} />
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium text-ink-strong whitespace-nowrap tabular-nums">
                            {rppNum(item.ad_cost)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-sub whitespace-nowrap tabular-nums">
                            {rppNum(pick(item, 'gross'))}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                            {pick(item, 'roas') != null ? (
                              <span
                                className={
                                  // 色を付けるのはしきい値を割った行だけ。300%以上を緑にすると
                                  // 全行が色付きになり、何も目立たなくなる（規約 4）
                                  (pick(item, 'roas') ?? 0) < 100 ? 'text-danger' : 'text-sub'
                                }
                              >
                                {pick(item, 'roas')!.toFixed(1)}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right text-sub whitespace-nowrap tabular-nums">
                            {rppNum(pick(item, 'cpo'))}
                          </td>
                          <td className="px-4 py-2.5 text-right text-sub whitespace-nowrap tabular-nums">
                            {rppPct(pick(item, 'cvr'), 2)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-sub whitespace-nowrap tabular-nums">
                            {rppNum(pick(item, 'cv'))}
                          </td>
                        </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {loading && (
                <div className="px-5 py-8 text-center text-sm text-muted">
                  <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-line" />
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
