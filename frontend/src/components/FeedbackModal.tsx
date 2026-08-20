import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Bug, Check, Lightbulb, LogOut, MessageSquare, Send, X } from 'lucide-react'
import { api } from '../lib/api'

export type FeedbackCategory = 'bug' | 'request' | 'other' | 'cancel'
type Category = FeedbackCategory

/**
 * ルーター配下のどの画面からでもフィードバック窓口を開くためのイベント。
 * モーダルの表示状態は App.tsx が持っているため、深い階層のページ（Billing等）からは
 * props のバケツリレーではなくこのイベントで依頼する。
 */
export const OPEN_FEEDBACK_EVENT = 'ureshiru:open-feedback'

/** フィードバック窓口を開く（category を指定するとその種別が選択済みで開く） */
export function requestOpenFeedback(category: FeedbackCategory = 'bug') {
  window.dispatchEvent(new CustomEvent(OPEN_FEEDBACK_EVENT, { detail: { category } }))
}

const CATEGORIES: { value: Category; label: string; icon: typeof Bug; hint: string }[] = [
  { value: 'bug', label: '不具合の報告', icon: Bug, hint: '動かない・表示がおかしい・数値が合わない など' },
  { value: 'request', label: '改善の要望', icon: Lightbulb, hint: 'こういう機能がほしい・ここが使いにくい など' },
  { value: 'other', label: 'その他', icon: MessageSquare, hint: '質問・感想など何でも' },
  // 解約はポータルの自己完結ボタンではなく問い合わせ経由で受け付ける方針
  // （受付から2〜3営業日以内に手続き完了。CLAUDE.md 申し送り参照）
  { value: 'cancel', label: '解約について', icon: LogOut, hint: '解約のご依頼・解約に関するご相談' },
]

/**
 * フィードバック窓口（不具合報告・要望）。サイドバーの「不具合・要望を送る」から開く。
 *
 * 利用者の声を拾うための最小構成: 種別＋自由記述だけ。
 * 開いていた画面のパスとブラウザ情報は自動で添付されるので、
 * 利用者に環境を書かせる必要はない（書く手間があると報告されなくなる）。
 * 通知は NOTIFY_EMAIL 宛のメール（backend/notifications.py）。
 */
export default function FeedbackModal({
  onClose,
  initialCategory = 'bug',
}: {
  onClose: () => void
  /** 開いた時点で選択しておく種別（Billingの「解約について問い合わせる」は 'cancel' で開く） */
  initialCategory?: Category
}) {
  const location = useLocation()
  const [category, setCategory] = useState<Category>(initialCategory)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!message.trim()) {
      setError('内容を入力してください。')
      return
    }
    setSending(true)
    setError(null)
    try {
      await api.feedback.send({
        category,
        message: message.trim(),
        page: location.pathname,
      })
      setDone(true)
    } catch (e) {
      console.error('[Feedback] 送信エラー:', e)
      setError('送信に失敗しました。時間をおいて再度お試しください。')
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <div className="text-center py-4">
            <div className="w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto mb-3">
              <Check size={20} />
            </div>
            <p className="text-sm font-semibold text-gray-900 mb-1">送信しました。ありがとうございます。</p>
            <p className="text-xs text-gray-500">
              {category === 'cancel'
                ? '解約のご依頼を受け付けました。2〜3営業日以内に手続きを完了し、ご登録のメールアドレスへご連絡します。手続き完了まで、現在の請求期間内は引き続きサービスをご利用いただけます。'
                : 'いただいた内容はサービス改善に活用します。'}
            </p>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 border text-sm text-gray-600 rounded-lg hover:bg-gray-50"
            >
              閉じる
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-800">不具合・要望を送る</h3>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="閉じる">
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              お気づきの点をお聞かせください。開いている画面の情報は自動で添付されます。
            </p>

            <div className="space-y-2 mb-3">
              {CATEGORIES.map(({ value, label, icon: Icon, hint }) => (
                <button
                  key={value}
                  onClick={() => setCategory(value)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                    category === value
                      ? 'border-blue-400 bg-blue-50/60 ring-1 ring-blue-400/40'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <Icon size={16} className={category === value ? 'text-blue-600' : 'text-gray-400'} />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-gray-800">{label}</span>
                    <span className="block text-xs text-gray-400">{hint}</span>
                  </span>
                </button>
              ))}
            </div>

            <textarea
              className="w-full border rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 h-28 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                category === 'bug'
                  ? '例: RPPのCSVを取り込むと「◯◯」というエラーが出ます。ファイルは今週の週次レポートです。'
                  : category === 'cancel'
                    ? '例: 解約を希望します。（差し支えなければ理由もお聞かせください）'
                    : '内容をご記入ください'
              }
            />

            {error && (
              <div className="mt-2 bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              onClick={submit}
              disabled={sending}
              className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-900 hover:bg-gray-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Send size={15} /> {sending ? '送信中…' : '送信する'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
