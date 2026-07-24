import { AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react'
import type { GenreKPI } from '../../types'
import { formatCurrency, formatPercent } from '../../lib/utils'

interface GenreCardsProps {
  genres: GenreKPI[]
  selectedGenre: string | null
  selectedKPI: string | null
  onSelect: (genre: string) => void
  /** 集計軸。'shop'=商品分析（店舗全体・CVRはUU基準）/ それ以外=RPP（CVRはクリック基準）。
   *  月次と週次で母数が変わるため、どちらで見ているかを明示する。 */
  axis?: string | null
}

function ChangeChip({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-gray-300 text-xs">—</span>
  const up = value > 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? 'text-green-600' : 'text-red-500'}`}>
      {up ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
      {up ? '+' : ''}{value.toFixed(1)}%
    </span>
  )
}

function isWarning(change: number | null | undefined): boolean {
  return change != null && change < -5
}

export default function GenreCards({ genres, selectedGenre, selectedKPI, onSelect, axis }: GenreCardsProps) {
  if (genres.length === 0) return null

  // 差分最大（最も悪化）のジャンルを特定
  const worstGenre = genres.reduce((worst, g) => {
    const wChange = g.changes.gross ?? 0
    const gChange = g.changes.gross ?? 0
    return gChange < wChange ? g : worst
  }, genres[0])

  const kpiLabel: Record<string, string> = {
    access: axis === 'shop' ? 'アクセス（UU）' : 'アクセス（RPPクリック）',
    cvr: '転換率（CVR）',
    av: '客単価',
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <p className="text-sm font-semibold text-gray-700">
          ジャンル別内訳
          {selectedKPI && (
            <span className="ml-2 text-blue-600 font-normal">
              — {kpiLabel[selectedKPI] ?? selectedKPI} の課題を確認
            </span>
          )}
        </p>
        <span className="text-xs text-gray-400 bg-gray-100 rounded px-2 py-0.5">{genres.length}ジャンル</span>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            axis === 'shop' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
          }`}
          title={
            axis === 'shop'
              ? 'CVRはアクセス人数(UU)を母数にした転換率です'
              : 'CVRはRPPのクリック数を母数にした転換率です'
          }
        >
          {axis === 'shop' ? '商品分析ベース（店舗全体）' : 'RPP経由ベース'}
        </span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {genres.map((g) => {
          const isWorst = g.genre === worstGenre.genre
          const isSelected = g.genre === selectedGenre
          const hasAlert = isWarning(g.changes.gross) || isWarning(g.changes.cvr) || isWarning(g.changes.av)

          return (
            <button
              key={g.genre}
              onClick={() => onSelect(g.genre)}
              className={`shrink-0 w-52 rounded-xl border-2 p-4 text-left transition-all ${
                isSelected
                  ? 'border-blue-500 bg-blue-50 shadow-md'
                  : isWorst
                  ? 'border-amber-400 bg-amber-50 shadow-sm hover:shadow-md'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
              }`}
            >
              {/* ジャンル名 */}
              <div className="flex items-start justify-between mb-2">
                <p className="text-xs font-semibold text-gray-700 leading-tight pr-1">
                  {g.genre}
                </p>
                <div className="flex gap-1 shrink-0">
                  {isWorst && !isSelected && (
                    <span className="text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 font-medium">最大GAP</span>
                  )}
                  {hasAlert && <AlertTriangle size={13} className="text-amber-500" />}
                </div>
              </div>

              {/* 売上 */}
              <div className="mb-3">
                <p className="text-lg font-bold text-gray-900">{formatCurrency(g.current.gross)}</p>
                <ChangeChip value={g.changes.gross} />
              </div>

              {/* KPI 3指標 */}
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">CVR</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-gray-800">{formatPercent(g.current.cvr, 2)}</span>
                    {isWarning(g.changes.cvr) && <AlertTriangle size={10} className="text-amber-500" />}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">客単価</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-gray-800">{formatCurrency(g.current.av)}</span>
                    {isWarning(g.changes.av) && <AlertTriangle size={10} className="text-amber-500" />}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">ROAS</span>
                  <span className="font-medium text-gray-800">{formatPercent(g.current.roas)}</span>
                </div>
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
