import { useState } from 'react'

/**
 * マスタ画面の「セル編集 → まとめて一括保存」を共通化するフック（EditableGrid共通化。
 * 計画書 docs/jisso_keikaku_input_ia_seiri_2026-08-22.md 区切り3）。
 *
 * 元は目標設定画面のアイテム別目標一括編集（pendingバッファ・未保存バッジ・一括保存・
 * 絞り込み）に直書きされていたロジックをコンポーネントに昇格させたもの。
 * テーブルの見た目（列構成・行のレンダリング）は画面側が持つ。このフックは
 * 「編集中の値をどう保持し、いつ保存扱いにするか」という振る舞いだけを提供する。
 *
 * 表示・保存は文字列で扱う（number型に丸めるのはAPI呼び出し直前）。
 */
export interface UseEditableGridOptions<T> {
  rows: T[]
  /** 行を一意に識別するキー（保存APIのキーと一致させること） */
  rowKey: (row: T) => string
  /** 保存済みの値（文字列化）。未設定なら空文字を返すこと */
  getSavedValue: (row: T) => string
  /** 編集中の値が「有効な入力」とみなせるか（既定: 空でなければ有効） */
  isValidValue?: (value: string) => boolean
  /** dirtyRows をまとめてAPIへ送る処理。成功したら pending を空にする */
  onBulkSave: (entries: { row: T; rowKey: string; value: string }[]) => Promise<void>
}

export function useEditableGrid<T>({
  rows,
  rowKey,
  getSavedValue,
  isValidValue = (v) => v.trim() !== '',
  onBulkSave,
}: UseEditableGridOptions<T>) {
  const [pending, setPending] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  /** 入力欄に出す値。編集中があればそれを、無ければ保存済みの値を返す */
  const displayValue = (row: T): string => {
    const key = rowKey(row)
    return key in pending ? pending[key] : getSavedValue(row)
  }

  /** その行が「保存されていない有効な変更」を持つか */
  const isDirty = (row: T): boolean => {
    const key = rowKey(row)
    if (!(key in pending)) return false
    const value = pending[key]
    if (!isValidValue(value)) return false
    return value !== getSavedValue(row)
  }

  const dirtyRows = rows.filter(isDirty)

  const setValue = (row: T, value: string) => {
    setPending((prev) => ({ ...prev, [rowKey(row)]: value }))
  }

  const clearPending = () => setPending({})

  const bulkSave = async () => {
    const entries = dirtyRows.map((row) => ({ row, rowKey: rowKey(row), value: pending[rowKey(row)] }))
    if (entries.length === 0) return
    setSaving(true)
    try {
      await onBulkSave(entries)
      clearPending()
    } finally {
      setSaving(false)
    }
  }

  return { pending, displayValue, isDirty, dirtyRows, setValue, clearPending, bulkSave, saving }
}
