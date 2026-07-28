import { Link } from 'react-router-dom'

/**
 * 全ページ共通のフッター。法的ページへのリンクを常時表示する。
 *
 * 特定商取引法の表記とプライバシーポリシーは「どのページからでも到達できる」
 * 状態にしておく必要がある（Stripeの審査でも確認される）。
 * サイドバーではなくフッターに置いているのは、この慣習に沿った位置の方が
 * 利用者・審査担当者ともに探しやすいため。
 */
export default function Footer() {
  return (
    <footer className="shrink-0 border-t bg-white px-6 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
        <span className="text-gray-400">© {new Date().getFullYear()} ウレシル</span>
        <Link to="/legal/tokushoho" className="hover:text-gray-800 hover:underline">
          特定商取引法に基づく表記
        </Link>
        <Link to="/legal/privacy" className="hover:text-gray-800 hover:underline">
          プライバシーポリシー
        </Link>
        <Link to="/legal/terms" className="hover:text-gray-800 hover:underline">
          利用規約
        </Link>
      </div>
    </footer>
  )
}
