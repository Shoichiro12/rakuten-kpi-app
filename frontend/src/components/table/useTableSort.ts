import { useMemo, useState } from 'react'

/**
 * テーブルの列見出しソートの共通フック（UIバックログ2026-08-03 区切りA）。
 *
 * 使い方:
 *   const sort = useTableSort<Row>()
 *   const rows = sort.apply(filteredRows)           // 絞り込み後の配列に適用する
 *   <SortableTh label="売上" sortKey="sales" sort={sort} />
 *
 * 仕様:
 * - 見出しクリックで 降順 → 昇順 → 解除 をトグル（数値系の一覧は「大きい順に見たい」
 *   が最初の欲求なので降順始まり）
 * - null / undefined / NaN は昇降どちらでも常に末尾（「データ無し」を上位に出さない）
 * - accessor未指定なら row[sortKey] を読む。計算列は accessors で関数を渡す
 * - 解除時は元の配列順（＝各画面の既定順）に戻る
 * - フィルターとの共存は「絞り込み後に apply する」だけ。適用順を守ること
 */

export type SortDirection = 'desc' | 'asc'

export interface TableSort<Row> {
  key: string | null
  direction: SortDirection
  toggle: (key: string) => void
  apply: (rows: Row[]) => Row[]
}

type Accessor<Row> = (row: Row) => unknown

export function useTableSort<Row>(
  accessors?: Record<string, Accessor<Row>>,
): TableSort<Row> {
  const [key, setKey] = useState<string | null>(null)
  const [direction, setDirection] = useState<SortDirection>('desc')

  const toggle = (nextKey: string) => {
    if (key !== nextKey) {
      setKey(nextKey)
      setDirection('desc')
    } else if (direction === 'desc') {
      setDirection('asc')
    } else {
      setKey(null)          // 3回目のクリックで解除（既定順に戻す）
      setDirection('desc')
    }
  }

  const apply = useMemo(() => {
    return (rows: Row[]): Row[] => {
      if (!key) return rows
      const accessor: Accessor<Row> =
        accessors?.[key] ?? ((row: Row) => (row as Record<string, unknown>)[key])
      const dir = direction === 'desc' ? -1 : 1

      // sortは破壊的なのでコピーしてから。値種別は数値優先、文字列はlocaleCompare
      return [...rows].sort((a, b) => {
        const va = accessor(a)
        const vb = accessor(b)
        const aEmpty = va == null || (typeof va === 'number' && Number.isNaN(va))
        const bEmpty = vb == null || (typeof vb === 'number' && Number.isNaN(vb))
        if (aEmpty && bEmpty) return 0
        if (aEmpty) return 1    // 空値は方向に関係なく常に末尾
        if (bEmpty) return -1
        if (typeof va === 'number' && typeof vb === 'number') {
          return (va - vb) * dir
        }
        return String(va).localeCompare(String(vb), 'ja') * dir
      })
    }
  }, [key, direction, accessors])

  return { key, direction, toggle, apply }
}
