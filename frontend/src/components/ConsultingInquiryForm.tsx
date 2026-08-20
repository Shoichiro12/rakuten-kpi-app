import { useState } from 'react'
import { Check, Send, X } from 'lucide-react'
import { api } from '../lib/api'

/**
 * ECコンサルの問い合わせフォーム。
 *
 * コンサルはアプリの課金には乗せず、ヒアリング → ボリューム別見積りの個別契約にするため、
 * ここでの送信はあくまで「連絡のきっかけ」。必須は 名前 / 会社名 / 連絡先メール の3つだけにして、
 * 入力の手間で問い合わせを取りこぼさないようにしている。
 */
export default function ConsultingInquiryForm({ onClose }: { onClose?: () => void }) {
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [scaleHint, setScaleHint] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    // 簡易バリデーション（必須3項目）
    const missing: string[] = []
    if (!name.trim()) missing.push('お名前')
    if (!company.trim()) missing.push('会社名')
    if (!email.trim()) missing.push('連絡先メール')
    if (missing.length > 0) {
      setError(`${missing.join('・')}を入力してください。`)
      return
    }
    if (!email.includes('@')) {
      setError('連絡先メールの形式を確認してください。')
      return
    }

    setSending(true)
    setError(null)
    try {
      await api.consulting.inquiry({
        name: name.trim(),
        company_name: company.trim(),
        scale_hint: scaleHint.trim() || null,
        contact_email: email.trim(),
        contact_phone: phone.trim() || null,
        message: message.trim() || null,
      })
      setDone(true)
    } catch (e) {
      console.error('[Consulting] 送信エラー:', e)
      setError('送信に失敗しました。時間をおいて再度お試しください。')
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <div className="bg-white rounded-xl border shadow-sm p-6 text-center">
        <div className="w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto mb-3">
          <Check size={20} />
        </div>
        <p className="text-sm font-semibold text-gray-900 mb-1">お問い合わせありがとうございます。</p>
        <p className="text-xs text-gray-500">内容を確認のうえ、ご連絡いたします。</p>
        {onClose && (
          <button onClick={onClose} className="mt-4 px-4 py-2 border text-sm text-gray-600 rounded-lg hover:bg-gray-50">
            閉じる
          </button>
        )}
      </div>
    )
  }

  const label = 'block text-xs font-medium text-gray-600 mb-1'
  const input =
    'w-full border rounded-lg px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400'

  return (
    <div className="bg-white rounded-xl border shadow-sm p-6">
      <div className="flex items-start justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-800">コンサルのお問い合わせ</h3>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="閉じる">
            <X size={16} />
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-4">
        店舗の規模・課題をお聞きしたうえで、ボリュームに応じたお見積り（¥150,000〜）をご提示します。
      </p>

      <div className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={label}>お名前 <span className="text-rakuten-red">*</span></label>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="山田 太郎" maxLength={200} />
          </div>
          <div>
            <label className={label}>会社名 <span className="text-rakuten-red">*</span></label>
            <input className={input} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="株式会社〇〇" maxLength={200} />
          </div>
        </div>

        <div>
          <label className={label}>規模感</label>
          <textarea
            className={`${input} h-20 resize-none`}
            value={scaleHint}
            onChange={(e) => setScaleHint(e.target.value)}
            placeholder="例: 月商300万円、3店舗運営、スタッフ2名"
            maxLength={100}
          />
          <p className="text-xs text-gray-400 mt-1">月商の目安や店舗数など、わかる範囲で構いません。</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className={label}>連絡先メール <span className="text-rakuten-red">*</span></label>
            <input
              className={input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className={label}>連絡先電話（任意）</label>
            <input className={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09012345678" maxLength={100} />
          </div>
        </div>

        <div>
          <label className={label}>メッセージ（任意）</label>
          <textarea
            className={`${input} h-24 resize-none`}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="今お困りのこと、相談したい内容があればご記入ください。"
            maxLength={5000}
          />
        </div>

        {error && (
          <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-lg px-3 py-2">{error}</div>
        )}

        <button
          onClick={submit}
          disabled={sending}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-gray-900 hover:bg-gray-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Send size={15} /> {sending ? '送信中…' : '問い合わせを送信する'}
        </button>
      </div>
    </div>
  )
}
