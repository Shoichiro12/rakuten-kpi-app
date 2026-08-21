import { useEffect, useState, useCallback, useRef } from 'react'
import { Save, CheckCircle, RefreshCw, Plus, Trash2, Pencil, Check, X, Download, Upload, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'
import Header from '../components/layout/Header'
import GenrePicker from '../components/GenrePicker'
import { useTableSort } from '../components/table/useTableSort'
import SortableTh from '../components/table/SortableTh'
import { useEditableGrid } from '../components/grid/useEditableGrid'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import { api } from '../lib/api'
import { getCurrentYearMonth } from '../lib/utils'
import type { MasterProduct, CostItem, Category, SuggestionItem, GenreTree, GenreValue, GenreBenchmarkItem, ItemTargetListEntry } from '../types'

/** 管理番号ごとに商品マスタ情報＋適用中の原価率をまとめた1行。 */
interface Row extends MasterProduct {
  cost_rate: number
  cost_source: 'product' | 'default'
}

/** 商品マスタ一覧の1ページあたりの表示件数（縦スクロール対策・2026-08-20） */
const MASTER_PAGE_SIZE = 50

/** アイテム別目標テーブルのソート用アクセサ（target配下・直近実績のネスト値） */
const ITEM_SORT_ACCESSORS = {
  product_name: (r: ItemTargetListEntry) => r.product_name ?? r.management_no,
  target_sales: (r: ItemTargetListEntry) => r.target?.target_sales ?? null,
  target_cvr: (r: ItemTargetListEntry) => r.target?.target_cvr ?? null,
  target_av: (r: ItemTargetListEntry) => r.target?.target_av ?? null,
  required_access: (r: ItemTargetListEntry) => r.target?.required_access ?? null,
}

type MasterTab = 'products' | 'itemTargets' | 'benchmarks' | 'suggestions'

export default function MasterSettings() {
  const [activeTab, setActiveTab] = useState<MasterTab>('products')
  const [rows, setRows] = useState<Row[]>([])
  const masterSort = useTableSort<Row>()
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(true)
  // 一覧の検索・ページング（2026-08-20）
  const [masterKw, setMasterKw] = useState('')
  const [masterPage, setMasterPage] = useState(1)

  // 提案キュー（マスタ入力支援）
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([])
  // 提案の取得中フラグ（一覧とは別に取得するため。「計算中」の表示に使う）
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestOpen, setSuggestOpen] = useState(true)
  const [editingSuggestId, setEditingSuggestId] = useState<string | null>(null)
  const [editSuggest, setEditSuggest] = useState<{ genre: GenreValue; cost_pct: number }>({ genre: { genre_u1: '', genre_u2: '', genre_u3: '' }, cost_pct: 60 })

  // 楽天ジャンルマスタ（カテゴリ選択ピッカー用）
  const [genreTree, setGenreTree] = useState<GenreTree>({})

  // 店舗設定フォーム
  const [shopName, setShopName] = useState('')
  const [costPct, setCostPct] = useState(60)
  const [expensePct, setExpensePct] = useState(15)
  const [restockDays, setRestockDays] = useState(14)

  // カテゴリのCRUD（追加・リネーム・削除）は独立ページへ移設済み（区切り4）。
  // ここでは商品への割当（FK選択）のために一覧だけ取得して使う。

  // ジャンル別ベンチマーク手入力（RMS表示値。診断の基準①として最優先で使われる）
  const [benchmarks, setBenchmarks] = useState<GenreBenchmarkItem[]>([])
  const [newBench, setNewBench] = useState<{ genre: GenreValue; metric: 'page_cvr' | 'ad_cvr' | 'ctr'; value: string; memo: string }>({
    genre: { genre_u1: '', genre_u2: '', genre_u3: '' }, metric: 'page_cvr', value: '', memo: '',
  })

  // 商品削除（マスタCRUD規約2026-08-22 区切り5）。全一覧からの除外・実績は保持。
  const [deleteProductTarget, setDeleteProductTarget] = useState<Row | null>(null)
  const [deletingProduct, setDeletingProduct] = useState(false)

  // アイテム別目標（目標設定画面から移設。API・ロジックは無変更。区切り5）
  const [itemYearMonth, setItemYearMonth] = useState(getCurrentYearMonth())
  const [itemRows, setItemRows] = useState<ItemTargetListEntry[]>([])
  const [itemMsg, setItemMsg] = useState<string | null>(null)
  const [itemKw, setItemKw] = useState('')
  const [itemGenre, setItemGenre] = useState('')     // '' = すべて（genre_u1で絞る）
  const [itemUnsetOnly, setItemUnsetOnly] = useState(false)
  const itemSort = useTableSort<ItemTargetListEntry>(ITEM_SORT_ACCESSORS)

  const flashItem = (msg: string) => {
    setItemMsg(msg)
    setTimeout(() => setItemMsg(null), 2500)
  }

  const loadItemTargets = useCallback(async (ym: string) => {
    try {
      const res = await api.itemTargets.list(ym)
      setItemRows(res.items)
      itemGridRef.current.clearPending()   // 再取得したら編集中バッファは破棄（保存済みの値が正）
    } catch (e) {
      console.error('[MasterSettings] アイテム別目標取得エラー:', e)
      setItemRows([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // EditableGrid共通フック（マスタCRUD規約2026-08-22 区切り3）。
  const itemGrid = useEditableGrid<ItemTargetListEntry>({
    rows: itemRows,
    rowKey: (r) => r.management_no,
    getSavedValue: (r) => (r.target?.target_sales != null ? String(r.target.target_sales) : ''),
    isValidValue: (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 },
    onBulkSave: async (entries) => {
      const items = entries.map((e) => ({ management_no: e.rowKey, target_sales: Number(e.value) }))
      const res = await api.itemTargets.bulk(itemYearMonth, items)
      await loadItemTargets(itemYearMonth)
      flashItem(`${res?.saved_count ?? items.length}件の目標を保存し、目標CVR・客単価・必要アクセスを自動算出しました`)
    },
  })
  // loadItemTargets は空depsで安定参照にしたいため、最新の itemGrid を ref 経由で参照する
  const itemGridRef = useRef(itemGrid)
  itemGridRef.current = itemGrid

  useEffect(() => { loadItemTargets(itemYearMonth) }, [itemYearMonth, loadItemTargets])

  // ジャンル絞り込みの選択肢（大分類・重複排除）
  const itemGenreOptions = Array.from(
    new Set(itemRows.map((r) => r.genre_u1).filter((g): g is string => !!g)),
  ).sort()

  // 絞り込み結果（キーワード・ジャンル・未設定のみ）
  const filteredItemRows = itemRows.filter((r) => {
    if (itemGenre && r.genre_u1 !== itemGenre) return false
    if (itemUnsetOnly && r.target != null) return false
    if (itemKw) {
      const kw = itemKw.toLowerCase()
      const name = (r.product_name || '').toLowerCase()
      if (!name.includes(kw) && !r.management_no.toLowerCase().includes(kw)) return false
    }
    return true
  })

  const saveItemTargets = async () => {
    if (itemGrid.dirtyRows.length === 0) { flashItem('保存対象の変更がありません'); return }
    try {
      await itemGrid.bulkSave()
    } catch (e) {
      console.error('[MasterSettings] アイテム別目標の一括保存エラー:', e)
      flashItem('一括保存に失敗しました')
    }
  }

  const approveItemTarget = async (mno: string) => {
    try {
      await api.itemTargets.approve({ management_no: mno, year_month: itemYearMonth })
      await loadItemTargets(itemYearMonth)
      flashItem(`${mno} の参考値を確定しました（診断・逆算で使われます）`)
    } catch (e) {
      console.error('[MasterSettings] 参考値承認エラー:', e)
    }
  }

  const recalcItemTarget = async (mno: string) => {
    try {
      await api.itemTargets.recalc({ management_no: mno, year_month: itemYearMonth })
      await loadItemTargets(itemYearMonth)
      flashItem(`${mno} を最新の実績で再計算しました`)
    } catch (e) {
      console.error('[MasterSettings] 再計算エラー:', e)
    }
  }

  /** アイテム別目標の削除（2026-08-20 オーナー要望）。設定済みの目標行だけが対象 */
  const deleteItemTarget = async (mno: string) => {
    if (!window.confirm(`${mno} の ${itemYearMonth} のアイテム別目標を削除します。よろしいですか？`)) return
    try {
      await api.itemTargets.remove(mno, itemYearMonth)
      await loadItemTargets(itemYearMonth)
      flashItem(`${mno} の目標を削除しました`)
    } catch (e) {
      console.error('[MasterSettings] アイテム別目標の削除エラー:', e)
    }
  }

  const flash = (msg: string) => {
    setSavedMsg(msg)
    setTimeout(() => setSavedMsg(null), 2000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    // 自動提案は本体と切り離して並行取得する（2026-08-20 オーナー指摘）。
    // 従来は Promise.all に含めていたため、提案の計算が終わるまで商品一覧ごと
    // 表示されなかった。提案は「計算中」プレースホルダを先に出し、届き次第差し込む。
    setSuggestLoading(true)
    api.master.suggestions()
      .then((sugRes) => setSuggestions(sugRes.items))
      .catch((e: unknown) => { console.error('[MasterSettings] 提案取得エラー:', e); setSuggestions([]) })
      .finally(() => setSuggestLoading(false))
    try {
      const [prodRes, costRes, shopRes, catRes, treeRes, benchRes] = await Promise.all([
        api.master.products(),
        api.costs.list(),
        api.shops.me(),
        api.master.categories(),
        api.master.genreTree(),
        api.master.benchmarks(),
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
      setGenreTree(treeRes)
      setBenchmarks(benchRes.items)
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

  /** 商品マスタからの削除（ソフトデリート。マスタCRUD規約2026-08-22 区切り5）。
   * サンプル残骸（NEW-001等）や誤登録商品を一覧・診断・提案から完全に外すための操作。
   * 「廃盤」（稼働状態のトグル）とは別軸で、実績データは保持される。 */
  const confirmDeleteProduct = async () => {
    if (!deleteProductTarget) return
    setDeletingProduct(true)
    try {
      await api.master.deleteProduct(deleteProductTarget.management_no)
      await load()
      flash(`${deleteProductTarget.management_no} を削除しました`)
    } catch (e) {
      console.error('[MasterSettings] 商品削除エラー:', e)
    } finally {
      setDeletingProduct(false)
      setDeleteProductTarget(null)
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

  /** カテゴリID→大/中/小の値を引く（ピッカーの初期値用） */
  const genreOfCategory = (id: number | null): GenreValue => {
    const c = id != null ? categories.find((x) => x.id === id) : null
    return { genre_u1: c?.genre_u1 ?? '', genre_u2: c?.genre_u2 ?? '', genre_u3: c?.genre_u3 ?? '' }
  }

  /** 大/中/小の値からカテゴリを find-or-create し、商品へ割当てる（未選択なら未分類）。 */
  const assignGenre = async (r: Row, g: GenreValue) => {
    try {
      let categoryId: number | null = null
      if (g.genre_u1 || g.genre_u2 || g.genre_u3) {
        const cat = await api.master.createCategory(g) // 同一階層があれば既存を返す＝選択式＋追加
        categoryId = cat?.id ?? null
      }
      if (categoryId === (r.category_id ?? null)) return
      await api.master.updateProduct(r.management_no, { category_id: categoryId })
      await load() // 新規カテゴリ・行表示を反映
      flash(`${r.management_no} のカテゴリを更新しました`)
    } catch (e) {
      console.error('[MasterSettings] カテゴリ割当エラー:', e)
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

  /** ゲート用状態（フェーズ・ページ品質・投資許容・発売月）の更新 */
  const saveGateState = async (
    r: Row,
    data: Partial<Pick<MasterProduct, 'launch_month' | 'phase_override' | 'page_ready' | 'investment_intent'>>,
  ) => {
    try {
      await api.master.updateProduct(r.management_no, data)
      setRows((prev) => prev.map((x) => x.management_no === r.management_no ? { ...x, ...data } : x))
      flash(`${r.management_no} の提案設定を更新しました`)
    } catch (e) {
      console.error('[MasterSettings] 提案設定更新エラー:', e)
    }
  }

  // ベンチマーク手入力 ─────────────────────────
  const addBenchmark = async () => {
    const v = Number(newBench.value)
    if (!newBench.genre.genre_u1.trim() || !Number.isFinite(v) || v <= 0) {
      flash('大分類と0より大きい%値を入力してください')
      return
    }
    try {
      await api.master.upsertBenchmark({
        genre_u1: newBench.genre.genre_u1.trim(),
        genre_u2: newBench.genre.genre_u2.trim() || null,
        genre_u3: newBench.genre.genre_u3.trim() || null,
        metric: newBench.metric,
        value: v,
        memo: newBench.memo.trim() || null,
      })
      setNewBench({ genre: { genre_u1: '', genre_u2: '', genre_u3: '' }, metric: 'page_cvr', value: '', memo: '' })
      await load()
      flash('ベンチマークを保存しました')
    } catch (e) {
      console.error('[MasterSettings] ベンチマーク保存エラー:', e)
      flash('保存に失敗しました')
    }
  }

  const removeBenchmark = async (b: GenreBenchmarkItem) => {
    try {
      await api.master.deleteBenchmark(b.id)
      setBenchmarks((prev) => prev.filter((x) => x.id !== b.id))
      flash('ベンチマークを削除しました（自店集計→既定値へフォールバックします）')
    } catch (e) {
      console.error('[MasterSettings] ベンチマーク削除エラー:', e)
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
    const catId = s.current.category_id ?? s.suggested.category?.category_id ?? null
    setEditSuggest({
      genre: genreOfCategory(catId),
      cost_pct: s.current.cost_rate != null
        ? Math.round(s.current.cost_rate * 100)
        : Math.round(s.suggested.cost_rate.suggested_rate * 100),
    })
  }

  const confirmEditSuggest = async (s: SuggestionItem) => {
    try {
      // カテゴリ確定: ジャンル値から find-or-create して割当（未選択なら未分類）
      const g = editSuggest.genre
      let categoryId: number | null = null
      if (g.genre_u1 || g.genre_u2 || g.genre_u3) {
        const cat = await api.master.createCategory(g)
        categoryId = cat?.id ?? null
      }
      await api.master.updateProduct(s.management_no, { category_id: categoryId })
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
    <span className={`ml-1 text-xs px-1 py-0.5 rounded font-medium ${
      c === 'high' ? 'bg-sage-soft text-sage-deep' : 'bg-bg-alt text-muted'
    }`}>
      {c === 'high' ? '高信頼' : '要確認'}
    </span>
  )

  // 一覧の検索・ページング（2026-08-20 オーナー指摘: SKUが増えると縦スクロールが長すぎる）。
  // 全件描画はDOMも重くなるので、絞り込み → 列ソート → ページ切り出しの順で適用する。
  const activeFiltered = showInactive ? rows : rows.filter((r) => r.is_active)
  const visibleRows = masterKw
    ? activeFiltered.filter((r) => {
        const kw = masterKw.toLowerCase()
        return (
          r.management_no.toLowerCase().includes(kw) ||
          (r.product_name ?? '').toLowerCase().includes(kw) ||
          [r.genre_u1, r.genre_u2, r.genre_u3].filter(Boolean).join(' > ').toLowerCase().includes(kw)
        )
      })
    : activeFiltered
  const totalPages = Math.max(1, Math.ceil(visibleRows.length / MASTER_PAGE_SIZE))
  const safePage = Math.min(masterPage, totalPages)
  const sortedRows = masterSort.apply(visibleRows)
  const pagedRows = sortedRows.slice((safePage - 1) * MASTER_PAGE_SIZE, safePage * MASTER_PAGE_SIZE)
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
              className="flex items-center gap-2 px-3 py-2 bg-white border text-sub hover:bg-bg-alt text-sm font-medium rounded-lg transition-colors"
            >
              <RefreshCw size={14} />原価を全再計算
            </button>
          )
        }
      />

      {/* タブ（DB構造ベースの4分割。マスタCRUD規約2026-08-22 区切り5 §2） */}
      <div className="border-b border-line bg-white px-6">
        <nav className="flex gap-1 -mb-px" aria-label="商品マスタのタブ">
          {([
            { key: 'products', label: '商品' },
            { key: 'itemTargets', label: 'アイテム別目標' },
            { key: 'benchmarks', label: 'ベンチマーク' },
            { key: 'suggestions', label: '未確認の提案', badge: suggestions.length },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t.key ? 'border-ink-strong text-ink-strong' : 'border-transparent text-muted hover:text-sub'
              }`}
            >
              {t.label}
              {'badge' in t && t.badge > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      <div className="flex-1 overflow-auto p-6 bg-bg-alt">
        {/* 幅の上限は付けない（ダッシュボード・GAP・商品別KPI・RPPと同じ全幅）。
            列数の多いテーブルが画面幅を使い切れるようにするため。max-w-* を戻さないこと */}
        <div className="space-y-6">
          {/* ① 未確認の提案タブ（マスタ入力支援） */}
          {activeTab === 'suggestions' && <>
          {/* 提案の計算中は先にプレースホルダを出す（機能があること自体に気付けるように） */}
          {suggestLoading && suggestions.length === 0 && (
            <div className="bg-white rounded-xl border border-amber-200 shadow-sm max-w-5xl px-4 py-3 flex items-center gap-2 text-sm text-amber-800">
              <RefreshCw size={14} className="animate-spin text-amber-500" />
              カテゴリ・原価率の自動提案を計算しています…（一覧は先に操作できます）
            </div>
          )}
          {suggestions.length > 0 && (
            // ボタンを ml-auto で右端に寄せる作りなので、全幅だと本文とボタンが極端に離れる（CLAUDE.md「画面幅の規約」）
            <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden max-w-5xl">
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
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-sage-deep hover:bg-sage-deep text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    <Check size={13} />高信頼の提案をまとめて承認（{highCount}）
                  </button>
                )}
              </div>

              {suggestOpen && (
                <>
                  <p className="px-4 py-2 text-xs text-muted border-b bg-bg-alt/60">
                    取込で自動生成された商品のうち、カテゴリ・原価率が未確定のものです。「要確認」（低信頼）の提案は一括承認の対象外で、個別承認・編集のみになります。
                  </p>
                  <ul className="divide-y divide-bg-alt">
                    {suggestions.map((s) => (
                      <li key={s.management_no} className="px-4 py-3">
                        {editingSuggestId === s.management_no ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="min-w-[150px]">
                              <p className="text-sm font-medium text-ink-strong leading-tight">{s.product_name || '（名称未設定）'}</p>
                              <p className="text-xs text-muted font-mono">{s.management_no}</p>
                            </div>
                            <GenrePicker
                              tree={genreTree}
                              value={editSuggest.genre}
                              onChange={(g) => setEditSuggest((p) => ({ ...p, genre: g }))}
                              compact
                            />
                            <span className="inline-flex items-center gap-1">
                              <input
                                type="number" min={0} max={100} step={1}
                                value={editSuggest.cost_pct}
                                onChange={(e) => setEditSuggest((p) => ({ ...p, cost_pct: Number(e.target.value) }))}
                                className="w-16 text-right tabular-nums text-xs border border-line rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-sage-deep"
                              />
                              <span className="text-muted text-xs">%</span>
                            </span>
                            <div className="ml-auto flex items-center gap-1">
                              <button onClick={() => confirmEditSuggest(s)} className="flex items-center gap-1 px-2.5 py-1 bg-ink-strong hover:bg-ink text-white text-xs rounded"><Check size={13} />確定</button>
                              <button onClick={() => setEditingSuggestId(null)} className="p-1.5 text-muted hover:bg-bg-alt rounded" title="取消"><X size={15} /></button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 flex-wrap">
                            <div className="min-w-[150px]">
                              <p className="text-sm font-medium text-ink-strong leading-tight">{s.product_name || '（名称未設定）'}</p>
                              <p className="text-xs text-muted font-mono">{s.management_no}</p>
                            </div>
                            <div className="flex-1 min-w-[170px] text-xs">
                              <span className="text-muted">カテゴリ: </span>
                              {s.current.category_id != null ? (
                                <span className="text-muted">設定済み</span>
                              ) : s.suggested.category ? (
                                <span className="text-sub">
                                  {s.suggested.category.label}{confidenceBadge(s.suggested.category.confidence)}
                                  <span className="text-muted ml-1">{s.suggested.category.basis}</span>
                                </span>
                              ) : (
                                <span className="text-amber-600">提案なし（新規カテゴリ作成が必要）</span>
                              )}
                            </div>
                            <div className="min-w-[150px] text-xs">
                              <span className="text-muted">原価率: </span>
                              {s.current.cost_rate != null ? (
                                <span className="text-muted">設定済み {Math.round(s.current.cost_rate * 100)}%</span>
                              ) : (
                                <span className="text-sub">
                                  {Math.round(s.suggested.cost_rate.suggested_rate * 100)}%{confidenceBadge(s.suggested.cost_rate.confidence)}
                                  <span className="text-muted ml-1">{s.suggested.cost_rate.basis}</span>
                                </span>
                              )}
                            </div>
                            <div className="ml-auto flex items-center gap-1.5">
                              <button onClick={() => approveOne(s)} className="flex items-center gap-1 px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded transition-colors">
                                <Check size={13} />承認
                              </button>
                              <button onClick={() => startEditSuggest(s)} className="flex items-center gap-1 px-2.5 py-1 border text-sub hover:bg-bg-alt text-xs rounded transition-colors">
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
          </>}

          {/* ② 商品タブ */}
          {activeTab === 'products' && <>
          {/* 店舗設定 */}
          {/* 3列グリッド＋w-fullの入力欄。全幅だと店舗名の入力欄だけが極端に長くなる（CLAUDE.md「画面幅の規約」） */}
          <div className="bg-white rounded-xl border shadow-sm p-6 max-w-3xl">
            <h3 className="text-sm font-semibold text-sub mb-4">店舗設定（デフォルト値）</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-muted">店舗名</label>
                <input
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  className="mt-1 w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-deep"
                />
              </div>
              <div>
                <label className="text-xs text-muted">デフォルト原価率（%）</label>
                <input
                  type="number" min={0} max={100} step={1}
                  value={costPct}
                  onChange={(e) => setCostPct(Number(e.target.value))}
                  className="mt-1 w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-deep"
                />
              </div>
              <div>
                <label className="text-xs text-muted">デフォルト経費率（%）</label>
                <input
                  type="number" min={0} max={100} step={1}
                  value={expensePct}
                  onChange={(e) => setExpensePct(Number(e.target.value))}
                  className="mt-1 w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-deep"
                />
              </div>
              <div>
                <label className="text-xs text-muted">発注アラート閾値（日）</label>
                <input
                  type="number" min={1} max={120} step={1}
                  value={restockDays}
                  onChange={(e) => setRestockDays(Number(e.target.value))}
                  className="mt-1 w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sage-deep"
                />
              </div>
            </div>
            <p className="text-xs text-muted mt-3">
              デフォルト原価率は、商品別に率が未設定の商品へ適用されます。変更するとRPP売上原価が再計算されます。
              発注アラート閾値は、在庫がこの日数分を切った商品を「在庫僅少」として先読み発注に出す基準です。
            </p>
            <div className="mt-4">
              <button
                onClick={saveShop}
                className="flex items-center gap-2 px-4 py-2 bg-ink-strong hover:bg-ink text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Save size={15} />店舗設定を保存
              </button>
            </div>
          </div>

          {/* 商品マスタ一覧 */}
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-sm font-semibold text-sub">商品マスタ</h3>
                {/* 検索＋ページング（2026-08-20）。SKUが多い店舗で縦に伸びすぎないようにする */}
                <input
                  type="text"
                  value={masterKw}
                  onChange={(e) => { setMasterKw(e.target.value); setMasterPage(1) }}
                  placeholder="管理番号・商品名・ジャンルで検索"
                  className="w-64 text-sm border border-line rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-sage-deep"
                />
                <span className="text-xs text-muted tabular-nums">
                  {visibleRows.length.toLocaleString()}件{masterKw ? `（全${activeFiltered.length.toLocaleString()}件から絞り込み）` : ''}
                </span>
              </div>
              <div className="flex items-center gap-3">
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
                <label className="flex items-center gap-1.5 text-xs text-sub cursor-pointer select-none">
                  <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded border-line" />
                  廃盤も表示
                </label>
              </div>
            </div>

            {!loading && visibleRows.length === 0 && (
              <div className="py-12 text-center text-sm text-muted">
                {masterKw
                  ? '検索条件に一致する商品がありません。'
                  : '商品マスタがまだありません。CSVを取込むか backfill スクリプトで生成してください。'}
              </div>
            )}

            {visibleRows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-bg-alt text-xs text-muted">
                    <tr>
                      <SortableTh label="管理番号" sortKey="management_no" sort={masterSort} align="left" className="pl-1" />
                      <SortableTh label="商品名" sortKey="product_name" sort={masterSort} align="left" />
                      <SortableTh label="ジャンル" sortKey="genre_u1" sort={masterSort} align="left" />
                      <SortableTh label="原価率" sortKey="cost_rate" sort={masterSort} />
                      <th className="px-3 py-2.5 text-left">広告提案の状態</th>
                      <th className="px-3 py-2.5 text-center">状態</th>
                      <th className="px-3 py-2.5 text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bg-alt">
                    {pagedRows.map((r) => (
                      <tr key={r.management_no} className={r.is_active ? '' : 'bg-bg-alt/60'}>
                        <td className="px-4 py-2 text-muted font-mono text-xs whitespace-nowrap">{r.management_no}</td>
                        <td className="px-3 py-2">
                          <input
                            defaultValue={r.product_name ?? ''}
                            onBlur={(e) => saveName(r, e.target.value.trim())}
                            className="w-full min-w-[140px] bg-transparent border border-transparent hover:border-line focus:border-sage rounded px-1.5 py-1 focus:outline-none"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <GenrePicker
                            tree={genreTree}
                            value={{ genre_u1: r.genre_u1 ?? '', genre_u2: r.genre_u2 ?? '', genre_u3: r.genre_u3 ?? '' }}
                            onChange={(g) => assignGenre(r, g)}
                            compact
                          />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <input
                              type="number" min={0} max={100} step={1}
                              defaultValue={Math.round(r.cost_rate * 100)}
                              onBlur={(e) => saveRate(r, Number(e.target.value))}
                              className="w-16 text-right tabular-nums border border-line rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-sage-deep"
                            />
                            <span className="text-muted text-xs">%</span>
                            <span className={`text-xs px-1 py-0.5 rounded ${r.cost_source === 'product' ? 'bg-sage-soft text-sage-deep' : 'bg-bg-alt text-muted'}`}>
                              {r.cost_source === 'product' ? '個別' : '既定'}
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {/* ゲート用状態（診断・提案の前提。設計ドキュメント2-A / 3-A） */}
                          <div className="flex flex-col gap-1 min-w-[180px]">
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-xs text-muted w-14 shrink-0">フェーズ</span>
                              <select
                                value={r.phase_override ?? 'auto'}
                                onChange={(e) => {
                                  const v = e.target.value
                                  saveGateState(r, { phase_override: v === 'auto' ? null : (v as 'new' | 'established') })
                                }}
                                className="text-xs border border-line rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-2 focus:ring-sage-deep"
                                title="新商品は最初の3ヶ月を様子見期間とし、RPP診断の母数基準を50クリックに引き上げます。自動=発売月から判定"
                              >
                                <option value="auto">自動（発売+3ヶ月）</option>
                                <option value="new">新商品</option>
                                <option value="established">稼働済み</option>
                              </select>
                              <input
                                type="month"
                                value={r.launch_month ?? ''}
                                onChange={(e) => saveGateState(r, { launch_month: e.target.value || null })}
                                className="text-xs border border-line rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-2 focus:ring-sage-deep"
                                title="発売月。未入力は実績データの初出月から自動推定"
                              />
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-xs text-muted w-14 shrink-0">ページ</span>
                              <select
                                value={r.page_ready === null ? 'unknown' : r.page_ready ? 'ready' : 'not_ready'}
                                onChange={(e) => {
                                  const v = e.target.value
                                  saveGateState(r, { page_ready: v === 'unknown' ? null : v === 'ready' })
                                }}
                                className="text-xs border border-line rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-2 focus:ring-sage-deep"
                                title="「未完成」にすると、ページが完成するまで広告関連の提案を保留し「まずページ完成」を提案します"
                              >
                                <option value="unknown">未回答</option>
                                <option value="ready">完成</option>
                                <option value="not_ready">未完成</option>
                              </select>
                              <label
                                className="inline-flex items-center gap-1 text-xs text-muted cursor-pointer select-none"
                                title="新商品の低ROASを意図的な投資として許容する場合にチェック。診断の数値は変わらず、表示が注記付きになります"
                              >
                                <input
                                  type="checkbox"
                                  checked={r.investment_intent === true}
                                  onChange={(e) => saveGateState(r, { investment_intent: e.target.checked ? true : null })}
                                  className="rounded border-line"
                                />
                                投資許容
                              </label>
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => toggleActive(r)}
                            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                              r.is_active ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-line text-muted hover:bg-line'
                            }`}
                          >
                            {r.is_active ? '稼働中' : '廃盤'}
                          </button>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => setDeleteProductTarget(r)}
                            className="p-1.5 text-alert hover:bg-alert-bg rounded"
                            title="商品マスタから削除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ページャ（50件/ページ）。1ページに収まるときは出さない */}
            {visibleRows.length > MASTER_PAGE_SIZE && (
              <div className="px-4 py-2.5 border-t bg-bg-alt/60 flex items-center justify-between gap-3 flex-wrap">
                <span className="text-xs text-muted tabular-nums">
                  {((safePage - 1) * MASTER_PAGE_SIZE + 1).toLocaleString()}〜{Math.min(safePage * MASTER_PAGE_SIZE, visibleRows.length).toLocaleString()}件 / 全{visibleRows.length.toLocaleString()}件
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setMasterPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    className="px-2.5 py-1 text-xs border border-line rounded bg-white hover:bg-bg-alt disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    ← 前へ
                  </button>
                  <span className="text-xs text-muted tabular-nums px-1">{safePage} / {totalPages}</span>
                  <button
                    onClick={() => setMasterPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    className="px-2.5 py-1 text-xs border border-line rounded bg-white hover:bg-bg-alt disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    次へ →
                  </button>
                </div>
              </div>
            )}
          </div>
          <p className="text-xs text-muted">
            原価率は「商品別（個別）→ 店舗デフォルト（既定）」の順で適用されます。値を変更するとRPP売上原価が自動で再計算され、GP・ROI・Rev等に反映されます。
          </p>
          {/* カテゴリ管理は独立ページへ移設（マスタCRUD規約2026-08-22 区切り4。/master/categories） */}
          </>}

          {/* ③ アイテム別目標タブ（目標設定画面から移設。API・ロジックは無変更。区切り5） */}
          {activeTab === 'itemTargets' && (
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-sub">アイテム別目標</h3>
                    <p className="text-xs text-muted mt-0.5">
                      入力するのは目標売上だけ。目標CVR・客単価は「現状値と前年値の低い方」を自動採用し（保守的な確定公式）、必要アクセス数を逆算します。複数まとめて入力して「一括保存」できます。
                    </p>
                  </div>
                  <input
                    type="month"
                    value={itemYearMonth}
                    onChange={(e) => setItemYearMonth(e.target.value)}
                    className="border border-line rounded-lg px-3 py-2 text-sm text-sub focus:outline-none focus:ring-2 focus:ring-sage-deep"
                  />
                </div>
                {itemMsg && (
                  <span className="flex items-center gap-1.5 text-xs text-green-600"><CheckCircle size={13} />{itemMsg}</span>
                )}
              </div>

              {itemRows.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="text" value={itemKw} onChange={(e) => setItemKw(e.target.value)}
                    placeholder="商品名・管理番号で検索"
                    className="w-52 text-sm border border-line rounded px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-sage-deep"
                  />
                  {itemGenreOptions.length > 0 && (
                    <select
                      value={itemGenre} onChange={(e) => setItemGenre(e.target.value)}
                      className="text-sm border border-line rounded px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sage-deep"
                    >
                      <option value="">ジャンル（すべて）</option>
                      {itemGenreOptions.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  )}
                  <label className="flex items-center gap-1.5 text-sm text-sub cursor-pointer select-none">
                    <input type="checkbox" checked={itemUnsetOnly} onChange={(e) => setItemUnsetOnly(e.target.checked)} className="rounded" />
                    未設定のみ
                  </label>
                  <span className="text-xs text-muted">{filteredItemRows.length}件表示 / 全{itemRows.length}件</span>
                  <div className="ml-auto flex items-center gap-2">
                    {itemGrid.dirtyRows.length > 0 && (
                      <span className="text-xs text-amber-600">未保存 {itemGrid.dirtyRows.length}件</span>
                    )}
                    <button
                      onClick={saveItemTargets}
                      disabled={itemGrid.dirtyRows.length === 0 || itemGrid.saving}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sage-deep hover:bg-sage-deep disabled:bg-line disabled:cursor-not-allowed text-white text-sm font-medium rounded"
                    >
                      <Save size={14} />{itemGrid.saving ? '保存中…' : '一括保存'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {itemRows.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted">
                商品データがまだありません。商品分析CSVを取り込むと商品が表示されます。
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-bg-alt text-xs text-muted">
                    <tr>
                      <SortableTh label="商品" sortKey="product_name" sort={itemSort} align="left" className="pl-1" />
                      <SortableTh label="目標売上（入力）" sortKey="target_sales" sort={itemSort} />
                      <SortableTh label="目標CVR（%）" sortKey="target_cvr" sort={itemSort} />
                      <SortableTh label="目標客単価（円）" sortKey="target_av" sort={itemSort} />
                      <SortableTh label="必要アクセス（UU）" sortKey="required_access" sort={itemSort} />
                      <th className="px-3 py-2.5 text-left">根拠</th>
                      <th className="px-3 py-2.5 text-center whitespace-nowrap">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bg-alt">
                    {filteredItemRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-sm text-muted">
                          絞り込み条件に一致する商品がありません。
                        </td>
                      </tr>
                    ) : itemSort.apply(filteredItemRows).map((r) => {
                      const t = r.target
                      const dirty = itemGrid.isDirty(r)
                      return (
                        <tr key={r.management_no} className={dirty ? 'bg-amber-50/60' : undefined}>
                          <td className="px-4 py-2">
                            <p className="text-ink-strong leading-tight">{r.product_name || r.management_no}</p>
                            <p className="text-xs text-muted font-mono">{r.management_no}</p>
                            {r.latest_actual ? (
                              <p className="text-xs text-muted">
                                直近実績（{r.latest_actual.year_month}）: UU {r.latest_actual.access_uu.toLocaleString()} / CVR {r.latest_actual.cvr}% / 客単価 ¥{r.latest_actual.av.toLocaleString()}
                              </p>
                            ) : (
                              <p className="text-xs text-amber-600">実績データなし（保存すると参考値を推定します）</p>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            <span className="inline-flex items-center gap-1">
                              <span className="text-muted text-xs">¥</span>
                              <input
                                type="number" min={0} step={10000}
                                value={itemGrid.displayValue(r)}
                                placeholder="未設定"
                                onChange={(e) => itemGrid.setValue(r, e.target.value)}
                                className={`w-28 text-right border rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-sage-deep ${dirty ? 'border-amber-400 bg-white' : 'border-line'}`}
                              />
                              {dirty && <span className="text-xs text-amber-600">未保存</span>}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right text-sub">{t?.target_cvr != null ? String(t.target_cvr) : '—'}</td>
                          <td className="px-3 py-2 text-right text-sub">{t?.target_av != null ? Math.round(t.target_av).toLocaleString() : '—'}</td>
                          <td className="px-3 py-2 text-right font-medium text-ink-strong">
                            {t?.required_access != null ? Math.round(t.required_access).toLocaleString() : '—'}
                          </td>
                          <td className="px-3 py-2">
                            {!t ? (
                              <span className="text-xs text-line">—</span>
                            ) : t.calc_basis === 'rule' ? (
                              <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700" title={t.basis_detail ?? undefined}>
                                自動算出（確定公式）
                              </span>
                            ) : t.calc_basis === 'estimated' ? (
                              <span className="inline-flex items-center gap-1.5 flex-wrap">
                                <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700" title={t.basis_detail ?? undefined}>
                                  参考値（推定）
                                </span>
                                {t.estimated_approved ? (
                                  <>
                                    <span className="text-xs text-green-600">承認済み</span>
                                    <button
                                      onClick={() => recalcItemTarget(r.management_no)}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 border text-muted hover:bg-bg-alt text-xs rounded"
                                      title="最新の実績・推定で洗い直します"
                                    >
                                      <RefreshCw size={10} />再計算
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    onClick={() => approveItemTarget(r.management_no)}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-sage-deep hover:bg-sage-deep text-white text-xs font-medium rounded"
                                    title="承認するまで診断・逆算には使われません"
                                  >
                                    <Check size={10} />この参考値で確定
                                  </button>
                                )}
                              </span>
                            ) : (
                              <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-bg-alt text-muted" title={t.basis_detail ?? undefined}>
                                算出不能（データ待ち）
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {t ? (
                              <button
                                onClick={() => deleteItemTarget(r.management_no)}
                                className="inline-flex items-center gap-1 px-2 py-1 border border-line text-muted hover:text-red-600 hover:border-red-300 hover:bg-red-50 text-xs rounded transition-colors"
                                title="この商品のこの月の目標を削除します"
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
            <p className="px-4 py-2.5 text-xs text-muted border-t bg-bg-alt/60 leading-snug">
              計算式: 目標注文件数 = 目標売上 ÷ 目標客単価、必要アクセス数 = 目標注文件数 ÷ 目標CVR。
              実績が無い商品は同ジャンル・自店平均からの参考値を提示し、「この参考値で確定」を押すまで診断・逆算には使いません。
              商品分析CSVを取り込むと自動で再計算されます（実測が取れた商品は確定公式に自動切替）。
            </p>
          </div>
          )}

          {/* ④ ベンチマークタブ */}
          {activeTab === 'benchmarks' && <>
          {/* ジャンル別ベンチマーク手入力（アクション提案ロジック 3-B / 3-B'） */}
          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b">
              <h3 className="text-sm font-semibold text-sub">ジャンル別ベンチマーク（RMS表示値の手入力）</h3>
              <p className="text-xs text-muted mt-0.5">
                楽天RMSに表示される「同ジャンル・同規模店舗のベンチマーク値」を入力すると、診断の比較基準として最優先で使われます。
                未入力のジャンルは「自店の同ジャンル集計 → 汎用ベースライン（ページCVR 7% / 広告CVR 3〜5% / CTR 2%）」の順で自動的に代用されます。
              </p>
            </div>

            {/* 入力フォーム */}
            <div className="px-4 py-3 border-b bg-bg-alt flex flex-wrap items-center gap-2">
              <GenrePicker
                tree={genreTree}
                value={newBench.genre}
                onChange={(g) => setNewBench((p) => ({ ...p, genre: g }))}
                compact
              />
              <select
                value={newBench.metric}
                onChange={(e) => setNewBench((p) => ({ ...p, metric: e.target.value as 'page_cvr' | 'ad_cvr' | 'ctr' }))}
                className="text-xs border border-line rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sage-deep"
              >
                <option value="page_cvr">ページ全体CVR</option>
                <option value="ad_cvr">RPP広告経由CVR</option>
                <option value="ctr">CTR</option>
              </select>
              <span className="inline-flex items-center gap-1">
                <input
                  type="number" min={0} max={100} step={0.01}
                  value={newBench.value}
                  onChange={(e) => setNewBench((p) => ({ ...p, value: e.target.value }))}
                  placeholder="7.52"
                  className="w-20 text-right tabular-nums text-xs border border-line rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-sage-deep"
                />
                <span className="text-muted text-xs">%</span>
              </span>
              <input
                value={newBench.memo}
                onChange={(e) => setNewBench((p) => ({ ...p, memo: e.target.value }))}
                placeholder="出典メモ（例: RMS 2026-07 表示値）"
                className="w-52 text-xs border border-line rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-sage-deep"
              />
              <button
                onClick={addBenchmark}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-ink-strong hover:bg-ink text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Plus size={14} />保存
              </button>
            </div>

            {benchmarks.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted">
                手入力のベンチマークはまだありません（自店集計・汎用ベースラインで動作中）
              </div>
            ) : (
              <ul className="divide-y divide-bg-alt">
                {benchmarks.map((b) => (
                  <li key={b.id} className="px-4 py-2.5 flex items-center gap-3">
                    <span className="text-sm text-ink">
                      {[b.genre_u1, b.genre_u2, b.genre_u3].filter(Boolean).join(' > ')}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-sage-soft text-sage-deep font-medium">{b.metric_label}</span>
                    <span className="text-sm font-semibold text-ink-strong">{b.value}%</span>
                    {b.memo && <span className="text-xs text-muted">{b.memo}</span>}
                    <div className="ml-auto">
                      <button onClick={() => removeBenchmark(b)} className="p-1.5 text-red-500 hover:bg-red-50 rounded" title="削除">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          </>}
        </div>
      </div>

      <ConfirmDeleteModal
        open={deleteProductTarget != null}
        title="商品を削除しますか"
        message={deleteProductTarget ? `「${deleteProductTarget.product_name || deleteProductTarget.management_no}」（${deleteProductTarget.management_no}）を商品マスタから削除します。一覧・診断・提案からは除外されますが、過去の実績データは保持されます。` : ''}
        onConfirm={confirmDeleteProduct}
        onCancel={() => setDeleteProductTarget(null)}
        loading={deletingProduct}
      />
    </div>
  )
}
