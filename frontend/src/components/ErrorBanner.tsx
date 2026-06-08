import { AlertTriangle, X } from 'lucide-react'

interface ErrorBannerProps {
  message: string
  /** ✕ボタンの動作。指定時のみ閉じるボタンを表示する。 */
  onClose?: () => void
  /** アクションボタンのラベル（例: 「再ログイン」）。onAction とセットで表示。 */
  actionLabel?: string
  onAction?: () => void
}

/**
 * 汎用エラーバナー。認証エラー時の「再ログイン」CTA と「✕閉じる」ボタンを任意で表示できる。
 * 各ページのエラー表示に再利用する。
 */
export default function ErrorBanner({ message, onClose, actionLabel, onAction }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      <AlertTriangle size={16} className="text-red-500 shrink-0" />
      <span className="flex-1">{message}</span>
      <div className="flex items-center gap-2 shrink-0">
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            className="px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-medium transition-colors"
          >
            {actionLabel}
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="text-red-400 hover:text-red-600 transition-colors"
          >
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
