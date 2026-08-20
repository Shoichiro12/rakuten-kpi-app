import type { AccessAxis } from '../../types'
import { ACCESS_AXIS_BADGE, ACCESS_AXIS_HINT } from '../../types'

/**
 * この画面が今どちらのアクセス軸で集計されているかを示すバッジ（2026-08-04 決定）。
 *
 * アクセス指標には母数の異なる2軸がある（`backend/access_definitions.py` が単一の真実）。
 * 期間で軸が切り替わる（週次=RPP広告クリック / 月次・年次=サイト全体UU）ので、
 * **今どちらを見ているかを画面に必ず出す**というのが規約。
 *
 * 置き場所は**画面ヘッダーに1つだけ**。ブロックごとに出すと同じバッジが3つ並ぶうえ、
 * 軸は画面全体で1つ（混在させない規約）なので、ヘッダーにあるのが正しい。
 */
export default function AccessAxisBadge({ axis }: { axis?: AccessAxis }) {
  if (!axis) return null
  const isShop = axis === 'site_uu'
  return (
    <span
      className={`text-xs px-2 py-1 rounded-lg font-medium whitespace-nowrap ${
        isShop ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
      }`}
      title={ACCESS_AXIS_HINT[axis]}
    >
      アクセス軸: {ACCESS_AXIS_BADGE[axis]}
    </span>
  )
}
