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
