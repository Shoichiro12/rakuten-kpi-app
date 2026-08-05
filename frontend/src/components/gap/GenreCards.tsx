import { AlertTriangle } from 'lucide-react'
import type { GenreKPI } from '../../types'
import { formatYen, formatRate, formatCount } from '../../lib/format'
import Stat from '../kpi/Stat'
import Delta, { type DeltaState } from '../kpi/Delta'
import { FOCUS_RING } from '../../lib/a11y'
import {
  orderBySalesGap,
  salesGapDelta,
  gapKpiDelta,
  gapKpiValue,
  gapKpiLabel,
  gapMetricKey,
  SALES_ORDER_NOTE,
  type GapKpi,
} from './kpiGap'

interface GenreCardsProps {
  genres: GenreKPI[]
  selectedGenre: string | null
  selectedKPI: string | null
  onSelect: (genre: string) => void
  /** 集計軸。'shop'=商品分析（店舗全体・CVRはUU基準）/ それ以外=RPP（CVRはクリック基準）。
   *  月次と週次で母数が変わるため、どちらで見ているかを明示する。 */
  axis?: string | null
}

function isWarning(change: number | null | undefined): boolean {
  return change != null && change < -5
}

/** 前期比を Delta の状態に変換する（比較できないときは空欄にせず理由を出す） */
function deltaState(diff: number | null): DeltaState {
  if (diff == null || !Number.isFinite(diff)) return { kind: 'no_prev' }
  if (diff === 0) return { kind: 'no_change' }
  return { kind: 'value', diff }
}

export default function GenreCards({ genres, selectedGenre, selectedKPI, onSelect, axis }: GenreCardsProps) {
  if (genres.length === 0) return null

  const kpi: GapKpi | null =
    selectedKPI === 'access' || selectedKPI === 'cvr' || selectedKPI === 'av' ? selectedKPI : null

  // 並び順は常に売上の落ち込みが大きい順（選択KPIでは切り替えない）
  const ordered = orderBySalesGap(genres)
  // 「最大GAP」も同じ基準＝並びの先頭（前期比が取れる行のうち最も落ちているもの）
  const worstGenre = ordered.find((g) => salesGapDelta(g) != null) ?? null

  return (
    <div>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <p className="text-sm font-semibold text-gray-700">
          ジャンル別内訳
          {kpi && (
            <span className="ml-2 text-blue-600 font-normal">— {gapKpiLabel(kpi, axis)} の課題を確認</span>
          )}
        </p>
        <span className="text-xs text-gray-400 bg-gray-100 rounded px-2 py-0.5">{genres.length}ジャンル</span>
        {/* 軸バッジは画面ヘッダーに1つだけ置く（2026-08-04 決定）。ここには戻さないこと */}
      </div>

      {/* 並び順の根拠。基準を書かない並べ替えは読み手に伝わらない */}
      <p className="text-xs text-gray-500 mb-3">
        並び順: {SALES_ORDER_NOTE}（ジャンルには目標値が無いため前期比で比較しています）
      </p>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {ordered.map((g) => {
          const isWorst = worstGenre != null && g.genre === worstGenre.genre
          const isSelected = g.genre === selectedGenre
          const hasAlert = isWarning(g.changes.gross) || isWarning(g.changes.cvr) || isWarning(g.changes.av)

          // 主役スロット: 選択KPI（未選択なら売上）。4指標は消さず、補助行に残す
          const main = kpi
            ? {
                label: gapKpiLabel(kpi, axis),
                value:
                  kpi === 'cvr'
                    ? formatRate(gapKpiValue(g, kpi), 2)
                    : kpi === 'av'
                    ? formatYen(gapKpiValue(g, kpi))
                    : formatCount(gapKpiValue(g, kpi)),
                metric: gapMetricKey(kpi, axis),
                diff: gapKpiDelta(g, kpi),
              }
            : {
                label: 'RPP売上',
                value: formatYen(g.current.gross),
                metric: 'gross' as const,
                diff: g.changes.gross ?? null,
              }

          // 補助指標。主役に上がったものは重複させない
          const subs = [
            { key: 'gross', label: '売上', text: formatYen(g.current.gross), warn: isWarning(g.changes.gross) },
            { key: 'cvr', label: 'CVR', text: formatRate(g.current.cvr, 2), warn: isWarning(g.changes.cvr) },
            { key: 'av', label: '客単価', text: formatYen(g.current.av), warn: isWarning(g.changes.av) },
            { key: 'roas', label: 'ROAS', text: formatRate(g.current.roas), warn: false },
          ].filter((s) => (kpi ? s.key !== kpi : s.key !== 'gross'))

          return (
            <button
              key={g.genre}
              onClick={() => onSelect(g.genre)}
              className={`shrink-0 w-52 rounded-xl border-2 p-4 text-left transition-colors ${FOCUS_RING} ${
                isSelected
                  ? 'border-blue-500 bg-blue-50'
                  : isWorst
                  ? 'border-amber-400 bg-amber-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              {/* ジャンル名 */}
              <div className="flex items-start justify-between mb-2">
                <p className="text-xs font-semibold text-gray-700 leading-tight pr-1">{g.genre}</p>
                <div className="flex gap-1 shrink-0">
                  {isWorst && !isSelected && (
                    <span className="text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 font-medium">
                      最大GAP
                    </span>
                  )}
                  {hasAlert && <AlertTriangle size={13} className="text-amber-500" />}
                </div>
              </div>

              {/* 主役の指標 */}
              <div className="mb-3">
                <Stat
                  label={main.label}
                  value={main.value}
                  delta={<Delta metric={main.metric} state={deltaState(main.diff)} basis="前期比" />}
                />
              </div>

              {/* 補助の指標（消さずに残す） */}
              <div className="space-y-1.5 text-xs tabular-nums">
                {subs.map((s) => (
                  <div key={s.key} className="flex items-center justify-between">
                    <span className="text-gray-500">{s.label}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-gray-800">{s.text}</span>
                      {s.warn && <AlertTriangle size={10} className="text-amber-500" />}
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-[10px] text-blue-500 text-right font-medium">
                {isSelected ? '✓ 選択中' : '商品を見る →'}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
