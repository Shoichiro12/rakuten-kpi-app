import { useCallback, useEffect, useState } from 'react'
import { Save, CheckCircle, Check, RefreshCw } from 'lucide-react'
import Header from '../components/layout/Header'
import { api } from '../lib/api'
import { getCurrentYearMonth } from '../lib/utils'
import type { Target, ItemTargetListEntry, RevenuePlanResponse } from '../types'

const CONFIDENCE_LABELS: Record<string, { label: string; cls: string }> = {
  high: { label: '精度: 高（2年分以上の実績）', cls: 'bg-green-100 text-green-700' },
  medium: { label: '精度: 中（実績1周分）', cls: 'bg-blue-100 text-blue-700' },
  low: { label: '均等按分（実績12ヶ月未満）', cls: 'bg-amber-100 text-amber-700' },
}

function Field({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-4 items-start py-4 border-b border-gray-100 last:border-0">
      <div>
        <p className="text-sm font-medium text-gray-900">{label}</p>
        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
      </div>
      <div className="col-span-2">{children}</div>
    </div>
  )
}

export default function TargetSetting() {
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth())
  const [form, setForm] = useState<Omit<Target, 'year_month'>>({
    target_sales: 5_000_000,
    target_access: 50_000,
    target_cvr: 1.5,
    target_av: 7_000,
    expense_rate: 0.15,
  })
  const [targets, setTargets] = useState<Target[]>([])
  const [costRate, setCostRate] = useState(0.6)   // 店舗デフォルト原価率（/api/shops/me から取得）
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)

  // アイテム別目標（3-B''・第3段階）
  const [itemRows, setItemRows] = useState<ItemTargetListEntry[]>([])
  const [itemMsg, setItemMsg] = useState<string | null>(null)

  // 売上予算プラン（第4段階v2）: 年間売上予算・予算年度起点と按分プレビュー
  const [annualBudget, setAnnualBudget] = useState<number | ''>('')
  const [startMonth, setStartMonth] = useState(1)
  const [plan, setPlan] = useState<RevenuePlanResponse | null>(null)
  const [budgetSaved, setBudgetSaved] = useState(false)
  const [budgetSaving, setBudgetSaving] = useState(false)

  const loadPlan = useCallback(async (ym: string) => {
    try {
      const res = await api.revenuePlan.get(ym)
      setPlan(res ?? null)
    } catch (e) {
      console.error('[TargetSetting] 売上予算プラン取得エラー:', e)
      setPlan(null)
    }
  }, [])

  useEffect(() => { loadPlan(yearMonth) }, [yearMonth, loadPlan])

  // 月次売上予算の手動補正（追加指示書2章）: 月ごとにonBlur保存・nullで解除
  const saveOverride = async (ym: string, value: number | null) => {
    try {
      await api.revenuePlan.override(ym, value)
      await loadPlan(yearMonth)
    } catch (e) {
      console.error('[TargetSetting] 月次予算補正エラー:', e)
    }
  }

  const saveBudget = async () => {
    setBudgetSaving(true)
    try {
      await api.shops.update({
        annual_sales_budget: annualBudget === '' ? null : annualBudget,
        budget_year_start_month: startMonth,
      })
      await loadPlan(yearMonth)
      setBudgetSaved(true)
      setTimeout(() => setBudgetSaved(false), 2000)
    } catch (e) {
      console.error('[TargetSetting] 年間売上予算保存エラー:', e)
    } finally {
      setBudgetSaving(false)
    }
  }

  const loadItemTargets = useCallback(async (ym: string) => {
    try {
      const res = await api.itemTargets.list(ym)
      setItemRows(res.items)
    } catch (e) {
      console.error('[TargetSetting] アイテム別目標取得エラー:', e)
      setItemRows([])
    }
  }, [])

  const flashItem = (msg: string) => {
    setItemMsg(msg)
    setTimeout(() => setItemMsg(null), 2500)
  }

  const saveItemTarget = async (mno: string, value: number) => {
    if (!Number.isFinite(value) || value <= 0) return
    try {
      await api.itemTargets.upsert({ management_no: mno, year_month: yearMonth, target_sales: value })
      await loadItemTargets(yearMonth)
      flashItem(`${mno} の目標を保存し、目標CVR・客単価・必要アクセスを自動算出しました`)
    } catch (e) {
      console.error('[TargetSetting] アイテム別目標保存エラー:', e)
      flashItem('保存に失敗しました')
    }
  }

  const approveItemTarget = async (mno: string) => {
    try {
      await api.itemTargets.approve({ management_no: mno, year_month: yearMonth })
      await loadItemTargets(yearMonth)
      flashItem(`${mno} の参考値を確定しました（診断・逆算で使われます）`)
    } catch (e) {
      console.error('[TargetSetting] 参考値承認エラー:', e)
    }
  }

  const recalcItemTarget = async (mno: string) => {
    try {
      await api.itemTargets.recalc({ management_no: mno, year_month: yearMonth })
      await loadItemTargets(yearMonth)
      flashItem(`${mno} を最新の実績で再計算しました`)
    } catch (e) {
      console.error('[TargetSetting] 再計算エラー:', e)
    }
  }

  useEffect(() => { loadItemTargets(yearMonth) }, [yearMonth, loadItemTargets])

  useEffect(() => {
    api.targets.list()
      .then((data: unknown) => {
        const list = Array.isArray(data) ? (data as Target[]) : []
        setTargets(list)
      })
      .catch((e: unknown) => {
        console.error('[TargetSetting] 目標一覧取得エラー:', e)
        setTargets([])
      })
    // 原価率は店舗マスタのデフォルト値を使う（固定の60%仮定をやめる）
    api.shops.me()
      .then((shop) => {
        if (shop && typeof shop.default_cost_rate === 'number') setCostRate(shop.default_cost_rate)
        if (shop) {
          setAnnualBudget(shop.annual_sales_budget ?? '')
          setStartMonth(shop.budget_year_start_month ?? 1)
        }
      })
      .catch((e: unknown) => {
        console.error('[TargetSetting] 店舗設定取得エラー:', e)
      })
  }, [])

  const loadTarget = (ym: string) => {
    const existing = targets.find(t => t.year_month === ym)
    if (existing) {
      setForm({
        target_sales: existing.target_sales,
        target_access: existing.target_access,
        target_cvr: existing.target_cvr,
        target_av: existing.target_av,
        expense_rate: existing.expense_rate,
      })
    }
  }

  const handleYearMonthChange = (ym: string) => {
    setYearMonth(ym)
    loadTarget(ym)
  }

  const handleSave = async () => {
    setLoading(true)
    try {
      await api.targets.upsert({ year_month: yearMonth, ...form })
      const data = await api.targets.list()
      const list = Array.isArray(data) ? (data as Target[]) : []
      setTargets(list)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      console.error('[TargetSetting] 目標保存エラー:', e)
    } finally {
      setLoading(false)
    }
  }

  const set = (key: keyof typeof form, value: number) => {
    setForm(f => ({ ...f, [key]: value }))
  }

  const estimatedGP = form.target_sales * (1 - (form.expense_rate + costRate))
  const estimatedRev = estimatedGP - form.target_sales * form.expense_rate

  return (
    <div className="flex flex-col h-full">
      <Header
        title="目標設定"
        subtitle="KGI（売上目標）・KPI目標値・経費率の設定"
        actions={
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saved ? <CheckCircle size={15} /> : <Save size={15} />}
            {saved ? '保存しました' : '保存'}
          </button>
        }
      />

      <div className="flex-1 overflow-auto p-6 bg-gray-50">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* 対象月 */}
          <div className="bg-white rounded-xl border shadow-sm p-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">対象月</h3>
            <input
              type="month"
              value={yearMonth}
              onChange={e => handleYearMonthChange(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* KGI */}
          <div className="bg-white rounded-xl border shadow-sm p-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-1">KGI（最終目標）</h3>
            <p className="text-xs text-gray-500 mb-4">月次売上の目標値を設定します</p>
            <Field label="月次売上目標" description="RPP売上ベース">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">¥</span>
                <input
                  type="number"
                  value={form.target_sales}
                  onChange={e => set('target_sales', Number(e.target.value))}
                  step={100000}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </Field>
          </div>

          {/* 年間売上予算（売上予算プラン・第4段階v2） */}
          <div className="bg-white rounded-xl border shadow-sm p-6">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
              <h3 className="text-sm font-semibold text-gray-700">年間売上予算</h3>
              {budgetSaved && (
                <span className="flex items-center gap-1.5 text-xs text-green-600"><CheckCircle size={13} />保存しました</span>
              )}
            </div>
            <p className="text-xs text-gray-500 mb-4">
              過去実績の季節性で月次に自動按分します（按分値は保存せず、実績の蓄積で自動的に精度が上がります）
            </p>
            <Field label="年間売上予算" description="未入力に戻すと機能をオフにできます">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">¥</span>
                <input
                  type="number"
                  value={annualBudget}
                  min={0}
                  step={1000000}
                  placeholder="未設定"
                  onChange={e => setAnnualBudget(e.target.value === '' ? '' : Number(e.target.value))}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </Field>
            <Field label="予算年度の起点月" description="決算期に合わせられます（既定: 1月=暦年）">
              <select
                value={startMonth}
                onChange={e => setStartMonth(Number(e.target.value))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <option key={m} value={m}>{m}月</option>
                ))}
              </select>
            </Field>
            <div className="pt-4">
              <button
                onClick={saveBudget}
                disabled={budgetSaving}
                className="px-4 py-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
              >
                年間予算を保存して按分を更新
              </button>
            </div>

            {/* 按分プレビュー */}
            {plan && (
              <div className="mt-5 border-t pt-4">
                {plan.status === 'no_budget' || plan.status === 'collect_data' ? (
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <p className="text-sm font-medium text-gray-700">{plan.guide.title}</p>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">{plan.guide.message}</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <p className="text-xs font-semibold text-gray-600">
                        月次按分プレビュー（{plan.budget_year.from} 〜 {plan.budget_year.to}）
                      </p>
                      {plan.seasonal_index.confidence && CONFIDENCE_LABELS[plan.seasonal_index.confidence] && (
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${CONFIDENCE_LABELS[plan.seasonal_index.confidence].cls}`}>
                          {CONFIDENCE_LABELS[plan.seasonal_index.confidence].label}
                        </span>
                      )}
                      <span className="text-[10px] text-gray-400">
                        根拠: 有効実績{plan.seasonal_index.valid_months}ヶ月
                        {plan.seasonal_index.period_from && `（${plan.seasonal_index.period_from}〜${plan.seasonal_index.period_to}）`}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-400 mb-2 leading-snug">{plan.guide.message}</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 text-[10px] text-gray-500 uppercase">
                          <tr>
                            <th className="px-2 py-1.5 text-left">月</th>
                            <th className="px-2 py-1.5 text-right">季節指数</th>
                            <th className="px-2 py-1.5 text-right">月次売上予算（編集で手動補正）</th>
                            <th className="px-2 py-1.5 text-right">実績</th>
                            <th className="px-2 py-1.5 text-right">達成率</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {plan.months.map(m => (
                            <tr key={m.year_month} className={m.year_month === yearMonth ? 'bg-blue-50' : ''}>
                              <td className="px-2 py-1.5 font-medium text-gray-800">{m.year_month}</td>
                              <td className="px-2 py-1.5 text-right text-gray-600">{m.index != null ? m.index.toFixed(2) : '—'}</td>
                              <td className="px-2 py-1.5 text-right whitespace-nowrap">
                                <span className="inline-flex items-center gap-1 justify-end">
                                  {m.sales_budget_source === 'manual' && (
                                    <>
                                      <span className="inline-block px-1 py-0.5 rounded text-[9px] font-medium bg-violet-100 text-violet-700" title="手動補正中。空欄で保存すると自動按分に戻ります">手動</span>
                                      <button
                                        onClick={() => saveOverride(m.year_month, null)}
                                        className="text-[9px] text-gray-400 hover:text-red-500 underline"
                                        title="補正を解除して自動按分に戻す"
                                      >解除</button>
                                    </>
                                  )}
                                  <span className="text-gray-400 text-[10px]">¥</span>
                                  <input
                                    key={`${m.year_month}:${m.sales_budget ?? ''}:${m.sales_budget_source ?? ''}`}
                                    type="number" min={0} step={100000}
                                    defaultValue={m.sales_budget != null ? Math.round(m.sales_budget) : ''}
                                    placeholder="—"
                                    onBlur={(e) => {
                                      const raw = e.target.value
                                      if (raw === '') {
                                        // 空欄=解除（手動月のみ意味を持つ。自動月は何もしない）
                                        if (m.sales_budget_source === 'manual') saveOverride(m.year_month, null)
                                        return
                                      }
                                      const v = Number(raw)
                                      if (Number.isFinite(v) && v > 0 && v !== (m.sales_budget != null ? Math.round(m.sales_budget) : null)) {
                                        saveOverride(m.year_month, v)
                                      }
                                    }}
                                    className={`w-24 text-right border rounded px-1.5 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-500 ${
                                      m.sales_budget_source === 'manual' ? 'border-violet-300 bg-violet-50/50' : 'border-gray-200'
                                    }`}
                                  />
                                </span>
                              </td>
                              <td className="px-2 py-1.5 text-right text-gray-600">{m.actual_sales != null ? `¥${Math.round(m.actual_sales).toLocaleString()}` : '—'}</td>
                              <td className={`px-2 py-1.5 text-right font-medium ${m.achievement_rate == null ? 'text-gray-300' : m.achievement_rate >= 100 ? 'text-green-600' : 'text-red-500'}`}>
                                {m.achievement_rate != null ? `${m.achievement_rate}%` : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* 12ヶ月合計と年間予算の差分（手動補正は他月へ再配分しないため乖離しうる） */}
                    {plan.annual_sales_budget != null && (() => {
                      const total = plan.months.reduce((s, m) => s + (m.sales_budget ?? 0), 0)
                      const diff = total - plan.annual_sales_budget
                      return (
                        <p className={`mt-1.5 text-[10px] ${Math.abs(diff) >= 1 ? 'text-amber-600' : 'text-gray-400'}`}>
                          12ヶ月合計 ¥{Math.round(total).toLocaleString()}／年間予算 ¥{Math.round(plan.annual_sales_budget).toLocaleString()}
                          {Math.abs(diff) >= 1 && `（差 ${diff > 0 ? '+' : ''}¥${Math.round(diff).toLocaleString()}。手動補正した月は他月へ再配分しないため合計がズレることがあります）`}
                        </p>
                      )
                    })()}
                  </>
                )}
              </div>
            )}
          </div>

          {/* KPI */}
          <div className="bg-white rounded-xl border shadow-sm p-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-1">KPI目標値</h3>
            <p className="text-xs text-gray-500 mb-4">売上 = アクセス × CVR × 客単価</p>
            <Field label="アクセス目標（UU）" description="月間ユニークユーザー数">
              <input
                type="number"
                value={form.target_access}
                onChange={e => set('target_access', Number(e.target.value))}
                step={1000}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </Field>
            <Field label="CVR目標（%）" description="注文率">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={form.target_cvr}
                  onChange={e => set('target_cvr', Number(e.target.value))}
                  step={0.1}
                  min={0}
                  max={100}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
            </Field>
            <Field label="客単価目標（Av）" description="1注文あたり平均売上">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500">¥</span>
                <input
                  type="number"
                  value={form.target_av}
                  onChange={e => set('target_av', Number(e.target.value))}
                  step={100}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </Field>
          </div>

          {/* 経費率 */}
          <div className="bg-white rounded-xl border shadow-sm p-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-1">経費設定</h3>
            <p className="text-xs text-gray-500 mb-4">Steady Cost = RPP売上 × 経費率</p>
            <Field label="店舗運営経費率" description="楽天出店料・ポイント等">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={Math.round(form.expense_rate * 100)}
                  onChange={e => set('expense_rate', Number(e.target.value) / 100)}
                  step={1}
                  min={0}
                  max={100}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
            </Field>
          </div>

          {/* 試算 */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-blue-800 mb-3">目標値の試算（原価率{Math.round(costRate * 100)}%を適用）</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-blue-600 text-xs">売上目標</p>
                <p className="font-bold text-blue-900">¥{form.target_sales.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-blue-600 text-xs">推定GP（利益）</p>
                <p className="font-bold text-blue-900">¥{Math.round(estimatedGP).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-blue-600 text-xs">店舗運営経費</p>
                <p className="font-bold text-blue-900">¥{Math.round(form.target_sales * form.expense_rate).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-blue-600 text-xs">KGI達成時CV試算</p>
                <p className="font-bold text-blue-900">{form.target_av > 0 ? Math.round(form.target_sales / form.target_av).toLocaleString() : '—'}件</p>
              </div>
            </div>
          </div>

          {/* アイテム別目標（3-B''・第3段階） */}
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold text-gray-700">アイテム別目標（{yearMonth}）</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  入力するのは目標売上だけ。目標CVR・客単価は「現状値と前年値の低い方」を自動採用し（保守的な確定公式）、必要アクセス数を逆算します。
                </p>
              </div>
              {itemMsg && (
                <span className="flex items-center gap-1.5 text-xs text-green-600"><CheckCircle size={13} />{itemMsg}</span>
              )}
            </div>

            {itemRows.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">
                商品データがまだありません。商品分析CSVを取り込むと商品が表示されます。
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="px-4 py-2.5 text-left">商品</th>
                      <th className="px-3 py-2.5 text-right">目標売上（入力）</th>
                      <th className="px-3 py-2.5 text-right">目標CVR</th>
                      <th className="px-3 py-2.5 text-right">目標客単価</th>
                      <th className="px-3 py-2.5 text-right">必要アクセス</th>
                      <th className="px-3 py-2.5 text-left">根拠</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {itemRows.map((r) => {
                      const t = r.target
                      return (
                        <tr key={r.management_no}>
                          <td className="px-4 py-2">
                            <p className="text-gray-900 leading-tight">{r.product_name || r.management_no}</p>
                            <p className="text-[10px] text-gray-400 font-mono">{r.management_no}</p>
                            {r.latest_actual ? (
                              <p className="text-[10px] text-gray-400">
                                直近実績（{r.latest_actual.year_month}）: UU {r.latest_actual.access_uu.toLocaleString()} / CVR {r.latest_actual.cvr}% / 客単価 ¥{r.latest_actual.av.toLocaleString()}
                              </p>
                            ) : (
                              <p className="text-[10px] text-amber-600">実績データなし（保存すると参考値を推定します）</p>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <span className="inline-flex items-center gap-1">
                              <span className="text-gray-400 text-xs">¥</span>
                              <input
                                type="number" min={0} step={10000}
                                defaultValue={t?.target_sales ?? ''}
                                placeholder="未設定"
                                onBlur={(e) => {
                                  const v = Number(e.target.value)
                                  if (e.target.value !== '' && v > 0 && v !== (t?.target_sales ?? null)) saveItemTarget(r.management_no, v)
                                }}
                                className="w-28 text-right border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-700">{t?.target_cvr != null ? `${t.target_cvr}%` : '—'}</td>
                          <td className="px-3 py-2 text-right text-gray-700">{t?.target_av != null ? `¥${Math.round(t.target_av).toLocaleString()}` : '—'}</td>
                          <td className="px-3 py-2 text-right font-medium text-gray-900">
                            {t?.required_access != null ? `${Math.round(t.required_access).toLocaleString()} UU` : '—'}
                          </td>
                          <td className="px-3 py-2">
                            {!t ? (
                              <span className="text-[10px] text-gray-300">—</span>
                            ) : t.calc_basis === 'rule' ? (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-700" title={t.basis_detail ?? undefined}>
                                自動算出（確定公式）
                              </span>
                            ) : t.calc_basis === 'estimated' ? (
                              <span className="inline-flex items-center gap-1.5 flex-wrap">
                                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700" title={t.basis_detail ?? undefined}>
                                  参考値（推定）
                                </span>
                                {t.estimated_approved ? (
                                  <>
                                    <span className="text-[10px] text-green-600">承認済み</span>
                                    <button
                                      onClick={() => recalcItemTarget(r.management_no)}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 border text-gray-500 hover:bg-gray-50 text-[10px] rounded"
                                      title="最新の実績・推定で洗い直します"
                                    >
                                      <RefreshCw size={10} />再計算
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    onClick={() => approveItemTarget(r.management_no)}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-medium rounded"
                                    title="承認するまで診断・逆算には使われません"
                                  >
                                    <Check size={10} />この参考値で確定
                                  </button>
                                )}
                              </span>
                            ) : (
                              <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500" title={t.basis_detail ?? undefined}>
                                算出不能（データ待ち）
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="px-4 py-2.5 text-[10px] text-gray-400 border-t bg-gray-50/60 leading-snug">
              計算式: 目標注文件数 = 目標売上 ÷ 目標客単価、必要アクセス数 = 目標注文件数 ÷ 目標CVR。
              実績が無い商品は同ジャンル・自店平均からの参考値を提示し、「この参考値で確定」を押すまで診断・逆算には使いません。
              商品分析CSVを取り込むと自動で再計算されます（実測が取れた商品は確定公式に自動切替）。
            </p>
          </div>

          {/* 設定済み目標一覧 */}
          {targets.length > 0 && (
            <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b">
                <h3 className="text-sm font-semibold text-gray-700">設定済み目標一覧</h3>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left">対象月</th>
                    <th className="px-4 py-2 text-right">売上目標</th>
                    <th className="px-4 py-2 text-right">CVR目標</th>
                    <th className="px-4 py-2 text-right">客単価目標</th>
                    <th className="px-4 py-2 text-right">経費率</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {targets.map(t => (
                    <tr
                      key={t.year_month}
                      onClick={() => { setYearMonth(t.year_month); loadTarget(t.year_month) }}
                      className="cursor-pointer hover:bg-blue-50 transition-colors"
                    >
                      <td className="px-4 py-2.5 font-medium text-gray-900">{t.year_month}</td>
                      <td className="px-4 py-2.5 text-right">¥{t.target_sales.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right">{t.target_cvr}%</td>
                      <td className="px-4 py-2.5 text-right">¥{t.target_av.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right">{Math.round(t.expense_rate * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
