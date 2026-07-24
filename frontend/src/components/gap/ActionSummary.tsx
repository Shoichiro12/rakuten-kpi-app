import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Target } from 'lucide-react'
import { api } from '../../lib/api'
import { formatCurrency } from '../../lib/utils'
import type { ActionSummaryItem } from '../../types'

interface Props {
  scope: 'shop' | 'genre'
  genre?: string
  period: string
  date: string
}

const PRIORITY_STYLE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  recommended: 'bg-amber-100 text-amber-700',
  check: 'bg-gray-100 text-gray-500',
}
const PRIORITY_LABEL: Record<string, string> = {
  critical: '最優先',
  recommended: '推奨',
  check: '確認',
}

/**
 * スコープ（店舗全体 or ジャンル）内で「今どの課題がどれだけ広がっているか」を
 * 上位3件のランキングで見せる集計サマリ（要件No.3）。
 * 個別商品を選ぶ前に、GAP分析の STEP1/STEP2 で課題の集中先を掴むためのカード。
 * 行をクリックすると該当商品（サンプル）を展開する。
 */
export default function ActionSummary({ scope, genre, period, date }: Props) {
  const [items, setItems] = useState<ActionSummaryItem[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api.actions.summary(scope, { genre, period, date })
      .then((d) => { if (alive) setItems(d.items) })
      .catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
  }, [scope, genre, period, date])

  if (items.length === 0) return null
  const top = items.slice(0, 3)

  return (
    <div className="bg-white rounded-xl border shadow-sm p-4">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Target size={15} className="text-blue-600" />
        <p className="text-sm font-semibold text-gray-700">
          アクションサマリ — {scope === 'genre' && genre ? `${genre} の課題集中度` : '店舗全体の課題集中度'}
        </p>
        <span className="text-[11px] text-gray-400">影響額の大きい順</span>
      </div>
      <ul className="divide-y divide-gray-100">
        {top.map((it) => (
          <li key={it.action_key} className="py-2">
            <button
              onClick={() => setExpanded(expanded === it.action_key ? null : it.action_key)}
              className="w-full flex items-center gap-2 text-left"
            >
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${PRIORITY_STYLE[it.priority] ?? ''}`}>
                {PRIORITY_LABEL[it.priority] ?? it.priority}
              </span>
              <span className="text-sm text-gray-800 font-medium">{it.label}</span>
              <span className="text-xs text-gray-400 shrink-0">該当 {it.affected_count}件</span>
              <span className="ml-auto text-xs text-gray-600 shrink-0">影響 {formatCurrency(it.impact_estimate)}</span>
              {expanded === it.action_key
                ? <ChevronUp size={14} className="text-gray-400 shrink-0" />
                : <ChevronDown size={14} className="text-gray-400 shrink-0" />}
            </button>
            {expanded === it.action_key && (
              <div className="mt-1.5 pl-9 flex flex-wrap gap-1.5">
                {it.sample_products.map((p, i) => (
                  <span key={i} className="text-[11px] bg-gray-50 border rounded px-1.5 py-0.5 text-gray-600">
                    {p.product_name || p.management_no}
                  </span>
                ))}
                {it.affected_count > it.sample_products.length && (
                  <span className="text-[11px] text-gray-400 self-center">
                    他 {it.affected_count - it.sample_products.length}件
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
