import { useEffect, useState, useCallback } from 'react'
import { AlertTriangle } from 'lucide-react'
import Header from '../components/layout/Header'
import PeriodSelector from '../components/PeriodSelector'
import LogicTree from '../components/gap/LogicTree'
import StepIndicator from '../components/gap/StepIndicator'
import GenreCards from '../components/gap/GenreCards'
import ActionSummary from '../components/gap/ActionSummary'
import ActionPanel from '../components/gap/ActionPanel'
import AccessAxisBadge from '../components/gap/AccessAxisBadge'
import { orderBySalesGap, SALES_ORDER_NOTE } from '../components/gap/kpiGap'
import EvaluationMatrix from '../components/EvaluationMatrix'
import ReliabilityNote from '../components/ReliabilityNote'
import { useTableSort } from '../components/table/useTableSort'
import SortableTh from '../components/table/SortableTh'
import { api } from '../lib/api'
import { formatCurrency, formatPercent, formatNumber } from '../lib/utils'
import { usePeriodState } from '../lib/usePeriodState'
import type { KPIs, GenreKPI, KPITree, EvaluationResult, AccessAxis } from '../types'
import { ACCESS_AXIS_LABEL } from '../types'

interface ShopData { current: KPIs; prev: KPIs | null; changes: Record<string, number | null> }
interface ProductItem {
  product_url: string; management_no: string; product_name: string; genre: string
  current: KPIs; prev: KPIs | null; changes: Record<string, number | null>; limit_cpo_exceeded: boolean
  access_axis?: AccessAxis; reliable?: boolean
}

function ChangeCell({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-gray-400">—</span>
  const up = value > 0
  return <span className={`font-medium ${up ? 'text-green-600' : 'text-red-500'}`}>{up ? '+' : ''}{value.toFixed(1)}%</span>
}

/* 表の作法（docs/ui_number_and_chart_rules_2026-08-04.md 4章／区切り4の残り）。
   この画面の2つの表（商品別・ジャンル別参照）で同じ定数を使う。

   固定ヘッダーは「表のラッパー自身が縦スクロールすること」が前提。
   ラッパーが overflow-x-auto だけだと縦の計算値も auto になるが高さ無制限で
   縦スクロールが起きないため、sticky top-0 を書いてもヘッダーは固定されず、
   ページ側のスクロールで枠ごと画面外に出る。max-h と必ずセットで使う。 */
const TABLE_SCROLL = 'max-h-[70vh] overflow-auto'
/* ヘッダーは浮くのでセルごとに背景と下境界線を持たせる（thead への背景指定だけでは
   スクロールした本文が透ける）。 */
const TH_STICKY = 'sticky top-0 z-20 bg-gray-50 border-b border-gray-200 whitespace-nowrap'
/* 左端の識別列は横スクロールでも残す（規約: 1列目は人間が読める識別子）。
   縦横が交差するヘッダーだけ z を1段上げる。
   min-w が無いと、狭い幅のときに商品名と「母数不足・参考値」バッジが1文字ずつ折り返して
   行の高さが数百pxに膨らむ（固定した識別列が読めないと左端固定の意味がない）。 */
const STICKY_LEFT_MIN_W = 'min-w-[11rem]'
const TH_STICKY_LEFT = `sticky top-0 left-0 z-30 bg-gray-50 border-b border-r border-gray-200 whitespace-nowrap ${STICKY_LEFT_MIN_W}`
const TD_STICKY_LEFT = `sticky left-0 z-10 border-r border-gray-100 ${STICKY_LEFT_MIN_W}`

/* 行の背景は「警告 > 選択 > 通常」の1本で決める。
   左端セルは sticky で浮くため行と同じ背景を明示的に持たせないと、横スクロールした
   右の列が下から透けて見える。bg-inherit は Tailwind の出力順に依存して崩れるので使わない。
   tr 自身は :hover、浮いているセルは group-hover で追随させる（group-hover は子孫
   セレクタなので、group を付けた tr 自身には効かない）。 */
const ROW_BG = {
  warn: 'bg-red-50 hover:bg-red-100',
  selected: 'bg-blue-50 hover:bg-blue-100',
  normal: 'bg-white hover:bg-gray-50',
} as const
const ROW_BG_STICKY = {
  warn: 'bg-red-50 group-hover:bg-red-100',
  selected: 'bg-blue-50 group-hover:bg-blue-100',
  normal: 'bg-white group-hover:bg-gray-50',
} as const

// 商品別テーブルのソート用アクセサ（ネストした current/changes の値を読む）
const PRODUCT_SORT_ACCESSORS = {
  product_name: (p: ProductItem) => p.product_name,
  gross: (p: ProductItem) => p.current.gross,
  gross_change: (p: ProductItem) => p.changes.gross,
  gp: (p: ProductItem) => p.current.gp,
  ct: (p: ProductItem) => p.current.ct,
  cv: (p: ProductItem) => p.current.cv,
  cvr: (p: ProductItem) => p.current.cvr,
  av: (p: ProductItem) => p.current.av,
  roas: (p: ProductItem) => p.current.roas,
  cpo: (p: ProductItem) => p.current.cpo,
}

export default function GapAnalysis() {
  const { period, dateValue, setPeriod, setDateValue, jumpToLatest } = usePeriodState()
  const productSort = useTableSort<ProductItem>(PRODUCT_SORT_ACCESSORS)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [selectedKPI, setSelectedKPI] = useState<'access' | 'cvr' | 'av' | null>(null)
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<ProductItem | null>(null)

  const [treeData, setTreeData] = useState<KPITree | null>(null)
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null)
  // 評価マトリクスのアクセス軸（'shop'=商品分析UU／'rpp'=RPPクリック）。バッジ表示に使う。
  const [evalAxis, setEvalAxis] = useState<'shop' | 'rpp' | undefined>(undefined)
  const [shopData, setShopData] = useState<ShopData | null>(null)
  const [genreData, setGenreData] = useState<GenreKPI[]>([])
  // 集計軸（'shop'=商品分析／null=RPP）。月次と週次でCVRの母数が変わるため保持する。
  const [genreAxis, setGenreAxis] = useState<string | null>(null)
  const [productData, setProductData] = useState<ProductItem[]>([])
  // 商品テーブルのアクセス軸（要件No.5）。列見出しに軸を明示する。
  const [productAxis, setProductAxis] = useState<AccessAxis | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [excludeInactive, setExcludeInactive] = useState(false)  // 廃盤を集計から除外するか

  const dateParam =
    period === 'monthly' ? dateValue.slice(0, 7)
    : period === 'yearly' ? dateValue.slice(0, 4)
    : dateValue
  const includeInactive = !excludeInactive
  const isYearly = period === 'yearly'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // 年次は表示系のみ。評価マトリクス（診断）は月次前提のため呼ばず、注記を出す。
      const [tree, shop, genre, evalRes] = await Promise.all([
        api.gap.kpiTree(period, dateParam) as Promise<KPITree | null>,
        api.gap.shop(period, dateParam, includeInactive) as Promise<ShopData | null>,
        api.gap.genre(period, dateParam, includeInactive) as Promise<{ genres?: GenreKPI[]; axis?: string | null } | null>,
        isYearly ? Promise.resolve(null) : api.evaluation.matrix(period, dateParam, includeInactive).catch(() => null),
      ])
      setTreeData(tree ?? null)
      setShopData(shop ?? null)
      setGenreData(genre?.genres ?? [])
      setGenreAxis(genre?.axis ?? null)
      setEvaluation((evalRes as { evaluation?: EvaluationResult } | null)?.evaluation ?? null)
      setEvalAxis((evalRes as { axis?: 'rpp' | 'shop' } | null)?.axis)
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
  }, [period, dateParam, includeInactive, isYearly])

  const loadProducts = useCallback(async (genre?: string) => {
    try {
      const prod = await api.gap.product(period, dateParam, genre, includeInactive) as { products?: ProductItem[]; access_axis?: AccessAxis } | null
      setProductData(prod?.products ?? [])
      setProductAxis(prod?.access_axis)
    } catch (e) {
      console.error('[GapAnalysis] 商品データ取得エラー:', e)
      setProductData([])
      setProductAxis(undefined)
    }
  }, [period, dateParam, includeInactive])


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

  // 商品テーブルの既定順は「売上の前期比が悪い順」で固定（選択KPIでは切り替えない）。
  // 列見出しクリックのソート（useTableSort）は既定順の上に乗るので、
  // ユーザーが列を選べばそちらが勝つ。適用順は 既定順 → 列ソート。
  const orderedProducts = orderBySalesGap(productData)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="GAP分析"
        subtitle="KGI・KPIロジックツリーから課題を特定し改善アクションへ"
        actions={
          <>
            {/* 画面全体のアクセス軸。ブロックごとではなくここに1つだけ出す */}
            <AccessAxisBadge axis={treeData?.access_axis} />
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={excludeInactive}
                onChange={(e) => setExcludeInactive(e.target.checked)}
                className="rounded border-gray-300"
              />
              廃盤を除外
            </label>
            <PeriodSelector
              period={period}
              onPeriodChange={setPeriod}
              dateValue={dateValue}
              onDateChange={setDateValue}
              onJumpToLatest={jumpToLatest}
            />
          </>
        }
      />

      <div className="flex flex-1 overflow-hidden">
        {/* メインコンテンツ */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-gray-50 min-w-0">

          {/* STEP インジケーター */}
          <StepIndicator currentStep={step} onStepClick={handleStepClick} />

          {/* 年次は表示系のみ（診断は月次前提のため注記） */}
          {isYearly && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
              <p className="text-sm text-blue-900">
                年次表示は実績の集計ビューです（暦年・1〜12月）。評価マトリクス・改善アクションの診断は月次で行うため、この画面では表示していません。
              </p>
            </div>
          )}

          {/* 評価マトリクス（17パターン・目標×YoY統一判定） */}
          {evaluation && <EvaluationMatrix evaluation={evaluation} axis={evalAxis} />}

          {/* アクションサマリ（スコープ内の課題集中度・要件No.3）。診断系のため年次では出さない */}
          {!isYearly && (
            <ActionSummary
              scope={selectedGenre ? 'genre' : 'shop'}
              genre={selectedGenre ?? undefined}
              period={period}
              date={dateParam}
            />
          )}

          {/* ロジックツリー */}
          <div className="bg-white rounded-xl border shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-gray-900">ロジックツリー — KGI・KPI比較</h3>
                <p className="text-xs text-gray-500 mt-0.5">KPIノードをクリックするとジャンル別ドリルダウンに進みます</p>
              </div>
              {!treeData?.has_target && treeData?.target_comparable !== false && (
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

            {treeData?.target_comparable === false ? (
              // 週次は目標比較を出さない（2026-08-04 決定）。「未設定」と誤解されないよう理由を書く
              <p className="mt-3 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 max-w-3xl leading-relaxed">
                週次は目標との比較を出していません。目標は「アクセス目標（UU）＝月間ユニークユーザー数」として
                サイト全体・月単位で設定されているのに対し、週次の実績はRPP広告クリック基準で期間も母数も違うためです。
                週次はRPP広告の動きを前週比で追い、目標に対する達成率は月次で確認してください。
              </p>
            ) : !treeData?.has_target ? (
              <p className="mt-3 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                💡 「目標設定」画面でKGI/KPI目標を設定すると、達成率・GAP分析が有効になります
              </p>
            ) : null}
            {treeData && (
              <ReliabilityNote
                reliable={treeData.reliable}
                accessAxis={treeData.access_axis}
                className="mt-3"
              />
            )}
          </div>

          {/* 打ち手はこの画面では評価マトリクスのカード（上）と、商品を選んだときの
              右サイド ActionPanel の2箇所だけにする（2026-08-04 オーナー決定）。
              KPI選択に連動する打ち手ブロックを別に足すと、同じ画面に似たリストが3つ並ぶため。
              **ここに新しい打ち手の表示先を増やさないこと。** */}

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
                  <p className="text-xs text-gray-500">
                    {selectedGenre} — {productData.length}件
                    {!productSort.key && (
                      <span className="ml-1.5 text-gray-400">／ 並び順: {SALES_ORDER_NOTE}</span>
                    )}
                  </p>
                </div>
                <button
                  onClick={() => { setSelectedProduct(null); setStep(2) }}
                  className="text-xs text-blue-500 hover:text-blue-700"
                >
                  ← ジャンル一覧へ
                </button>
              </div>
              {/* 日本語見出しに uppercase は効かないので外した（計画書6章の残り2箇所のうち1つ）。
                  単位はセル側の formatCurrency / formatPercent が出しているため、見出しには足さない
                  （見出しへ寄せるならセルを lib/format.ts に移す別作業になる） */}
              <div className={TABLE_SCROLL}>
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500">
                    <tr>
                      <SortableTh label="商品名" sortKey="product_name" sort={productSort} align="left" className={`pl-1 ${TH_STICKY_LEFT}`} />
                      <SortableTh label="売上" sortKey="gross" sort={productSort} className={TH_STICKY} />
                      <SortableTh label="前期比" sortKey="gross_change" sort={productSort} className={TH_STICKY} />
                      <SortableTh label="GP" sortKey="gp" sort={productSort} className={TH_STICKY} />
                      <SortableTh
                        label={productAxis ? ACCESS_AXIS_LABEL[productAxis] : 'アクセス'}
                        sortKey="ct" sort={productSort} className={TH_STICKY}
                      />
                      <SortableTh label="CV" sortKey="cv" sort={productSort} className={TH_STICKY} />
                      <SortableTh label="CVR" sortKey="cvr" sort={productSort} className={TH_STICKY} />
                      {/* 客単価は売上3分解の1つ。選択KPIが客単価のとき並び替えの根拠が
                          画面に無いと読めないため、列として常設する */}
                      <SortableTh label="客単価" sortKey="av" sort={productSort} className={TH_STICKY} />
                      <SortableTh label="ROAS" sortKey="roas" sort={productSort} className={TH_STICKY} />
                      <SortableTh label="CPO" sortKey="cpo" sort={productSort} className={TH_STICKY} />
                      <th className={`px-3 py-2.5 text-center font-medium ${TH_STICKY}`}>アクション</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {productSort.apply(orderedProducts).map((p) => {
                      const isSelected = selectedProduct?.product_url === p.product_url
                      // 優先度: 在庫 > アクセス > 客単価 = CVR（講座ロジック準拠）
                      // shopData.current は「対象期間にショップ全体の実績が無い」場合 null になる。
                      // ガードせずに参照すると描画中に例外が出て画面全体が白くなるため、
                      // 必ずオプショナルチェーンで参照する（比較対象が無いときは警告を出さない）。
                      const shopCur = shopData?.current ?? null
                      const accessWarn = p.current.ct < 100 ||
                        (!!shopCur && shopCur.ctr > 0 && p.current.ctr < shopCur.ctr * 0.75)
                      const lowAccess = p.current.ct < 100
                      // アクセス母数不足(100未満)の場合、CVR・客単価の警告は表示しない（信用できない数値のため）
                      const cvrWarn = !lowAccess && !!shopCur && shopCur.cvr > 0 && p.current.cvr < shopCur.cvr * 0.85
                      const avWarn = !lowAccess && !!shopCur && shopCur.av > 0 && p.current.av < shopCur.av * 0.85
                      // 背景色は警告専用に空けておく規約のため、警告→選択→通常の1本で決める
                      const tone = p.limit_cpo_exceeded ? 'warn' : isSelected ? 'selected' : 'normal'
                      return (
                        <tr
                          key={p.product_url}
                          onClick={() => setSelectedProduct(isSelected ? null : p)}
                          className={`group cursor-pointer transition-colors ${ROW_BG[tone]}`}
                        >
                          <td className={`px-4 py-2.5 ${TD_STICKY_LEFT} ${ROW_BG_STICKY[tone]}`}>
                            <div className="flex items-center gap-1.5">
                              {p.limit_cpo_exceeded && <AlertTriangle size={12} className="text-red-500 shrink-0" />}
                              <div>
                                <p className="font-medium text-gray-900 text-xs leading-tight">{p.product_name}</p>
                                <div className="flex items-center gap-1.5">
                                  <p className="text-gray-400 text-xs">{p.management_no}</p>
                                  <ReliabilityNote reliable={p.reliable} accessAxis={p.access_axis} variant="badge" />
                                </div>
                              </div>
                            </div>
                          </td>
                          {/* 表は丸めない（生値）。数値は右寄せ＋等幅（tabular-nums）で桁位置を揃え、
                              横スクロールする表なので折り返させない。規約 1-2 / 4
                              色を付けるのは「しきい値を跨いだセル」だけ */}
                          <td className="px-3 py-2.5 text-right font-medium text-xs tabular-nums whitespace-nowrap">{formatCurrency(p.current.gross)}</td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums whitespace-nowrap"><ChangeCell value={p.changes.gross} /></td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums whitespace-nowrap">{formatCurrency(p.current.gp)}</td>
                          <td className={`px-3 py-2.5 text-right text-xs font-medium tabular-nums whitespace-nowrap ${accessWarn ? 'text-red-600' : ''}`}>
                            {formatNumber(p.current.ct)}
                            {accessWarn && ' ⚠️'}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums whitespace-nowrap">{formatNumber(p.current.cv)}</td>
                          <td className={`px-3 py-2.5 text-right text-xs font-medium tabular-nums whitespace-nowrap ${cvrWarn ? 'text-red-600' : ''}`}>
                            {formatPercent(p.current.cvr, 2)}
                            {cvrWarn && ' ⚠️'}
                          </td>
                          <td className={`px-3 py-2.5 text-right text-xs font-medium tabular-nums whitespace-nowrap ${avWarn ? 'text-red-600' : ''}`}>
                            {formatCurrency(p.current.av)}
                            {avWarn && ' ⚠️'}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs tabular-nums whitespace-nowrap">{formatPercent(p.current.roas)}</td>
                          <td className={`px-3 py-2.5 text-right text-xs tabular-nums whitespace-nowrap ${p.limit_cpo_exceeded ? 'text-red-600 font-bold' : ''}`}>
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
                {/* 商品別テーブルと同じ表の作法。ジャンル数は通常少ないので max-h は実際には
                    発動しないが、ジャンルの多い店舗で固定ヘッダーが効くよう揃えておく */}
                <div className={TABLE_SCROLL}>
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500">
                      <tr>
                        <th className={`px-4 py-2 text-left font-medium ${TH_STICKY_LEFT}`}>ジャンル</th>
                        <th className={`px-4 py-2 text-right font-medium ${TH_STICKY}`}>RPP売上</th>
                        <th className={`px-4 py-2 text-right font-medium ${TH_STICKY}`}>前期比</th>
                        <th className={`px-4 py-2 text-right font-medium ${TH_STICKY}`}>GP</th>
                        <th className={`px-4 py-2 text-right font-medium ${TH_STICKY}`}>CVR</th>
                        <th className={`px-4 py-2 text-right font-medium ${TH_STICKY}`}>客単価</th>
                        <th className={`px-4 py-2 text-right font-medium ${TH_STICKY}`}>ROAS</th>
                        <th className={`px-4 py-2 text-right font-medium ${TH_STICKY}`}>ROI</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {genreData.map((g) => (
                        // 参照用テーブルは選択・警告の状態を持たないので通常の背景1つで足りる
                        <tr key={g.genre} className={`group ${ROW_BG.normal}`}>
                          <td className={`px-4 py-2.5 font-medium text-gray-900 text-xs ${TD_STICKY_LEFT} ${ROW_BG_STICKY.normal}`}>{g.genre}</td>
                          <td className="px-4 py-2.5 text-right text-xs tabular-nums whitespace-nowrap">{formatCurrency(g.current.gross)}</td>
                          <td className="px-4 py-2.5 text-right text-xs tabular-nums whitespace-nowrap"><ChangeCell value={g.changes.gross} /></td>
                          <td className="px-4 py-2.5 text-right text-xs tabular-nums whitespace-nowrap">{formatCurrency(g.current.gp)}</td>
                          <td className="px-4 py-2.5 text-right text-xs tabular-nums whitespace-nowrap">{formatPercent(g.current.cvr, 2)}</td>
                          <td className="px-4 py-2.5 text-right text-xs tabular-nums whitespace-nowrap">{formatCurrency(g.current.av)}</td>
                          <td className="px-4 py-2.5 text-right text-xs tabular-nums whitespace-nowrap">{formatPercent(g.current.roas)}</td>
                          <td className="px-4 py-2.5 text-right text-xs tabular-nums whitespace-nowrap">{formatPercent(g.current.roi)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
          )}
        </div>

        {/* アクションパネル（右サイド）。4Pアクション提案=診断系のため年次では出さない */}
        {!isYearly && selectedProduct && shopData?.current && (
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
