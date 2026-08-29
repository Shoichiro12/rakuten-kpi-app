import { useEffect, useState, useCallback } from 'react'
import { Plus, Trash2, Pencil, Check, X, Download, Upload, CheckCircle } from 'lucide-react'
import Header from '../components/layout/Header'
import GenrePicker from '../components/GenrePicker'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import { api } from '../lib/api'
import type { Category, GenreTree } from '../types'

function categoryPath(c: Category): string {
  return [c.genre_u1, c.genre_u2, c.genre_u3].filter(Boolean).join(' > ') || '（空カテゴリ）'
}

/**
 * カテゴリマスタ（product_categories）専用ページ（マスタCRUD規約2026-08-22 区切り4）。
 * 商品マスタから独立させた。商品への割当は商品マスタ側のカテゴリ列（FK選択）で行う。
 */
export default function CategoryMaster() {
  const [categories, setCategories] = useState<Category[]>([])
  const [genreTree, setGenreTree] = useState<GenreTree>({})
  const [loading, setLoading] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  const [newCat, setNewCat] = useState({ genre_u1: '', genre_u2: '', genre_u3: '' })
  const [editingCatId, setEditingCatId] = useState<number | null>(null)
  const [editCat, setEditCat] = useState({ genre_u1: '', genre_u2: '', genre_u3: '' })
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)
  const [deleting, setDeleting] = useState(false)

  // 一括削除（マスタ削除一括化計画書2026-08-28 区切り2）
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const flash = (msg: string) => {
    setSavedMsg(msg)
    setTimeout(() => setSavedMsg(null), 2500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [catRes, treeRes] = await Promise.all([api.master.categories(), api.master.genreTree()])
      setCategories(catRes.items)
      setGenreTree(treeRes)
    } catch (e) {
      console.error('[CategoryMaster] 取得エラー:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 一覧が更新されたら、既に存在しないカテゴリの選択状態を除去する（単件削除等との整合）
  useEffect(() => {
    setSelectedIds((prev) => {
      const validIds = new Set(categories.map((c) => c.id))
      const next = new Set(Array.from(prev).filter((id) => validIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [categories])

  const addCategory = async () => {
    if (!newCat.genre_u1.trim() && !newCat.genre_u2.trim() && !newCat.genre_u3.trim()) return
    try {
      await api.master.createCategory(newCat)
      setNewCat({ genre_u1: '', genre_u2: '', genre_u3: '' })
      await load()
      flash('カテゴリを作成しました')
    } catch (e) {
      console.error('[CategoryMaster] 作成エラー:', e)
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
      console.error('[CategoryMaster] 更新エラー:', e)
      flash('更新に失敗しました（同名カテゴリの可能性）')
    }
  }

  const confirmRemoveCategory = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await api.master.deleteCategory(deleteTarget.id)
      await load()
      flash(`カテゴリを削除しました（${res.detached_products}商品を未分類化）`)
    } catch (e) {
      console.error('[CategoryMaster] 削除エラー:', e)
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  const toggleSelectOne = (id: number, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(categories.map((c) => c.id)) : new Set())
  }

  /** 選択したカテゴリの一括削除（評定確定: 要求件数と実削除件数が食い違う場合は実数を明示する） */
  const confirmBulkDeleteCategories = async () => {
    if (selectedIds.size === 0) return
    setBulkDeleting(true)
    try {
      const ids = Array.from(selectedIds)
      const res = await api.master.bulkDeleteCategories(ids)
      const requested = res.requested ?? ids.length
      const deletedCount = res.deleted_ids?.length ?? 0
      setSelectedIds(new Set())
      await load()
      flash(
        deletedCount === requested
          ? `${deletedCount}件のカテゴリを削除しました（${res.detached_products}商品を未分類化）`
          : `${requested}件中${deletedCount}件を削除しました（他のタブ等で先に削除されていた可能性があります。${res.detached_products}商品を未分類化）`,
      )
    } catch (e) {
      console.error('[CategoryMaster] 一括削除エラー:', e)
      flash('一括削除に失敗しました')
    } finally {
      setBulkDeleting(false)
      setBulkConfirmOpen(false)
    }
  }

  const exportCsv = async () => {
    try {
      await api.master.exportCategoriesCsv()
    } catch (e) {
      console.error('[CategoryMaster] CSVエクスポートエラー:', e)
    }
  }

  const importCsv = async (file: File) => {
    try {
      const res = await api.master.importCategoriesCsv(file)
      await load()
      flash(`CSV取込み完了（新規${res?.created ?? 0} / 更新${res?.updated ?? 0}件）`)
    } catch (e) {
      console.error('[CategoryMaster] CSVインポートエラー:', e)
      flash('CSV取込みに失敗しました')
    }
  }

  return (
    <div className="h-full flex flex-col">
      <Header
        title="カテゴリマスタ"
        subtitle="大分類 > 中分類 > 小分類。商品への割当は商品マスタ側で行います"
        actions={
          <div className="flex items-center gap-2">
            {savedMsg && (
              <span className="flex items-center gap-1.5 text-xs text-green-600"><CheckCircle size={13} />{savedMsg}</span>
            )}
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
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-6">
        <div className="bg-paper rounded-xl border border-line shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-sm font-semibold text-sub">カテゴリ一覧</h3>
              <p className="text-xs text-muted mt-0.5">
                取込みで自動生成されたカテゴリの整理や、手動追加ができます。削除したカテゴリに割り当てられていた商品は「未分類」に戻ります。
              </p>
            </div>
            {selectedIds.size > 0 && (
              <button
                onClick={() => setBulkConfirmOpen(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-white bg-alert hover:opacity-90 rounded-lg px-3 py-1.5 transition-opacity"
              >
                <Trash2 size={13} />選択した{selectedIds.size}件を削除
              </button>
            )}
          </div>

          {/* 新規作成フォーム（楽天ジャンルマスタから選択＋自由入力） */}
          <div className="px-4 py-3 border-b border-line bg-bg-alt flex flex-wrap items-center gap-2">
            <GenrePicker
              tree={genreTree}
              value={newCat}
              onChange={(g) => setNewCat(g)}
            />
            <button
              onClick={addCategory}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-ink-strong hover:bg-ink text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Plus size={14} />追加
            </button>
          </div>

          {loading ? (
            <div className="py-8 text-center text-sm text-muted">読み込み中…</div>
          ) : categories.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted">カテゴリがまだありません</div>
          ) : (
            <>
              <div className="px-4 py-1.5 border-b border-line bg-bg-alt/60">
                <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none w-fit">
                  <input
                    type="checkbox"
                    checked={selectedIds.size > 0 && selectedIds.size === categories.length}
                    onChange={(e) => toggleSelectAll(e.target.checked)}
                    className="rounded border-line"
                  />
                  全選択
                </label>
              </div>
              <ul className="divide-y divide-bg-alt">
                {categories.map((c) => (
                  <li key={c.id} className="px-4 py-2.5 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(c.id)}
                      onChange={(e) => toggleSelectOne(c.id, e.target.checked)}
                      className="rounded border-line shrink-0"
                      aria-label={`${categoryPath(c)}を選択`}
                    />
                    {editingCatId === c.id ? (
                      <>
                        <input value={editCat.genre_u1} onChange={(e) => setEditCat({ ...editCat, genre_u1: e.target.value })} placeholder="大分類" className="w-28 border border-line rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sage-deep" />
                        <span className="text-line">&gt;</span>
                        <input value={editCat.genre_u2} onChange={(e) => setEditCat({ ...editCat, genre_u2: e.target.value })} placeholder="中分類" className="w-28 border border-line rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sage-deep" />
                        <span className="text-line">&gt;</span>
                        <input value={editCat.genre_u3} onChange={(e) => setEditCat({ ...editCat, genre_u3: e.target.value })} placeholder="小分類" className="w-28 border border-line rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sage-deep" />
                        <div className="ml-auto flex items-center gap-1">
                          <button onClick={saveEditCat} className="p-1.5 text-green-600 hover:bg-green-50 rounded" title="保存"><Check size={15} /></button>
                          <button onClick={() => setEditingCatId(null)} className="p-1.5 text-muted hover:bg-bg-alt rounded" title="取消"><X size={15} /></button>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="text-sm text-ink">{categoryPath(c)}</span>
                        <div className="ml-auto flex items-center gap-1">
                          <button onClick={() => startEditCat(c)} className="p-1.5 text-muted hover:bg-bg-alt rounded" title="リネーム"><Pencil size={14} /></button>
                          <button onClick={() => setDeleteTarget(c)} className="p-1.5 text-alert hover:bg-alert-bg rounded" title="削除"><Trash2 size={14} /></button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <ConfirmDeleteModal
        open={deleteTarget != null}
        title="カテゴリを削除しますか"
        message={deleteTarget ? `「${categoryPath(deleteTarget)}」を削除します。このカテゴリに割り当てられている商品は「未分類」に戻ります。` : ''}
        onConfirm={confirmRemoveCategory}
        onCancel={() => setDeleteTarget(null)}
        loading={deleting}
      />

      <ConfirmDeleteModal
        open={bulkConfirmOpen}
        title="選択したカテゴリを削除しますか"
        message={`「${selectedIds.size}件のカテゴリ」を削除します。割り当てられている商品は「未分類」に戻ります。`}
        onConfirm={confirmBulkDeleteCategories}
        onCancel={() => setBulkConfirmOpen(false)}
        loading={bulkDeleting}
      />
    </div>
  )
}
