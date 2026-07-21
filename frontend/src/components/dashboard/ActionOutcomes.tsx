import { History, TrendingDown, TrendingUp, Clock } from 'lucide-react'
import type { OutcomesResponse } from '../../types'

/**
 * 「実施した施策のその後」パネル（Phase 2 の学習ループ）。
 *
 * docs/VISION.md の Phase 2「提案 → 実施結果 → 売上変化 → 学習」の可視化。
 *
 * 表現上の注意:
 *   ここで出しているのは相関であって因果ではない。季節要因や同時に打った
 *   他施策の影響を分離できないため、「効果」と断定せず「実施後の変化」と書く。
 *   翌月データ待ちのものも隠さず出す（測定できていないのに効果があったと
 *   見せかけないため）。
 */

interface Props {
  data: OutcomesResponse | null
}

export default function ActionOutcomes({ data }: Props) {
  if (!data) return null
  const results = data.results ?? []
  if (results.length === 0) return null

  const measured = results.filter((r) => r.status === 'measured')
  const pending = results.filter((r) => r.status === 'pending')
  if (measured.length === 0 && pending.length === 0) return null

  return (
    <div className="bg-white rounded-xl border shadow-sm p-4">
      <div className="flex items-center gap-2 mb-1">
        <History size={16} className="text-gray-500" />
        <span className="text-sm font-semibold text-gray-900">実施した施策のその後</span>
        {measured.length > 0 && (
          <span className="text-[11px] px-2 py-0.5 rounded bg-gray-100 text-gray-600">
            測定済み {measured.length}件
          </span>
        )}
        {pending.length > 0 && (
          <span className="text-[11px] px-2 py-0.5 rounded bg-gray-50 text-gray-400">
            測定待ち {pending.length}件
          </span>
        )}
      </div>
      <p className="text-[11px] text-gray-400 mb-3">
        実施した月と翌月の実績を比較しています。季節要因や他の施策の影響も含むため、
        この施策だけの効果とは限りません。
      </p>

      <div className="space-y-2">
        {measured.map((r) => {
          const up = (r.delta_pct ?? 0) > 0
          return (
            <div
              key={`${r.action_key}-${r.period_key}`}
              className="flex items-center justify-between gap-3 bg-gray-50 rounded-lg px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-800 truncate">{r.title}</p>
                <p className="text-[11px] text-gray-500">
                  {r.period_key} 実施 → {r.next_period} 時点の{r.metric_label}
                </p>
              </div>
              <div className="flex items-center gap-2 whitespace-nowrap">
                <span className="text-[11px] text-gray-500">
                  {r.before?.toLocaleString()} → {r.after?.toLocaleString()}
                </span>
                <span
                  className={`text-xs font-semibold flex items-center gap-0.5 ${
                    up ? 'text-green-600' : 'text-red-500'
                  }`}
                >
                  {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {up ? '+' : ''}
                  {r.delta_pct}%
                </span>
              </div>
            </div>
          )
        })}

        {pending.map((r) => (
          <div
            key={`${r.action_key}-${r.period_key}`}
            className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 border border-dashed border-gray-200"
          >
            <p className="text-xs text-gray-500 truncate">{r.title}</p>
            <span className="text-[11px] text-gray-400 flex items-center gap-1 whitespace-nowrap">
              <Clock size={11} />
              {r.next_period} の実績待ち
            </span>
          </div>
        ))}
      </div>

      {Object.keys(data.summary ?? {}).length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-[11px] font-medium text-gray-600 mb-1.5">施策タイプ別の傾向</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(data.summary).map(([rule, s]) => (
              <span
                key={rule}
                className="text-[11px] px-2 py-0.5 rounded bg-gray-50 border text-gray-600"
                title={`${s.count}件の実施結果にもとづく平均`}
              >
                {s.metric_label ?? rule} 平均 {(s.avg_delta_pct ?? 0) > 0 ? '+' : ''}
                {s.avg_delta_pct}%（{s.count}件）
                {s.count < data.min_sample_for_weight && ' ※参考値'}
              </span>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5">
            ※参考値 = {data.min_sample_for_weight}件未満のため、提案の優先順位には反映していません。
          </p>
        </div>
      )}
    </div>
  )
}
