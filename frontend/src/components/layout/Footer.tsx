import { LEGAL_LINKS, EXTERNAL_LINK_PROPS } from '../../lib/links'

/**
 * 全ページ共通のフッター。法的ページ（LP側）へのリンクを常時表示する。
 *
 * 特定商取引法の表記とプライバシーポリシーは「どのページからでも到達できる」
 * 状態にしておく必要がある（Stripeの審査でも確認される）。
 * リンク先はアプリ内ではなくLP。理由は lib/links.ts のコメントを参照。
 */
export default function Footer() {
  const linkClass = 'hover:text-gray-800 hover:underline'
  return (
    <footer className="shrink-0 border-t bg-white px-6 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span className="text-gray-400">© {new Date().getFullYear()} ウレシル</span>
        <a href={LEGAL_LINKS.tokushoho} {...EXTERNAL_LINK_PROPS} className={linkClass}>
          特定商取引法に基づく表記
        </a>
        <a href={LEGAL_LINKS.privacy} {...EXTERNAL_LINK_PROPS} className={linkClass}>
          プライバシーポリシー
        </a>
        <a href={LEGAL_LINKS.terms} {...EXTERNAL_LINK_PROPS} className={linkClass}>
          利用規約
        </a>
      </div>
    </footer>
  )
}
