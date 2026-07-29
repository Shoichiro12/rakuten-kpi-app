/**
 * 外部サイト（LP）へのリンク。
 *
 * ⚠️ 法的文書（特商法・プライバシーポリシー・利用規約）の【正はLP側】に置く。
 *   理由:
 *     - Stripeに「ビジネスウェブサイト」として登録しているのがLPで、
 *       審査担当者が見るのもLP。実装をLPに寄せないと記載が食い違う
 *     - アプリ側にも同じ内容を持つと、価格改定のたびに2箇所直すことになり
 *       必ずどこかでズレる（実際に一度ズレた）
 *   そのため **アプリ内に法的ページを作らないこと。** ここから外部リンクで飛ばす。
 *
 * Stripeは「購入手続きに入る前に到達できる」ことを求めているだけなので、
 * 外部リンクで要件を満たせる（/billing の申込ボタン付近にリンクを置いている）。
 *
 * 独自ドメインへ移行したら LP_BASE_URL の1行だけ直せばよい。
 * LPは静的HTMLサイト（Cloudflare Pages）で、拡張子なしのパスも解決される。
 */
export const LP_BASE_URL = 'https://ureshiru.com'

export const LEGAL_LINKS = {
  tokushoho: `${LP_BASE_URL}/tokushoho`,
  privacy: `${LP_BASE_URL}/privacy`,
  terms: `${LP_BASE_URL}/terms`,
} as const

/** 外部リンクを開くときの共通属性（タブ乗っ取り対策込み）。 */
export const EXTERNAL_LINK_PROPS = {
  target: '_blank',
  rel: 'noopener noreferrer',
} as const
