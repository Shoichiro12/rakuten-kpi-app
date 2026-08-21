import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { FOCUS_RING } from '../lib/a11y'

interface ConfirmDeleteModalProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  checkboxLabel?: string
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}

/**
 * 全削除系の確認ダイアログ（マスタCRUD規約2026-08-22）。
 * window.confirm（OK/キャンセルのみ）ではなく、チェックボックスを入れないと
 * 削除ボタンが押せない構造にすることで、誤操作の防止をもう1段強める。
 * 影響が大きい削除（実績データ全削除・サンプル削除等）で使う。1件ずつの
 * 行削除（商品・カテゴリ等）はこのモーダルまで要求しない（計画書区切り1〜7）。
 */
export default function ConfirmDeleteModal({
  open,
  title,
  message,
  confirmLabel = '削除する',
  checkboxLabel = '本当に削除しますか',
  onConfirm,
  onCancel,
  loading = false,
}: ConfirmDeleteModalProps) {
  const [checked, setChecked] = useState(false)

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
    >
      <div className="bg-paper rounded-xl border border-line shadow-xl w-full max-w-md p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-alert shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id="confirm-delete-title" className="text-sm font-bold text-ink">
              {title}
            </h2>
            <p className="text-xs text-sub mt-1.5 leading-relaxed whitespace-pre-line">{message}</p>
          </div>
        </div>

        <label className="flex items-center gap-2 mt-4 px-3 py-2.5 bg-alert-bg rounded-lg cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className={`rounded border-line ${FOCUS_RING}`}
          />
          <span className="text-xs font-medium text-alert">{checkboxLabel}</span>
        </label>

        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={() => {
              setChecked(false)
              onCancel()
            }}
            disabled={loading}
            className={`px-4 py-2 text-sm text-sub hover:bg-bg-alt rounded-lg disabled:opacity-50 ${FOCUS_RING}`}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm()
              setChecked(false)
            }}
            disabled={!checked || loading}
            className={`px-4 py-2 text-sm font-medium text-white bg-alert hover:opacity-90 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-opacity ${FOCUS_RING}`}
          >
            {loading ? '処理中...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
