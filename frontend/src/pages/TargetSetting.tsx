import { useCallback, useEffect, useState } from 'react'
import { Save, CheckCircle, Download, Upload, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import Header from '../components/layout/Header'
import RevenuePlanPanel from '../components/dashboard/RevenuePlanPanel'
import AccessPlanner from '../components/dashboard/AccessPlanner'
import { api } from '../lib/api'
import { getCurrentYearMonth } from '../lib/utils'
import type { Target, RevenuePlanResponse, AccessPlan } from '../types'

const CONFIDENCE_LABELS: Record<string, { label: string; cls: string }> = {
  high: { label: '精度: 高（2年分以上の実績）', cls: 'bg-green-100 text-green-700' },
  medium: { label: '精度: 中（実績1周分）', cls: 'bg-sage-soft text-sage-deep' },
  low: { label: '均等按分（実績12ヶ月未満）', cls: 'bg-amber-100 text-amber-700' },
}

// 目標マスタ（12ヶ月グリッド）の編集対象5項目。UIは % 系（CVR・経費率）も百分率の文字列で保持する
type TargetField = 'target_sales' | 'target_access' | 'target_cvr' | 'target_av' | 'expense_rate'

function Field({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    // 幅の規約: フォーム行はラベル列が全体の1/3を占めるため、全幅のままだとラベルと入力欄が離れる。
    // ページ直下は全幅のままにしてブロック側で止める（CLAUDE.md「画面幅の規約」参照）
    <div className="grid max-w-3xl grid-cols-3 gap-4 items-start py-4 border-b border-bg-alt last:border-0">
      <div>
        <p className="text-sm font-medium text-ink-strong">{label}</p>
        {description && <p className="text-xs text-muted mt-0.5">{description}</p>}
      </div>
      <div className="col-span-2">{children}</div>
    </div>
  )
}

export default function TargetSetting() {
  // 対象月＝表の基準月（KGI試算・按分プレビュー・アクセス逆算の対象）。
  // 12ヶ月グリッドの表示範囲もこの月を含む予算年度（店舗のbudget_year_start_month起点）に連動する
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth())
  const [targets, setTargets] = useState<Target[]>([])
  const [costRate, setCostRate] = useState(0.6)   // 店舗デフォルト原価率（/api/shops/me から取得）
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [gridSaving, setGridSaving] = useState(false)
  // 12ヶ月グリッドの編集中バッファ（年月→フィールド→入力文字列）
  const [pending, setPending] = useState<Record<string, Partial<Record<TargetField, string>>>>({})

  // アイテム別目標の一括編集は商品マスタ「アイテム別目標」タブへ移設済み
  // （マスタCRUD規約2026-08-22 区切り5。API・ロジックは無変更、置き場所のみ変更）

  // 売上予算プラン（第4段階v2）: 年間売上予算・予算年度起点と按分プレビュー
  const [annualBudget, setAnnualBudget] = useState<number | ''>('')
  const [startMonth, setStartMonth] = useState(1)
  const [plan, setPlan] = useState<RevenuePlanResponse | null>(null)
  const [budgetSaved, setBudgetSaved] = useState(false)
  const [budgetSaving, setBudgetSaving] = useState(false)
  // 年間目標プランナーの表示切替（サマリ=5列 / 詳細=9列）
  const [planView, setPlanView] = useState<'summary' | 'detail'>('summary')
  // アクセス逆算（ダッシュボードから移設。区切り6）
  const [accessPlan, setAccessPlan] = useState<AccessPlan | null>(null)

  const flash = (msg: string) => {
    setSavedMsg(msg)
    setTimeout(() => setSavedMsg(null), 2500)
  }

  const loadPlan = useCallback(async (ym: string) => {
    try {
      const res = await api.revenuePlan.get(ym)
      setPlan(res ?? null)
    } catch (e) {
      console.error('[TargetSetting] 売上予算プラン取得エラー:', e)
      setPlan(null)
    }
  }, [])

  const loadAccessPlan = useCallback(async (ym: string) => {
    try {
      const res = await api.evaluation.accessPlan('monthly', ym).catch(() => null)
      setAccessPlan((res as { plan?: AccessPlan } | null)?.plan ?? null)
    } catch (e) {
      console.error('[TargetSetting] アクセス逆算取得エラー:', e)
      setAccessPlan(null)
    }
  }, [])

  useEffect(() => { loadPlan(yearMonth); loadAccessPlan(yearMonth) }, [yearMonth, loadPlan, loadAccessPlan])

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

  const loadTargets = useCallback(async () => {
    try {
      const data = await api.targets.list()
      setTargets(Array.isArray(data) ? (data as Target[]) : [])
    } catch (e) {
      console.error('[TargetSetting] 目標一覧取得エラー:', e)
      setTargets([])
    }
  }, [])

  useEffect(() => {
    loadTargets()
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
  }, [loadTargets])

  // ── 目標マスタ12ヶ月グリッド（マスタCRUD規約2026-08-22 区切り6）───────────
  // 行=年月は revenue-plan が既に計算済みの予算年度（budget_year_start_month起点、
  // yearMonthを含む12ヶ月）をそのまま使う。年度の月レンジ計算をここで複製しない
  const gridMonths = plan?.months.map((m) => m.year_month) ?? []
  const targetsByYm = Object.fromEntries(targets.map((t) => [t.year_month, t]))

  /** そのフィールドの「保存済みの値」を編集欄と同じ単位（文字列）で返す */
  const savedFieldValue = (ym: string, field: TargetField): string => {
    const t = targetsByYm[ym]
    if (!t) return ''
    if (field === 'expense_rate') return String(Math.round(t.expense_rate * 100))
    return String(t[field])
  }

  const displayFieldValue = (ym: string, field: TargetField): string => {
    const p = pending[ym]?.[field]
    return p !== undefined ? p : savedFieldValue(ym, field)
  }

  const setFieldValue = (ym: string, field: TargetField, value: string) => {
    setPending((prev) => ({ ...prev, [ym]: { ...prev[ym], [field]: value } }))
  }

  /** その月が未保存の変更を持つか（触れたフィールドの値が保存済みと異なる） */
  const isRowDirty = (ym: string): boolean => {
    const p = pending[ym]
    if (!p) return false
    return (Object.keys(p) as TargetField[]).some((f) => p[f] !== undefined && p[f] !== savedFieldValue(ym, f))
  }

  const dirtyMonths = gridMonths.filter(isRowDirty)

  /** 保存済み値＋編集中の値をマージし、POST /api/targets の完全なペイロードを作る
   * （backendのupsertは全項目を上書きするため、常に5項目そろえて送る）。
   * 未設定の項目は新規作成時のTargetIn既定値（backend/routers/targets.py）に合わせる */
  const buildPayload = (ym: string) => {
    const t = targetsByYm[ym]
    const val = (field: TargetField, fallback: number): number => {
      const raw = pending[ym]?.[field] ?? (t ? savedFieldValue(ym, field) : undefined)
      const n = raw !== undefined ? Number(raw) : NaN
      return Number.isFinite(n) ? n : fallback
    }
    return {
      year_month: ym,
      target_sales: val('target_sales', 0),
      target_access: val('target_access', 0),
      target_cvr: val('target_cvr', 0),
      target_av: val('target_av', 0),
      expense_rate: val('expense_rate', 15) / 100,
    }
  }

  const saveAllDirty = async () => {
    if (dirtyMonths.length === 0) { flash('保存対象の変更がありません'); return }
    setGridSaving(true)
    const failed: string[] = []
    await Promise.all(dirtyMonths.map(async (ym) => {
      try {
        await api.targets.upsert(buildPayload(ym))
      } catch (e) {
        console.error(`[TargetSetting] ${ym} の目標保存エラー:`, e)
        failed.push(ym)
      }
    }))
    // 成功した月だけ編集中バッファをクリアする（失敗分は入力内容を残す）
    setPending((prev) => {
      const next = { ...prev }
      for (const ym of dirtyMonths) if (!failed.includes(ym)) delete next[ym]
      return next
    })
    await loadTargets()
    await loadPlan(yearMonth)
    setGridSaving(false)
    flash(
      failed.length > 0
        ? `${dirtyMonths.length - failed.length}件保存しました（${failed.length}件失敗: ${failed.join('、')}）`
        : `${dirtyMonths.length}件の目標を保存しました`,
    )
  }

  const deleteMonth = async (ym: string) => {
    if (!window.confirm(`${ym} の目標を削除します。よろしいですか？`)) return
    try {
      await api.targets.remove(ym)
      await loadTargets()
      await loadPlan(yearMonth)
      flash(`${ym} の目標を削除しました`)
    } catch (e) {
      console.error('[TargetSetting] 目標削除エラー:', e)
    }
  }

  const exportCsv = async () => {
    try {
      await api.targets.exportCsv()
    } catch (e) {
      console.error('[TargetSetting] CSVエクスポートエラー:', e)
    }
  }

  const importCsv = async (file: File) => {
    try {
      const res = await api.targets.importCsv(file)
      await loadTargets()
      await loadPlan(yearMonth)
      flash(`CSV取込み完了（新規${res?.created ?? 0} / 更新${res?.updated ?? 0}件）`)
    } catch (e) {
      console.error('[TargetSetting] CSVインポートエラー:', e)
      flash('CSV取込みに失敗しました')
    }
  }

  // 対象月（フォーカス行）の試算。編集中の値があれば即時反映する
  const focus = buildPayload(yearMonth)
  const estimatedGP = focus.target_sales * (1 - (focus.expense_rate + costRate))

  return (
    <div className="flex flex-col h-full">
      <Header
        title="目標設定"
        subtitle="KGI（売上目標）・KPI目標値・経費率の設定"
        actions={
          savedMsg && <span className="flex items-center gap-1.5 text-sm text-green-600"><CheckCircle size={15} />{savedMsg}</span>
        }
      />

      <div className="flex-1 overflow-auto p-6 bg-bg-alt">
        {/* 幅の上限は付けない（他の表示系画面と同じ全幅）。
            12ヶ月グリッド・年間目標プランナーの表が画面幅を使い切れるようにするため。max-w-* を戻さないこと */}
        <div className="space-y-6">
          {/* 入力順ガイド（マスタCRUD規約2026-08-22 区切り6） */}
          <div className="bg-sage-soft border border-sage-soft rounded-xl px-4 py-3 max-w-3xl text-sm text-sage-deep">
            <span className="font-semibold">① まずここで店舗全体の目標を月ごとに設定</span>
            <span className="mx-1.5">→</span>
            <Link to="/master" className="underline hover:no-underline">② 商品マスタでアイテム別目標を設定</Link>
          </div>

          {/* 対象月（基準月） */}
          <div className="bg-white rounded-xl border shadow-sm p-6 max-w-3xl">
            <h3 className="text-sm font-semibold text-sub mb-4">対象月</h3>
            <input
              type="month"
              value={yearMonth}
              onChange={e => setYearMonth(e.target.value)}
              className="border border-line rounded-lg px-3 py-2 text-sm text-sub focus:outline-none focus:ring-2 focus:ring-sage-deep"
            />
            <p className="text-xs text-muted mt-2">
              この月を含む予算年度を、下の目標マスタ・年間目標プランナーの表示範囲に使います。
            </p>
          </div>

          {/* KGI試算（対象月の効いている値。編集中はここに即時反映される） */}
          <div className="bg-sage-soft border border-sage-soft rounded-xl p-4 max-w-3xl">
            <p className="text-sm font-semibold text-sage-deep mb-3">
              {yearMonth} の試算（原価率{Math.round(costRate * 100)}%・経費率{Math.round(focus.expense_rate * 100)}%を適用）
            </p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-sage-deep text-xs">推定GP（利益）</p>
                <p className="font-bold text-sage-deep tabular-nums">¥{Math.round(estimatedGP).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sage-deep text-xs">店舗運営経費</p>
                <p className="font-bold text-sage-deep tabular-nums">¥{Math.round(focus.target_sales * focus.expense_rate).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-sage-deep text-xs">目標CV試算</p>
                <p className="font-bold text-sage-deep tabular-nums">{focus.target_av > 0 ? Math.round(focus.target_sales / focus.target_av).toLocaleString() : '—'}件</p>
              </div>
              <div>
                <p className="text-sage-deep text-xs">目標客単価</p>
                <p className="font-bold text-sage-deep tabular-nums">{focus.target_av > 0 ? `¥${focus.target_av.toLocaleString()}` : '未設定'}</p>
              </div>
            </div>
          </div>

          {/* 目標マスタ（12ヶ月グリッド）。1ヶ月ずつのフォーム入力から置き換え（区切り6） */}
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold text-sub">目標マスタ（{gridMonths[0] ?? '—'} 〜 {gridMonths[gridMonths.length - 1] ?? '—'}）</h3>
                <p className="text-xs text-muted mt-0.5">売上 = アクセス × CVR × 客単価。セルを直接編集し、まとめて一括保存できます</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={exportCsv}
                  className="flex items-center gap-1.5 text-xs text-sub border rounded-lg px-2.5 py-1.5 hover:bg-bg-alt transition-colors"
                >
                  <Download size={13} />CSVエクスポート
                </button>
                <label className="flex items-center gap-1.5 text-xs text-sub border rounded-lg px-2.5 py-1.5 hover:bg-bg-alt cursor-pointer transition-colors">
                  <Upload size={13} />CSVインポート
                  <input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = '' }}
                  />
                </label>
                {dirtyMonths.length > 0 && (
                  <span className="text-xs text-amber-600">未保存 {dirtyMonths.length}件</span>
                )}
                <button
                  onClick={saveAllDirty}
                  disabled={dirtyMonths.length === 0 || gridSaving}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sage-deep hover:bg-sage-deep disabled:bg-line disabled:cursor-not-allowed text-white text-sm font-medium rounded"
                >
                  <Save size={14} />{gridSaving ? '保存中…' : '一括保存'}
                </button>
              </div>
            </div>

            {gridMonths.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted">読み込み中…</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead className="bg-bg-alt text-xs text-muted">
                    <tr>
                      <th className="px-3 py-2.5 text-left">年月</th>
                      <th className="px-3 py-2.5 text-right">目標売上（円）</th>
                      <th className="px-3 py-2.5 text-right">目標アクセス（UU）</th>
                      <th className="px-3 py-2.5 text-right">目標CVR（%）</th>
                      <th className="px-3 py-2.5 text-right">目標客単価（円）</th>
                      <th className="px-3 py-2.5 text-right">経費率（%）</th>
                      <th className="px-3 py-2.5 text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bg-alt">
                    {gridMonths.map((ym) => {
                      const dirty = isRowDirty(ym)
                      const hasTarget = targetsByYm[ym] != null
                      const cellCls = (field: TargetField) =>
                        `w-full text-right border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-sage-deep ${
                          pending[ym]?.[field] !== undefined && pending[ym]?.[field] !== savedFieldValue(ym, field)
                            ? 'border-amber-400 bg-white'
                            : 'border-line'
                        }`
                      return (
                        <tr
                          key={ym}
                          className={dirty ? 'bg-amber-50/60' : ym === yearMonth ? 'bg-sage-soft' : undefined}
                        >
                          <td className="px-3 py-2 font-medium text-ink-strong whitespace-nowrap">{ym}</td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min={0} step={100000} placeholder="未設定"
                              value={displayFieldValue(ym, 'target_sales')}
                              onFocus={() => setYearMonth(ym)}
                              onChange={(e) => setFieldValue(ym, 'target_sales', e.target.value)}
                              className={cellCls('target_sales')}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min={0} step={1000} placeholder="未設定"
                              value={displayFieldValue(ym, 'target_access')}
                              onFocus={() => setYearMonth(ym)}
                              onChange={(e) => setFieldValue(ym, 'target_access', e.target.value)}
                              className={cellCls('target_access')}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min={0} max={100} step={0.1} placeholder="未設定"
                              value={displayFieldValue(ym, 'target_cvr')}
                              onFocus={() => setYearMonth(ym)}
                              onChange={(e) => setFieldValue(ym, 'target_cvr', e.target.value)}
                              className={cellCls('target_cvr')}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min={0} step={100} placeholder="未設定"
                              value={displayFieldValue(ym, 'target_av')}
                              onFocus={() => setYearMonth(ym)}
                              onChange={(e) => setFieldValue(ym, 'target_av', e.target.value)}
                              className={cellCls('target_av')}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min={0} max={100} step={1} placeholder="15"
                              value={displayFieldValue(ym, 'expense_rate')}
                              onFocus={() => setYearMonth(ym)}
                              onChange={(e) => setFieldValue(ym, 'expense_rate', e.target.value)}
                              className={cellCls('expense_rate')}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            {hasTarget ? (
                              <button
                                onClick={() => deleteMonth(ym)}
                                className="inline-flex items-center gap-1 px-2 py-1 border border-line text-muted hover:text-red-600 hover:border-red-300 hover:bg-red-50 text-xs rounded transition-colors"
                                title="この月の目標を削除します"
                              >
                                <Trash2 size={11} />削除
                              </button>
                            ) : (
                              <span className="text-xs text-line">—</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 年間売上予算（売上予算プラン・第4段階v2） */}
          <div className="bg-white rounded-xl border shadow-sm p-6">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
              <h3 className="text-sm font-semibold text-sub">年間売上予算</h3>
              {budgetSaved && (
                <span className="flex items-center gap-1.5 text-xs text-green-600"><CheckCircle size={13} />保存しました</span>
              )}
            </div>
            <p className="text-xs text-muted mb-4">
              過去実績の季節性で月次に自動按分します（按分値は保存せず、実績の蓄積で自動的に精度が上がります）
            </p>
            <Field label="年間売上予算" description="未入力に戻すと機能をオフにできます">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted">¥</span>
                <input
                  type="number"
                  value={annualBudget}
                  min={0}
                  step={1000000}
                  placeholder="未設定"
                  onChange={e => setAnnualBudget(e.target.value === '' ? '' : Number(e.target.value))}
                  className="border border-line rounded-lg px-3 py-2 text-sm w-48 focus:outline-none focus:ring-2 focus:ring-sage-deep"
                />
              </div>
            </Field>
            <Field label="予算年度の起点月" description="決算期に合わせられます（既定: 1月=暦年）">
              <select
                value={startMonth}
                onChange={e => setStartMonth(Number(e.target.value))}
                className="border border-line rounded-lg px-3 py-2 text-sm w-32 focus:outline-none focus:ring-2 focus:ring-sage-deep"
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
                className="px-4 py-2 bg-ink-strong hover:bg-ink disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
              >
                年間予算を保存して按分を更新
              </button>
            </div>

            {/* 按分プレビュー */}
            {plan && (
              <div className="mt-5 border-t pt-4">
                {plan.status === 'no_budget' || plan.status === 'collect_data' ? (
                  <div className="bg-bg-alt border border-line rounded-lg p-3">
                    <p className="text-sm font-medium text-sub">{plan.guide.title}</p>
                    <p className="text-xs text-muted mt-1 leading-relaxed">{plan.guide.message}</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <p className="text-xs font-semibold text-sub">
                        年間目標プランナー（{plan.budget_year.from} 〜 {plan.budget_year.to}）
                      </p>
                      <div className="flex gap-0.5 border border-line rounded-md p-0.5">
                        {(['summary', 'detail'] as const).map(v => (
                          <button
                            key={v}
                            onClick={() => setPlanView(v)}
                            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                              planView === v ? 'bg-ink-strong text-white' : 'text-muted hover:bg-bg-alt'
                            }`}
                          >
                            {v === 'summary' ? 'サマリ' : '詳細'}
                          </button>
                        ))}
                      </div>
                      {plan.seasonal_index.confidence && CONFIDENCE_LABELS[plan.seasonal_index.confidence] && (
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${CONFIDENCE_LABELS[plan.seasonal_index.confidence].cls}`}>
                          {CONFIDENCE_LABELS[plan.seasonal_index.confidence].label}
                        </span>
                      )}
                      <span className="text-xs text-muted">
                        根拠: 有効実績{plan.seasonal_index.valid_months}ヶ月
                        {plan.seasonal_index.period_from && `（${plan.seasonal_index.period_from}〜${plan.seasonal_index.period_to}）`}
                      </span>
                    </div>
                    {/* 注記は1行が長くなりすぎると読みにくいので、表と同じくらいの幅で折り返す */}
                    <p className="max-w-3xl text-xs text-muted mb-2 leading-snug">{plan.guide.message}</p>
                    <div className="overflow-x-auto">
                      {/* 親を全幅にしたぶん、列数の少ないこの表は放っておくと間延びする。
                          表そのものに上限幅を持たせて詰めておく（サマリ=5列 / 詳細=9列）。
                          tabular-nums は数値の桁位置を揃えるため */}
                      <table
                        className={`w-full text-xs tabular-nums ${
                          planView === 'summary' ? 'max-w-2xl' : 'max-w-5xl'
                        }`}
                      >
                        <thead className="bg-bg-alt text-xs text-muted">
                          <tr>
                            <th className="px-2 py-1.5 text-left">月</th>
                            {planView === 'detail' && <th className="px-2 py-1.5 text-right">季節指数</th>}
                            <th className="px-2 py-1.5 text-right">売上予算（円・編集で手動補正）</th>
                            <th className="px-2 py-1.5 text-right">必要アクセス（UU）</th>
                            {planView === 'detail' && <th className="px-2 py-1.5 text-right">目標CVR（%）</th>}
                            {planView === 'detail' && <th className="px-2 py-1.5 text-right">目標客単価（円）</th>}
                            <th className="px-2 py-1.5 text-right">想定追加広告費（円）</th>
                            {planView === 'detail' && <th className="px-2 py-1.5 text-right">実績売上（円）</th>}
                            <th className="px-2 py-1.5 text-right">達成率（%）</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-bg-alt">
                          {plan.months.map(m => (
                            <tr key={m.year_month} className={m.year_month === yearMonth ? 'bg-sage-soft' : ''}>
                              <td className="px-2 py-1.5 font-medium text-ink whitespace-nowrap">{m.year_month}</td>
                              {planView === 'detail' && (
                                <td className="px-2 py-1.5 text-right text-sub">{m.index != null ? m.index.toFixed(2) : '—'}</td>
                              )}
                              <td className="px-2 py-1.5 text-right whitespace-nowrap">
                                <span className="inline-flex items-center gap-1 justify-end">
                                  {m.sales_budget_source === 'manual' && (
                                    <>
                                      <span className="inline-block px-1 py-0.5 rounded text-xs font-medium bg-violet-100 text-violet-700" title="手動補正中。空欄で保存すると自動按分に戻ります">手動</span>
                                      <button
                                        onClick={() => saveOverride(m.year_month, null)}
                                        className="text-xs text-muted hover:text-red-500 underline"
                                        title="補正を解除して自動按分に戻す"
                                      >解除</button>
                                    </>
                                  )}
                                  <span className="text-muted text-xs">¥</span>
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
                                      m.sales_budget_source === 'manual' ? 'border-violet-300 bg-violet-50/50' : 'border-line'
                                    }`}
                                  />
                                </span>
                              </td>
                              <td className="px-2 py-1.5 text-right text-ink-strong whitespace-nowrap" title={m.basis_detail ?? undefined}>
                                {m.required_access != null ? Math.round(m.required_access).toLocaleString() : '—'}
                              </td>
                              {planView === 'detail' && (
                                <td className="px-2 py-1.5 text-right text-sub whitespace-nowrap" title={m.basis_detail ?? undefined}>
                                  {m.target_cvr != null ? String(m.target_cvr) : '—'}
                                  {m.target_cvr_basis === 'manual' && <span className="ml-0.5 text-xs text-violet-600" title="目標マスタの手入力を採用">手</span>}
                                </td>
                              )}
                              {planView === 'detail' && (
                                <td className="px-2 py-1.5 text-right text-sub whitespace-nowrap" title={m.basis_detail ?? undefined}>
                                  {m.target_av != null ? Math.round(m.target_av).toLocaleString() : '—'}
                                  {m.target_av_basis === 'manual' && <span className="ml-0.5 text-xs text-violet-600" title="目標マスタの手入力を採用">手</span>}
                                </td>
                              )}
                              <td
                                className="px-2 py-1.5 text-right whitespace-nowrap"
                                title={m.cpc != null ? `CPC ¥${m.cpc.toLocaleString()}（${m.cpc_source_month}実績${m.cpc_is_fallback ? '・直近月で代用' : ''}）${m.actual_access_month && m.actual_access_month !== m.year_month ? `／現状アクセスは${m.actual_access_month}実績を見込みとして使用` : ''}` : m.basis_detail ?? undefined}
                              >
                                {m.shortfall_access != null && m.shortfall_access <= 0 ? (
                                  <span className="text-green-600 font-medium">充足</span>
                                ) : m.est_ad_cost != null ? (
                                  <span className="text-ink-strong">
                                    {Math.round(m.est_ad_cost).toLocaleString()}
                                    {m.cpc_is_fallback && <span className="text-muted">※</span>}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                              {planView === 'detail' && (
                                <td className="px-2 py-1.5 text-right text-sub whitespace-nowrap">{m.actual_sales != null ? Math.round(m.actual_sales).toLocaleString() : '—'}</td>
                              )}
                              <td className={`px-2 py-1.5 text-right font-medium ${m.achievement_rate == null ? 'text-line' : m.achievement_rate >= 100 ? 'text-green-600' : 'text-red-500'}`}>
                                {m.achievement_rate != null ? String(m.achievement_rate) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* CPC注記（想定広告費の前提。CPCの季節変動はスコープ外の簡略化） */}
                    {(() => {
                      const fb = plan.months.find(m => m.cpc_is_fallback && m.cpc_source_month)
                      if (!plan.months.some(m => m.est_ad_cost != null)) return null
                      return (
                        <p className="mt-1.5 max-w-3xl text-xs text-muted leading-snug">
                          想定追加広告費は各月のRPP実績CPCに基づく試算です
                          {fb && `（※印の月はRPP実績が無いため、直近実績月 ${fb.cpc_source_month} のCPC ¥${fb.cpc?.toLocaleString()} で代用）`}。
                          CPCの季節変動は考慮していません。実績が無い月の現状アクセスは直近実績月の値を見込みとして使っています。
                        </p>
                      )
                    })()}
                    {/* 12ヶ月合計と年間予算の差分（手動補正は他月へ再配分しないため乖離しうる） */}
                    {plan.annual_sales_budget != null && (() => {
                      const total = plan.months.reduce((s, m) => s + (m.sales_budget ?? 0), 0)
                      const diff = total - plan.annual_sales_budget
                      return (
                        <p className={`mt-1.5 max-w-3xl text-xs leading-snug ${Math.abs(diff) >= 1 ? 'text-amber-600' : 'text-muted'}`}>
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

          {/* 売上予算プラン・アクセス逆算（ダッシュボードから移設。区切り6 Q5承認済み） */}
          <RevenuePlanPanel yearMonth={yearMonth} />
          {accessPlan && <AccessPlanner plan={accessPlan} />}

          {/* アイテム別目標は商品マスタへ移設済み（マスタCRUD規約2026-08-22 区切り5） */}
          <div className="bg-white rounded-xl border shadow-sm p-4 max-w-3xl flex items-center justify-between gap-3">
            <p className="text-sm text-sub">
              商品ごとの目標売上は「商品マスタ」の<span className="font-medium text-ink-strong">アイテム別目標</span>タブへ移動しました。
            </p>
            <Link
              to="/master"
              className="shrink-0 px-3 py-1.5 bg-ink-strong hover:bg-ink text-white text-sm font-medium rounded-lg transition-colors"
            >
              商品マスタを開く
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
