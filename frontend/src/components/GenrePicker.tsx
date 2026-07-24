import { useState } from 'react'
import type { GenreTree, GenreValue } from '../types'

interface Props {
  /** 楽天ジャンルマスタの3階層ツリー */
  tree: GenreTree
  value: GenreValue
  onChange: (v: GenreValue) => void
  /** テーブルセル等で幅を詰めたいとき */
  compact?: boolean
}

/** value がマスタツリー上に存在する組み合わせか（存在しなければ自由入力で開く） */
function isInMaster(tree: GenreTree, v: GenreValue): boolean {
  if (!v.genre_u1) return true // 未選択はマスタ扱い
  if (tree[v.genre_u1] === undefined) return false
  if (v.genre_u2 && tree[v.genre_u1][v.genre_u2] === undefined) return false
  if (v.genre_u3 && !(tree[v.genre_u1]?.[v.genre_u2] || []).includes(v.genre_u3)) return false
  return true
}

/**
 * 楽天ジャンルマスタから大→中→小をカスケード選択するピッカー。
 * マスタに無いジャンルは「自由入力で追加」に切り替えて手入力できる（選択式＋追加）。
 * 値は {genre_u1, genre_u2, genre_u3} で返し、確定（カテゴリ作成・商品割当）は呼び出し側が行う。
 */
export default function GenrePicker({ tree, value, onChange, compact = false }: Props) {
  const hasValue = !!(value.genre_u1 || value.genre_u2 || value.genre_u3)
  const [custom, setCustom] = useState(hasValue && !isInMaster(tree, value))

  const fieldClass =
    'border border-gray-200 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400 ' +
    (compact ? 'w-[116px]' : 'flex-1 min-w-[110px]')

  if (custom) {
    return (
      <div className="flex items-center gap-1 flex-wrap">
        <input value={value.genre_u1} onChange={(e) => onChange({ ...value, genre_u1: e.target.value })} placeholder="大分類" className={fieldClass} />
        <span className="text-gray-300 text-xs">&gt;</span>
        <input value={value.genre_u2} onChange={(e) => onChange({ ...value, genre_u2: e.target.value })} placeholder="中分類" className={fieldClass} />
        <span className="text-gray-300 text-xs">&gt;</span>
        <input value={value.genre_u3} onChange={(e) => onChange({ ...value, genre_u3: e.target.value })} placeholder="小分類" className={fieldClass} />
        <button type="button" onClick={() => setCustom(false)} className="text-[11px] text-blue-600 hover:underline whitespace-nowrap">
          マスタから選ぶ
        </button>
      </div>
    )
  }

  const u1Options = Object.keys(tree)
  const u2Options = value.genre_u1 && tree[value.genre_u1] ? Object.keys(tree[value.genre_u1]) : []
  const u3Options = value.genre_u1 && value.genre_u2 ? (tree[value.genre_u1]?.[value.genre_u2] ?? []) : []

  return (
    <div className="flex items-center gap-1 flex-wrap">
      <select
        value={value.genre_u1}
        onChange={(e) => onChange({ genre_u1: e.target.value, genre_u2: '', genre_u3: '' })}
        className={fieldClass}
      >
        <option value="">大分類を選択</option>
        {u1Options.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
      <span className="text-gray-300 text-xs">&gt;</span>
      <select
        value={value.genre_u2}
        disabled={!value.genre_u1}
        onChange={(e) => onChange({ ...value, genre_u2: e.target.value, genre_u3: '' })}
        className={fieldClass}
      >
        <option value="">（中分類）</option>
        {u2Options.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
      <span className="text-gray-300 text-xs">&gt;</span>
      <select
        value={value.genre_u3}
        disabled={!value.genre_u2 || u3Options.length === 0}
        onChange={(e) => onChange({ ...value, genre_u3: e.target.value })}
        className={fieldClass}
      >
        <option value="">（小分類）</option>
        {u3Options.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
      <button type="button" onClick={() => setCustom(true)} className="text-[11px] text-gray-500 hover:underline whitespace-nowrap">
        マスタに無い→自由入力
      </button>
    </div>
  )
}
