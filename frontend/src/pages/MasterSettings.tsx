import { useEffect, useState, useCallback } from 'react'
import { Save, CheckCircle, RefreshCw, Plus, Trash2, Pencil, Check, X, Download, Upload, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'
import Header from '../components/layout/Header'
import { api } from '../lib/api'
import type { MasterProduct, CostItem, Category, SuggestionItem } from '../types'

/** 管理番号ごとに商品マスタ情報＋適用中の原価率をまとめた1行。 */
interface Row extends MasterProduct {
  cost_rate: number
  cost_source: 'product' | 'default'
}

function categoryPath(c: Category): string {
  return [c.genre_u1, c.genre_u2, c.genre_u3].filter(Boolean).join(' > ') || '（空カテゴリ）'
}

export default function MasterSettings() {
  const [rows, setRows] = useState<Row[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(true)

  // 提案キュー（マスタ入力支援）
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([])
  const [suggestOpen, setSuggestOpen] = useState(true)
  const [editingSuggestId, setEditingSuggestId] = useState<string | null>(null)
  const [editSuggest, setEditSuggest] = useState<{ category_id: number | null; cost_pct: number }>({ category_id: null, cost_pct: 60 })

  // 店舗設定フォーム
  const [shopName, setShopName] = useState('')
  const [costPct, setCostPct] = useState(60)
  const [expensePct, setExpensePct] = useState(15)
  const [restockDays, setRestockDays] = useState(14)

  // カテゴリ管理
  const [newCat, setNewCat] = useState({ genre_u1: '', genre_u2: '', genre_u3: '' })
  const [editingCatId, setEditingCatId] = useState<number | null>(null)
  const [editCat, setEditCat] = useState({ genre_u1: '', genre_u2: '', genre_u3: '' })

  const flash = (msg: string) => {
    setSavedMsg(msg)
    setTimeout(() => setSavedMsg(null), 2000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [prodRes, costRes, shopRes, catRes, sugRes] = await Promise.all([
        api.master.products(),
        api.costs.list(),
        api.shops.me(),
        api.master.categories(),
        api.master.suggestions(),
      ])
      const costMap = new Map<string, CostItem>()
      for (const c of costRes.items) costMap.set(c.management_no, c)
      const merged: Row[] = prodRes.items.map((p) => {
        const c = costMap.get(p.management_no)
        return {
          ...p,
          cost_rate: c ? c.cost_rate : costRes.default_cost_rate,
          cost_source: c ? c.source : 'default',
        }
      })
      merged.sort((a, b) => a.management_no.localeCompare(b.management_no))
      setRows(merged)
      setCategories(catRes.items)
      setSuggestions(sugRes.items)
      setShopName(shopRes.name)
      setCostPct(Math.round((shopRes.default_cost_rate ?? 0.6) * 100))
      setExpensePct(Math.round((shopRes.default_expense_rate ?? 0.15) * 100))
      setRestockDays(shopRes.restock_lead_days ?? 14)
    } catch (e) {
      console.error('[MasterSettings] 取得エラー:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const saveShop = async () => {
    try {
      await api.shops.update({
        name: shopName,
        default_cost_rate: costPct / 100,
        default_expense_rate: expensePct / 100,
        restock_lead_days: restockDays,
      })
      flash('店舗設定を保存しました（原価率変更分は再計算済み）')
      await load()
    } catch (e) {
      console.error('[MasterSettings] 店舗保存エラー:', e)
    }
  }

  const toggleActive = async (r: Row) => {
    try {
      await api.master.updateProduct(r.management_no, { is_active: !r.is_active })
      setRows((prev) => prev.map((x) => x.management_no === r.management_no ? { ...x, is_active: !x.is_active } : x))
    } catch (e) {
      console.error('[MasterSettings] 状態更新エラー:', e)
    }
  }

  const saveName = async (r: Row, name: string) => {
    if (name === (r.product_name ?? '')) return
    try {
      await api.master.updateProduct(r.management_no, { product_name: name })
      setRows((prev) => prev.map((x) => x.management_no === r.management_no ? { ...x, product_name: name } : x))
    } catch (e) {
      console.error('[MasterSettings] 商品名更新エラー:', e)
    }
  }

  const saveCategory = async (r: Row, categoryId: number | null) => {
    if (categoryId === r.category_id) return
    try {
      await api.master.updateProduct(r.management_no, { category_id: categoryId })
      const cat = categoryId != null ? categories.find((c) => c.id === categoryId) : null
      setRows((prev) => prev.map((x) => x.management_no === r.management_no ? {
        ...x,
        category_id: categoryId,
        genre_u1: cat?.genre_u1 ?? null,
        genre_u2: cat?.genre_u2 ?? null,
        genre_u3: cat?.genre_u3 ?? null,
      } : x))
    } catch (e) {
      console.error('[MasterSettings] カテゴリ更新エラー:', e)
    }
  }

  const saveRate = async (r: Row, pct: number) => {
    const rate = Math.min(Math.max(pct / 100, 0), 1)
    if (rate === r.cost_rate && r.cost_source === 'product') return
    try {
      await api.costs.setProduct(r.management_no, rate)
      setRows((prev) => prev.map((x) => x.management_no === r.management_no ? { ...x, cost_rate: rate, cost_source: 'product' } : x))
      flash(`${r.management_no} の原価率を更新（再計算済み）`)
    } catch (e) {
      console.error('[MasterSettings] 原価率更新エラー:', e)
    }
  }

  const recalcAll = async () => {
    try {
      const res = await api.costs.recalc()
      flash(`再計算しました（${res.recalculated_rows}行更新）`)
    } catch (e) {
      console.error('[MasterSettings] 再計算エラー:', e)
    }
  }

  const addCategory = async () => {
    if (!newCat.genre_u1.trim() && !newCat.genre_u2.trim() && !newCat.genre_u3.trim()) return
    try {
      await api.master.createCategory(newCat)
      setNewCat({ genre_u1: '', genre_u2: '', genre_u3: '' })
      await load()
      flash('カテゴリを作成しました')
    } catch (e) {
      console.error('[MasterSettings] カテゴリ作成エラー:', e)
    }
  }

  const startEditCat = (c: Category) => {
    setEditingCatId(c.id)
    setEditCat({ genre_u1: c.genre_u1 ?? '', genre_u2: c.genre_u2 ?? '', genre_u3: c.genre_u3 ?? '' })
  }

  const saveEditCat = async () => {
    if (editingCatId == null) return
    try {
      await api.master.updateCategory(editingCatId, editCat)
      setEditingCatId(null)
      await load()
      flash('カテゴリを更新しました')
    } catch (e) {
      console.error('[MasterSettings] カテゴリ更新エラー:', e)
      flash('更新に失敗しました（同名カテゴリの可能性）')
    }
  }

  const exportCsv = async () => {
    try {
      await api.master.exportCsv()
    } catch (e) {
      console.error('[MasterSettings] CSVエクスポートエラー:', e)
    }
  }

  const importCsv = async (file: File) => {
    try {
      const res = await api.master.importCsv(file)
      await load()
      flash(`CSV取込み完了（更新${res?.updated ?? 0} / 新規${res?.created ?? 0} / 原価${res?.cost_set ?? 0}件 / 再計算${res?.recalculated_rows ?? 0}行）`)
    } catch (e) {
      console.error('[MasterSettings] CSVインポートエラー:', e)
      flash('CSV取込みに失敗しました')
    }
  }

  const removeCategory = async (c: Category) => {
    if (!window.confirm(`「${categoryPath(c)}」を削除します。このカテゴリの商品は「未分類」に戻ります。よろしいですか？`)) return
    try {
      const res = await api.master.deleteCategory(c.id)
      await load()
      flash(`カテゴリを削除しました（${res.detached_products}商品を未分類化）`)
    } catch (e) {
      console.error('[MasterSettings] カテゴリ削除エラー:', e)
    }
  }

  // 提案キュー操作 ─────────────────────────────
  /** 高信頼の提案（未設定かつ confidence=high）を1つでも持つか */
  const hasHigh = (s: SuggestionItem) =>
    (s.current.category_id == null && s.suggested.category?.confidence === 'high') ||
    (s.current.cost_rate == null && s.suggested.cost_rate.confidence === 'high')
  const highCount = suggestions.filter(hasHigh).length

  const approveOne = async (s: SuggestionItem) => {
    const approveCategory = s.current.category_id == null && !!s.suggested.category
    const approveCost = s.current.cost_rate == null
    if (!approveCategory && !approveCost) return
    try {
      await api.master.approveSuggestion(s.management_no, {
        approve_category: approveCategory,
        approve_cost_rate: approveCost,
      })
      await load()
      flash(`${s.management_no} を承認しました`)
    } catch (e) {
      console.error('[MasterSettings] 提案承認エラー:', e)
    }
  }

  const approveAllHigh = async () => {
    try {
      const res = await api.master.approveAllSuggestions(suggestions.map((s) => s.management_no))
      await load()
      flash(`高信頼の提案を ${res?.approved_count ?? 0} 件承認しました`)
    } catch (e) {
      console.error('[MasterSettings] 一括承認エラー:', e)
    }
  }

  const startEditSuggest = (s: SuggestionItem) => {
    setEditingSuggestId(s.management_no)
    setEditSuggest({
      category_id: s.current.category_id ?? s.suggested.category?.category_id ?? null,
      cost_pct: s.current.cost_rate != null
        ? Math.round(s.current.cost_rate * 100)
        : Math.round(s.suggested.cost_rate.suggested_rate * 100),
    })
  }

  const confirmEditSuggest = async (s: SuggestionItem) => {
    try {
      // カテゴリ確定（既存の手動編集フローを流用）
      if ((editSuggest.category_id ?? null) !== (s.current.category_id ?? null)) {
        await api.master.updateProduct(s.management_no, { category_id: editSuggest.category_id })
      }
      // 原価率確定（→ 対象商品のみ再計算）
      const rate = Math.min(Math.max(editSuggest.cost_pct / 100, 0), 1)
      await api.costs.setProduct(s.management_no, rate)
      setEditingSuggestId(null)
      await load()
      flash(`${s.management_no} を確定しました`)
    } catch (e) {
      console.error('[MasterSettings] 編集確定エラー:', e)
    }
  }

  const confidenceBadge = (c: 'high' | 'low') => (
    <span className={`ml-1 text-[10px] px-1 py-0.5 rounded font-medium ${
      c === 'high' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
    }`}>
      {c === 'high' ? '高信頼' : '要確認'}
    </span>
  )

  const visibleRows = showInactive ? rows : rows.filter((r) => r.is_active)
  const inactiveCount = rows.filter((r) => !r.is_active).length

  return (
    <div className="flex flex-col h-full">
      <Header
        title="商品マスタ・原価設定"
        subtitle={`${rows.length}商品${inactiveCount > 0 ? `（うち廃盤 ${inactiveCount}）` : ''}`}
        actions={
          savedMsg ? (
            <span className="flex items-center gap-1.5 text-sm text-green-600"><CheckCircle size={15} />{savedMsg}</span>
          ) : (
            <button
              onClick={recalcAll}
              className="flex items-center gap-2 px-3 py-2 bg-white border text-gray-700 hover:bg-gray-50 text-sm font-medium rounded-lg transition-colors"
            >
              <RefreshCw size={14} />原価を全再計算
            </button>
          )
        }
      />

      <div className="flex-1 overflow-auto p-6 bg-gray-50">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* 未確認の提案（マスタ入力支援） */}
          {suggestions.length > 0 && (
            <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b bg-amber-50 flex items-center justify-between gap-3 flex-wrap">
                <button
                  onClick={() => setSuggestOpen((v) => !v)}
                  className="flex items-center gap-2 text-sm font-semibold text-amber-800"
                >
                  <Sparkles size={15} />
                  未確認の提案（{suggestions.length}件）
                  {suggestOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>
                {highCount > 0 && (
                  <button
                    onClick={approveAllHigh}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    <Check size={13} />高信頼の提案をまとめて承認（{highCount}）
                  </button>
                )}
              </div>

              {suggestOpen && (
                <>
                  <p className="px-4 py-2 text-xs text-gray-400 border-b bg-gray-50/60">
                    取込で自動生成された商品のうち、カテゴリ・原価率が未確定のものです。「要確認」（低信頼）の提案は一括承認の対象外で、個別承認・編集のみになります。
                  </p>
                  <ul className="divide-y divide-gray-100">
                    {suggestions.map((s) => (
                      <li key={s.management_no} className="px-4 py-3">
                        {editingSuggestId === s.management_no ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="min-w-[150px]">
                              <p className="text-sm font-medium text-gray-900 leading-tight">{s.product_name || '（名称未設定）'}</p>
                              <p className="text-xs text-gray-400 font-mono">{s.management_no}</p>
                            </div>
                            <select
                              value={editSuggest.category_id ?? ''}
                              onChange={(e) => setEditSuggest((p) => ({ ...p, category_id: e.target.value === '' ? null : Number(e.target.value) }))}
                              className="text-xs border border-gray-200 rounded px-1.5 py-1 max-w-[180px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="">未分類</option>
                              {categories.map((c) => <option key={c.id} value={c.id}>{categoryPath(c)}</option>)}
                            </select>
                            <span className="inline-flex items-center gap-1">
                              <input
                                type="number" min={0} max={100} step={1}
                                value={editSuggest.cost_pct}
                                onChange={(e) => setEditSuggest((p) => ({ ...p, cost_pct: Number(e.target.value) }))}
                                className="w-16 text-right text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                              <span className="text-gray-400 text-xs">%</span>
                            </span>
                            <div className="ml-auto flex items-center gap-1">
                              <button onClick={() => confirmEditSuggest(s)} className="flex items-center gap-1 px-2.5 py-1 bg-gray-900 hover:bg-gray-800 text-white text-xs rounded"><Check size={13} />確定</button>
                              <button onClick={() => setEditingSuggestId(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded" title="取消"><X size={15} /></button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 flex-wrap">
                            <div className="min-w-[150px]">
                              <p className="text-sm font-medium text-gray-900 leading-tight">{s.product_name || '（名称未設定）'}</p>
                              <p className="text-xs text-gray-400 font-mono">{s.management_no}</p>
                            </div>
                            <div className="flex-1 min-w-[170px] text-xs">
                              <span className="text-gray-400">カテゴリ: </span>
                              {s.current.category_id != null ? (
                                <span className="text-gray-400">設定済み</span>
                              ) : s.suggested.category ? (
                                <span className="text-gray-700">
                                  {s.suggested.category.label}{confidenceBadge(s.suggested.category.confidence)}
                                  <span className="text-gray-400 ml-1">{s.suggested.category.basis}</span>
                                </span>
                              ) : (
                                <span className="text-amber-600">提案なし（新規カテゴリ作成が必要）</span>
                              )}
                            </div>
                            <div className="min-w-[150px] text-xs">
                              <span className="text-gray-400">原価率: </span>
                              {s.current.cost_rate != null ? (
                                <span className="text-gray-400">設定済み {Math.round(s.current.cost_rate * 100)}%</span>
                              ) : (
                                <span className="text-gray-700">
                                  {Math.round(s.suggested.cost_rate.suggested_rate * 100)}%{confidenceBadge(s.suggested.cost_rate.confidence)}
                                  <span className="text-gray-400 ml-1">{s.suggested.cost_rate.basis}</span>
                                </span>
                              )}
                            </div>
                            <div className="ml-auto flex items-center gap-1.5">
                              <button onClick={() => approveOne(s)} className="flex items-center gap-1 px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded transition-colors">
                                <Check size={13} />承認
                              </button>
                              <button onClick={() => startEditSuggest(s)} className="flex items-center gap-1 px-2.5 py-1 border text-gray-600 hover:bg-gray-50 text-xs rounded transition-colors">
                                <Pencil size={12} />編集して確定
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {/* 店舗設定 */}
          <div className="bg-white rounded-xl border shadow-sm p-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">店舗設定（デフォルト値）</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-gray-500">店舗名</label>
                <input
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">デフォルト原価率（%）</label>
                <input
                  type="number" min={0} max={100} step={1}
                  value={costPct}
                  onChange={(e) => setCostPct(Number(e.target.value))}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">デフォルト経費率（%）</label>
                <input
                  type="number" min={0} max={100} step={1}
                  value={expensePct}
                  onChange={(e) => setExpensePct(Number(e.target.value))}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">発注アラート閾値（日）</label>
                <input
                  type="number" min={1} max={120} step={1}
                  value={restockDays}
                  onChange={(e) => setRestockDays(Number(e.target.value))}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-3">
              デフォルト原価率は、商品別に率が未設定の商品へ適用されます。変更するとRPP売上原価が再計算されます。
              発注アラート閾値は、在庫がこの日数分を切った商品を「在庫僅少」として先読み発注に出す基準です。
            </p>
            <div className="mt-4">
              <button
                onClick={saveShop}
                className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Save size={15} />店舗設定を保存
              </button>
            </div>
          </div>

          {/* 商品マスタ一覧 */}
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
              <h3 className="text-sm font-semibold text-gray-700">商品マスタ</h3>
              <div className="flex items-center gap-3">
                <button
                  onClick={exportCsv}
                  className="flex items-center gap-1.5 text-xs text-gray-600 border rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition-colors"
                >
                  <Download size={13} />CSVエクスポート
                </button>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 border rounded-lg px-2.5 py-1.5 hover:bg-gray-50 cursor-pointer transition-colors">
                  <Upload size={13} />CSVインポート
                  <input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = '' }}
                  />
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                  <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded border-gray-300" />
                  廃盤も表示
                </label>
              </div>
            </div>

            {!loading && visibleRows.length === 0 && (
              <div className="py-12 text-center text-sm text-gray-400">
                商品マスタがまだありません。CSVを取込むか backfill スクリプトで生成してください。
              </div>
            )}

            {visibleRows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="px-4 py-2.5 text-left">管理番号</th>
                      <th className="px-3 py-2.5 text-left">商品名</th>
                      <th className="px-3 py-2.5 text-left">ジャンル</th>
                      <th className="px-3 py-2.5 text-right">原価率</th>
                      <th className="px-3 py-2.5 text-center">状態</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visibleRows.map((r) => (
                      <tr key={r.management_no} className={r.is_active ? '' : 'bg-gray-50/60'}>
                        <td className="px-4 py-2 text-gray-500 font-mono text-xs whitespace-nowrap">{r.management_no}</td>
                        <td className="px-3 py-2">
                          <input
                            defaultValue={r.product_name ?? ''}
                            onBlur={(e) => saveName(r, e.target.value.trim())}
                            className="w-full min-w-[140px] bg-transparent border border-transparent hover:border-gray-200 focus:border-blue-400 rounded px-1.5 py-1 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={r.category_id ?? ''}
                            onChange={(e) => saveCategory(r, e.target.value === '' ? null : Number(e.target.value))}
                            className="max-w-[180px] text-xs text-gray-600 border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">未分類</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>{categoryPath(c)}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <input
                              type="number" min={0} max={100} step={1}
                              defaultValue={Math.round(r.cost_rate * 100)}
                              onBlur={(e) => saveRate(r, Number(e.target.value))}
                              className="w-16 text-right border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <span className="text-gray-400 text-xs">%</span>
                            <span className={`text-[10px] px-1 py-0.5 rounded ${r.cost_source === 'product' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                              {r.cost_source === 'product' ? '個別' : '既定'}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => toggleActive(r)}
                            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                              r.is_active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                            }`}
                          >
                            {r.is_active ? '稼働中' : '廃盤'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-xs text-gray-400">
            原価率は「商品別（個別）→ 店舗デフォルト（既定）」の順で適用されます。値を変更するとRPP売上原価が自動で再計算され、GP・ROI・Rev等に反映されます。
          </p>

          {/* カテゴリ管理 */}
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b">
              <h3 className="text-sm font-semibold text-gray-700">カテゴリ管理</h3>
              <p className="text-xs text-gray-400 mt-0.5">大分類 &gt; 中分類 &gt; 小分類。取込みで自動生成されたカテゴリの整理や、手動追加ができます。</p>
            </div>

            {/* 新規作成フォーム */}
            <div className="px-4 py-3 border-b bg-gray-50 flex flex-wrap items-center gap-2">
              <input
                value={newCat.genre_u1}
                onChange={(e) => setNewCat({ ...newCat, genre_u1: e.target.value })}
                placeholder="大分類"
                className="w-32 border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-gray-300">&gt;</span>
              <input
                value={newCat.genre_u2}
                onChange={(e) => setNewCat({ ...newCat, genre_u2: e.target.value })}
                placeholder="中分類"
                className="w-32 border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-gray-300">&gt;</span>
              <input
                value={newCat.genre_u3}
                onChange={(e) => setNewCat({ ...newCat, genre_u3: e.target.value })}
                placeholder="小分類"
                className="w-32 border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                onClick={addCategory}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Plus size={14} />追加
              </button>
            </div>

            {categories.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">カテゴリがまだありません</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {categories.map((c) => (
                  <li key={c.id} className="px-4 py-2.5 flex items-center gap-2">
                    {editingCatId === c.id ? (
                      <>
                        <input value={editCat.genre_u1} onChange={(e) => setEditCat({ ...editCat, genre_u1: e.target.value })} placeholder="大分類" className="w-28 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <span className="text-gray-300">&gt;</span>
                        <input value={editCat.genre_u2} onChange={(e) => setEditCat({ ...editCat, genre_u2: e.target.value })} placeholder="中分類" className="w-28 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <span className="text-gray-300">&gt;</span>
                        <input value={editCat.genre_u3} onChange={(e) => setEditCat({ ...editCat, genre_u3: e.target.value })} placeholder="小分類" className="w-28 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        <div className="ml-auto flex items-center gap-1">
                          <button onClick={saveEditCat} className="p-1.5 text-green-600 hover:bg-green-50 rounded" title="保存"><Check size={15} /></button>
                          <button onClick={() => setEditingCatId(null)} className="p-1.5 text-gray-400 hover:bg-gray-100 rounded" title="取消"><X size={15} /></button>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="text-sm text-gray-800">{categoryPath(c)}</span>
                        <div className="ml-auto flex items-center gap-1">
                          <button onClick={() => startEditCat(c)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded" title="リネーム"><Pencil size={14} /></button>
                          <button onClick={() => removeCategory(c)} className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="削除"><Trash2 size={14} /></button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
