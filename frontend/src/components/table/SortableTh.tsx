import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { TableSort } from './useTableSort'
import { FOCUS_RING } from '../../lib/a11y'

/**
 * ソート可能な列見出しセル（useTableSortとセットで使う）。
 *
 * - クリックで useTableSort.toggle を呼ぶ（降順→昇順→解除）
 * - 現在のソート列には ↓/↑、それ以外はホバー時に薄い⇅を出す
 * - aria-sort を付与（スクリーンリーダー対応。web-design-guidelines準拠）
 * - 見た目は既存テーブルのthに合わせ、align/クラスは呼び出し側から渡す
 */
interface SortableThProps<Row> {
  label: string
  sortKey: string
  sort: TableSort<Row>
  align?: 'left' | 'right'
  className?: string
}

export default function SortableTh<Row>({
  label,
  sortKey,
  sort,
  align = 'right',
  className = '',
}: SortableThProps<Row>) {
  const active = sort.key === sortKey
  const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'

  return (
    <th aria-sort={ariaSort} className={`p-0 ${className}`}>
      <button
        type="button"
        onClick={() => sort.toggle(sortKey)}
        title={`${label}で並び替え`}
        className={`group w-full px-3 py-2.5 flex items-center gap-1 whitespace-nowrap cursor-pointer select-none touch-manipulation hover:bg-gray-100 transition-colors ${FOCUS_RING} ${
          align === 'right' ? 'justify-end' : 'justify-start'
        } ${active ? 'text-gray-900 font-semibold' : ''}`}
      >
        <span>{label}</span>
        {active ? (
          sort.direction === 'desc' ? (
            <ArrowDown size={12} aria-hidden="true" className="shrink-0" />
          ) : (
            <ArrowUp size={12} aria-hidden="true" className="shrink-0" />
          )
        ) : (
          <ArrowUpDown size={12} aria-hidden="true" className="shrink-0 opacity-0 group-hover:opacity-40 group-focus-visible:opacity-40 transition-opacity" />
        )}
      </button>
    </th>
  )
}
