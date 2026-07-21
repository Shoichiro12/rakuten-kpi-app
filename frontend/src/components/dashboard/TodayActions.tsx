import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, ChevronRight, ListChecks, Undo2 } from 'lucide-react'
import { api } from '../../lib/api'
import { formatCurrency } from '../../lib/utils'
import type { Recommendation, RecommendationsResponse } from '../../types'

/**
 * 「今日やるべきこと」パネル（Phase 1）。
 *
 * docs/VISION.md の中核。このプロダクトは分析ツールではなく意思決定OSなので、
 * ダッシュボード最上部（KGIより上）に置き、数値より先に「次の行動」を見せる。
 * 各提案には必ず根拠の数値を添える（理由なき指示は店舗の判断力を育てないため）。
 */

const PRIORITY_STYLE: Record<string, { label: string; cls: string }> = {
  critical: { label: '最優先', cls: 'bg-red-100 text-red-700' },
  recommended: { label: '推奨', cls: 'bg-amber-100 text-amber-700' },
  check: { label: '確認', cls: 'bg-amber-50 text-amber-700' },
}

interface Props {
  data: RecommendationsResponse | null
  onChanged: () => void
}

export default function TodayActions({ data, onChanged }: Props) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState<string | null>(null)
  const [justDone, setJustDone] = useState<{ key: string; title: string } | null>(null)

  if (!data) return null

  const items = data.recommendations ?? []

  const act = async (item: Recommendation, status: 'done' | 'snoozed') => {
    setBusy(item.key)
    try {
      await api.recommendations.complete(
        item.key, data.period_key, data.period, status, item.title,
      )
      setJustDone({ key: item.key, title: item.title })
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  const undo = async () => {
    if (!justDone) return
    setBusy(justDone.key)
    try {
      await api.recommendations.undo(justDone.key, data.period_key)
      setJustDone(null)
      onChanged()
    } finally {
      setBusy(null)
    }
  }

  // 提案0件＝いま緊急に対処すべき課題が無い健全な状態。無言で消さず明示する。
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-xl border shadow-sm p-4">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={18} className="text-green-600" />
          <span className="text-sm font-semibold text-gray-900">今日やるべきことはありません</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          主要KPIに緊急の課題は見つかりませんでした。
          {data.done_count > 0 && `この期間は ${data.done_count} 件を実施済みです。`}
        </p>
        {justDone && (
          <button onClick={undo} className="mt-2 text-xs text-blue-600 hover:underline flex items-center gap-1">
            <Undo2 size={12} />「{justDone.title}」を元に戻す
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border-2 border-blue-500 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-1">
        <ListChecks size={18} className="text-blue-600" />
        <span className="text-base font-bold text-gray-900">今日やるべきこと</span>
        <span className="text-[11px] px-2 py-0.5 rounded bg-blue-100 text-blue-700 font-medium">
          {items.length}件
        </span>
        {data.done_count > 0 && (
          <span className="text-[11px] text-gray-400">実施済み {data.done_count}件</span>
        )}
      </div>

      {data.target_gap != null && data.target_gap > 0 && (
        <p className="text-xs text-gray-500 mb-3">
          売上目標まで残り {formatCurrency(data.target_gap)}。優先度の高い順に並べています。
        </p>
      )}

      {justDone && (
        <div className="mb-3 flex items-center justify-between bg-green-50 border border-green-200 rounded px-3 py-2">
          <span className="text-xs text-green-800">
            「{justDone.title}」を記録しました。効果は次回の実績で確認できます。
          </span>
          <button onClick={undo} className="text-xs text-green-700 hover:underline flex items-center gap-1">
            <Undo2 size={12} />元に戻す
          </button>
        </div>
      )}

      <div className="space-y-2.5">
        {items.map((item) => {
          const style = PRIORITY_STYLE[item.priority] ?? PRIORITY_STYLE.check
          const disabled = busy === item.key
          return (
            <div key={item.key} className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-start gap-2.5">
                <span className={`text-[11px] px-2 py-0.5 rounded font-medium whitespace-nowrap ${style.cls}`}>
                  {style.label}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                  <p className="text-xs text-gray-600 mt-1 leading-relaxed">{item.reason}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {item.impact && (
                      <span className="text-[11px] px-2 py-0.5 rounded bg-green-100 text-green-700">
                        {item.impact}
                      </span>
                    )}
                    <span className="text-[11px] px-2 py-0.5 rounded bg-white text-gray-500 border">
                      所要 {item.effort}
                    </span>
                    {item.badges?.map((b) => (
                      <span key={b} className="text-[11px] px-2 py-0.5 rounded bg-white text-gray-500 border">
                        {b}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-2 mt-2.5">
                <button
                  onClick={() => act(item, 'done')}
                  disabled={disabled}
                  className="text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-white text-gray-700 disabled:opacity-40"
                >
                  実施した
                </button>
                {item.link && (
                  <button
                    onClick={() => navigate(item.link!)}
                    className="text-xs px-3 py-1.5 rounded border border-gray-300 hover:bg-white text-gray-700 flex items-center gap-1"
                  >
                    対応する<ChevronRight size={12} />
                  </button>
                )}
                <button
                  onClick={() => act(item, 'snoozed')}
                  disabled={disabled}
                  className="text-xs px-3 py-1.5 rounded text-gray-400 hover:text-gray-600 disabled:opacity-40"
                >
                  後で
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
