import { useEffect, useState } from 'react'
import { Save, CheckCircle } from 'lucide-react'
import Header from '../components/layout/Header'
import { api } from '../lib/api'
import { getCurrentYearMonth } from '../lib/utils'
import type { Target } from '../types'

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
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)

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

  const estimatedGP = form.target_sales * (1 - (form.expense_rate + 0.6))
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
        <div className="max-w-2xl mx-auto space-y-6">
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
            <p className="text-sm font-semibold text-blue-800 mb-3">目標値の試算（原価率60%を仮定）</p>
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
