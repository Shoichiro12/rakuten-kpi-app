import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

/**
 * 法的ページ（特商法表記・プライバシーポリシー・利用規約）の共通レイアウト。
 *
 * 重要: これらのページは【未ログインでも閲覧できる】必要がある。
 * 特定商取引法は「購入前に」表示することを求めており、Stripeの審査でも
 * 購入手続きに入る前から到達できるURLであることが確認される。
 * そのため App.tsx では認証ゲートより前にルーティングしている。
 */
export function LegalLayout({
  title,
  updatedAt,
  children,
}: {
  title: string
  updatedAt: string
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-5 py-10">
        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 mb-5">
          <ArrowLeft size={14} /> サービストップへ戻る
        </Link>

        <div className="bg-white rounded-2xl border shadow-sm p-7 sm:p-10">
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          <p className="text-xs text-gray-400 mt-1 mb-7">最終更新日: {updatedAt}</p>
          <div className="space-y-7">{children}</div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center mt-6 text-xs text-gray-500">
          <Link to="/legal/tokushoho" className="hover:text-gray-800 hover:underline">特定商取引法に基づく表記</Link>
          <Link to="/legal/privacy" className="hover:text-gray-800 hover:underline">プライバシーポリシー</Link>
          <Link to="/legal/terms" className="hover:text-gray-800 hover:underline">利用規約</Link>
        </div>
      </div>
    </div>
  )
}

/**
 * 返金・解約条件。特商法表記の「返品・キャンセルについて」と
 * 利用規約 第5条（解約）の【両方】に出す必要があるため、ここで1つだけ定義して
 * 両方から参照する。2箇所に書き写すと、改定時に片方だけ古くなる。
 */
export const REFUND_POLICY_TEXT =
  '日割り計算による返金は行いません。ただし、いつでも解約が可能で、解約後も現在の請求期間の'
  + '終了日まで引き続きサービスをご利用いただけます。無料トライアル期間中の解約はお支払い前の'
  + 'ため、いつでも無条件で完了し、料金は一切発生しません。なお、本サービスは通信販売に該当する'
  + 'ため、特定商取引法に基づくクーリングオフの対象外です。'

/** 事業者情報。特商法・プライバシーポリシー・利用規約で同じ値を使う。 */
export const BUSINESS = {
  name: '中村祥一郎',
  email: 'shoichiro.nakamura.0601@gmail.com',
  phone: '080-3983-1628',
  /** 所在地は開示請求方式（消費者庁の運用に沿った代替表記） */
  address: 'ご請求いただいた場合には、遅滞なく開示いたします。下記メールアドレスまでご連絡ください。',
  court: '東京地方裁判所',
} as const

/** 見出し付きのブロック。 */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-bold text-gray-900 border-b pb-2 mb-3">{title}</h2>
      <div className="text-sm text-gray-700 leading-relaxed space-y-2">{children}</div>
    </section>
  )
}

/** 特商法表記の「項目名 / 内容」の1行。 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid sm:grid-cols-[10rem_1fr] gap-1 sm:gap-4 py-3 border-b last:border-b-0">
      <dt className="text-xs font-semibold text-gray-500 pt-0.5">{label}</dt>
      <dd className="text-sm text-gray-800 leading-relaxed">{children}</dd>
    </div>
  )
}

/**
 * 未確定のプレースホルダー。公開前に必ず実データへ置き換える。
 *
 * わざと目立つ配色にしているのは、置き換え漏れのまま本番公開されるのを
 * 「画面を見た瞬間に気づける」状態にしておくため（チェックリストの担保）。
 */
export function PH({ children }: { children: ReactNode }) {
  return (
    <mark className="bg-amber-100 text-amber-900 border border-amber-300 rounded px-1.5 py-0.5 not-italic">
      [{children}]
    </mark>
  )
}

/** 箇条書き。 */
export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc pl-5 space-y-1">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  )
}
