import { Target as TargetIcon, TrendingUp, TrendingDown } from 'lucide-react'
import type { EvaluationResult, EvaluationJudge } from '../types'

/**
 * 17パターン評価マトリクス（要件No.1）。
 * 売上×アクセス×CVR×客単価の達成/未達を目標比×YoYの統一ロジック（要件No.2）で
 * 判定した結果を、評価ランク（◎○△×）・優先度・フォーカスKPIとして表示する。
 */

const RANK_STYLE: Record<string, { bg: string; text: string; ring: string }> = {
  '◎': { bg: 'bg-green-50', text: 'text-green-700', ring: 'border-green-300' },
  '○': { bg: 'bg-blue-50', text: 'text-blue-700', ring: 'border-blue-300' },
  '△': { bg: 'bg-amber-50', text: 'text-amber-700', ring: 'border-amber-300' },
  '×': { bg: 'bg-red-50', text: 'text-red-700', ring: 'border-red-300' },
  '−': { bg: 'bg-gray-50', text: 'text-gray-500', ring: 'border-gray-200' },
}

const PRIORITY_STYLE: Record<string, string> = {
  '維持': 'bg-green-100 text-green-700',
  '中': 'bg-blue-100 text-blue-700',
  '高': 'bg-red-100 text-red-700',
  '−': 'bg-gray-100 text-gray-500',
}

function fmtValue(j: EvaluationJudge): string {
  if (j.key === 'sales' || j.key === 'av') return `¥${Math.round(j.actual).toLocaleString()}`
  if (j.key === 'cvr') return `${j.actual.toFixed(2)}%`
  return j.actual.toLocaleString()
}

function RateChip({ label, rate, ok }: { label: string; rate: number | null; ok: boolean | null }) {
  if (rate == null) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400">
        {label} −
      </span>
    )
  }
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded font-medium ${
        ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
      }`}
    >
      {label === '目標比' ? <TargetIcon size={9} /> : ok ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
      {label} {rate.toFixed(1)}%
    </span>
  )
}

function MetricCell({ judge, focused }: { judge: EvaluationJudge; focused: boolean }) {
  // 100UUルールで評価対象外（母数不足）の指標は「対象外」と明示する
  const mark = judge.excluded
    ? '対象外'
    : judge.achieved == null ? '−' : judge.achieved ? '達成' : '未達'
  const markStyle = judge.excluded
    ? 'bg-amber-100 text-amber-600'
    : judge.achieved == null
      ? 'bg-gray-100 text-gray-400'
      : judge.achieved
      ? 'bg-green-100 text-green-700'
      : 'bg-red-100 text-red-600'

  return (
    <div
      className={`rounded-lg border p-2.5 space-y-1.5 ${
        focused ? 'border-red-300 bg-red-50/50' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <p className="text-[11px] text-gray-500 truncate">{judge.label}</p>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold shrink-0 ${markStyle}`}>
          {mark}
        </span>
      </div>
      <p className="text-sm font-bold text-gray-900">{fmtValue(judge)}</p>
      <div className="flex flex-wrap gap-1">
        <RateChip label="目標比" rate={judge.achieve_rate} ok={judge.target_ok} />
        <RateChip label="YoY" rate={judge.yoy_rate} ok={judge.yoy_ok} />
      </div>
      {focused && (
        <p className="text-[10px] text-red-600 font-medium">⚠️ 深掘り対象</p>
      )}
      {judge.excluded && (
        <p className="text-[10px] text-amber-600 leading-snug">母数不足のため参考値</p>
      )}
    </div>
  )
}

interface EvaluationMatrixProps {
  evaluation: EvaluationResult
  /** アクセスのデータ軸: shop=店舗全体UU（商品分析） / rpp=RPP広告クリック数 */
  axis?: 'shop' | 'rpp'
}

export default function EvaluationMatrix({ evaluation, axis }: EvaluationMatrixProps) {
  const rank = RANK_STYLE[evaluation.rank] ?? RANK_STYLE['−']
  const { sales, access, cvr, av } = evaluation.metrics
  const focusSet = new Set<string>(evaluation.focus)

  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${rank.ring}`}>
      {/* ヘッダー: ランク・優先度・パターン番号 */}
      <div className={`px-4 py-3 flex items-center gap-3 ${rank.bg}`}>
        <span className={`text-3xl font-bold leading-none ${rank.text}`}>{evaluation.rank}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-gray-900">KPI評価マトリクス</p>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${PRIORITY_STYLE[evaluation.priority]}`}>
              対策優先度: {evaluation.priority}
            </span>
            {evaluation.pattern_no <= 16 && (
              <span className="text-[10px] text-gray-400">パターン No.{evaluation.pattern_no}/17</span>
            )}
            {axis && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  axis === 'shop' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
                }`}
                title={
                  axis === 'shop'
                    ? 'アクセス=商品分析レポートのユニークユーザー数（店舗全体・自然流入含む）'
                    : 'アクセス=RPP広告のクリック数（広告経由のみ）'
                }
              >
                {axis === 'shop' ? 'アクセス: 店舗全体UU' : 'アクセス: 広告クリック数'}
              </span>
            )}
            {evaluation.low_sample && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-100 text-amber-700">
                ⚠️ 母数不足（{evaluation.min_access ?? 100}未満）
              </span>
            )}
          </div>
          <p className="text-xs text-gray-600 mt-0.5 leading-snug">{evaluation.comment}</p>
        </div>
      </div>

      {/* 4指標の判定詳細 */}
      <div className="p-3 grid grid-cols-2 md:grid-cols-4 gap-2 bg-white">
        <MetricCell judge={sales} focused={false} />
        <MetricCell judge={access} focused={focusSet.has('access')} />
        <MetricCell judge={cvr} focused={focusSet.has('cvr')} />
        <MetricCell judge={av} focused={focusSet.has('av')} />
      </div>

      {evaluation.undetermined.length > 0 && evaluation.rank !== '−' && (
        <p className="px-4 pb-3 text-[10px] text-amber-600 bg-white">
          ※ 目標もYoYデータも無い指標（{evaluation.undetermined.length}件）は未達扱いで評価しています。目標設定で精度が上がります。
        </p>
      )}
    </div>
  )
}
