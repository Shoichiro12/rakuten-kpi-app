import type { GenreKPI } from '../../types'
import { formatYen, formatRate, formatCount } from '../../lib/format'
import { FOCUS_RING, TAP_TARGET } from '../../lib/a11y'
import Delta, { type DeltaState } from '../kpi/Delta'
import {
  orderByKpiGap, gapKpiDelta, gapKpiValue, gapKpiLabel, gapMetricKey, orderNote, type GapKpi,
} from '../gap/kpiGap'

export type GenreLevel = 'u1' | 'u2' | 'u3'

const LEVEL_LABEL: Record<GenreLevel, string> = { u1: '大分類', u2: '中分類', u3: '小分類' }

interface GenreDrillProps {
  level: GenreLevel
  onLevelChange: (level: GenreLevel) => void
  genres: GenreKPI[]
  loading: boolean
  selectedGenre: string | null
  selectedKpi: GapKpi
  axis?: string | null
  onSelect: (genre: string) => void
}

function deltaState(diff: number | null): DeltaState {
  if (diff == null || !Number.isFinite(diff)) return { kind: 'no_prev' }
  if (diff === 0) return { kind: 'no_change' }
  return { kind: 'value', diff }
}

/**
 * 段3（ジャンル）。粒度切替（大/中/小 = level u1/u2/u3、`/api/gap/genre` そのまま）と
 * 選択KPIのGAPが大きい順の行リスト（GitHubのIssue行の文法）。
 * ロジックは GAP分析画面の GenreCards.tsx と同じ `components/gap/kpiGap.ts` を共有する。
 */
export default function GenreDrill({
  level, onLevelChange, genres, loading, selectedGenre, selectedKpi, axis, onSelect,
}: GenreDrillProps) {
  const ordered = orderByKpiGap(genres, selectedKpi)

  return (
    <div className="bg-paper rounded-xl border border-line p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h3 className="text-sm font-semibold text-ink">どのジャンルが足りていないか</h3>
        <div className="inline-flex gap-0.5 border border-line rounded-md p-0.5 bg-paper">
          {(['u1', 'u2', 'u3'] as GenreLevel[]).map((lv) => (
            <button
              key={lv}
              type="button"
              onClick={() => onLevelChange(lv)}
              className={`px-3 rounded text-xs font-medium ${TAP_TARGET} ${FOCUS_RING} ${
                level === lv ? 'bg-bg-alt text-ink font-semibold' : 'text-muted hover:text-ink'
              }`}
            >
              {LEVEL_LABEL[lv]}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted mb-3">並び順: {orderNote(selectedKpi, axis)}</p>

      {loading ? (
        <div className="h-24 flex items-center justify-center text-sm text-muted">読み込み中...</div>
      ) : ordered.length === 0 ? (
        <div className="h-24 flex items-center justify-center text-sm text-muted">この粒度のジャンルデータがありません</div>
      ) : (
        <div className="border-t border-line">
          {ordered.map((g) => {
            const isSelected = g.genre === selectedGenre
            const diff = gapKpiDelta(g, selectedKpi)
            const value =
              selectedKpi === 'cvr' ? formatRate(gapKpiValue(g, selectedKpi), 2)
                : selectedKpi === 'av' ? formatYen(gapKpiValue(g, selectedKpi))
                : formatCount(gapKpiValue(g, selectedKpi))
            return (
              <button
                key={g.genre}
                type="button"
                onClick={() => onSelect(g.genre)}
                aria-pressed={isSelected}
                className={`w-full flex items-center gap-4 text-left px-2 py-2.5 border-b border-line last:border-b-0 transition-colors ${FOCUS_RING} ${
                  isSelected ? 'bg-bg-alt' : 'hover:bg-bg-alt'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${diff != null && diff < 0 ? 'bg-alert' : 'bg-line'}`}
                />
                <span className="flex-1 min-w-0">
                  <span className="block font-semibold text-sm text-ink truncate">{g.genre}</span>
                </span>
                <span className="w-24 text-right shrink-0">
                  <span className="font-num block text-sm font-semibold text-ink tabular-nums">{value}</span>
                  <span className="block text-xs text-muted">{gapKpiLabel(selectedKpi, axis)}</span>
                </span>
                <span className="w-24 text-right shrink-0">
                  <Delta metric={gapMetricKey(selectedKpi, axis)} state={deltaState(diff)} basis="前期比" />
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
