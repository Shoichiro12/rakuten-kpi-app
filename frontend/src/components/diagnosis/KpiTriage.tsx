import { FOCUS_RING } from '../../lib/a11y'

export interface TriageItem {
  key: 'access' | 'cvr' | 'av'
  label: string
  value: string
  /** 目標比較ができるか（月次・年次のみ true。週次は target_comparable=false のため常に false） */
  comparable: boolean
  achieved: boolean | null
  achieveRate: number | null
  /** 前期比（comparable=false のときの判定材料） */
  change: number | null
  changeUnit: '%' | 'pt'
  neutral: boolean
}

interface KpiTriageProps {
  items: TriageItem[]
  selectedKpi: 'access' | 'cvr' | 'av' | null
  onSelect: (kpi: 'access' | 'cvr' | 'av') => void
}

function pickWorst(items: TriageItem[]): TriageItem | null {
  const comparableItems = items.filter((i) => i.comparable && i.achieveRate != null)
  if (comparableItems.length > 0) {
    return comparableItems.reduce((a, b) => ((a.achieveRate as number) < (b.achieveRate as number) ? a : b))
  }
  const withChange = items.filter((i) => i.change != null)
  if (withChange.length === 0) return null
  return withChange.reduce((a, b) => ((a.change as number) < (b.change as number) ? a : b))
}

function changeText(item: TriageItem): string {
  if (item.change == null) return '前期のデータなし'
  const sign = item.change >= 0 ? '+' : ''
  return `${sign}${item.change.toFixed(item.changeUnit === 'pt' ? 2 : 1)}${item.changeUnit} 前期比`
}

/**
 * 段2（要因）。3KPI（アクセス/CVR/客単価）のうち最も悪いものだけを
 * 左赤罫の主カードで立て、残り2つは細い行にする（計画書 v5モックの非対称レイアウト）。
 * 達成済みのKPIは薄く・クリック不可にし「達成」とだけ示す。
 */
export default function KpiTriage({ items, selectedKpi, onSelect }: KpiTriageProps) {
  if (items.length === 0) return null
  const worst = pickWorst(items)
  const comparable = items.some((i) => i.comparable)

  return (
    <div className="bg-paper rounded-xl border border-line p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink">何が足りていないか</h3>
        <span className="text-xs text-muted">
          {comparable ? '達成している指標は掘り下げ不要' : '週次は目標比較なし。前期比で判定しています'}
        </span>
      </div>

      {worst && (
        <button
          type="button"
          onClick={() => onSelect(worst.key)}
          aria-pressed={selectedKpi === worst.key}
          className={`w-full flex items-center justify-between gap-4 rounded-lg border border-line border-l-[3px] border-l-alert bg-paper px-4 py-3.5 text-left transition-colors hover:bg-bg-alt mb-1 ${FOCUS_RING}`}
        >
          <div>
            <p className="text-xs text-muted">{worst.label}</p>
            <p className="font-num text-[22px] leading-tight font-bold text-alert tabular-nums">{worst.value}</p>
          </div>
          <div className="text-right shrink-0">
            {worst.comparable && worst.achieveRate != null ? (
              <>
                <span className="block text-xs text-muted">目標比</span>
                <span className="font-num block text-sm font-bold text-alert tabular-nums">
                  {worst.achieveRate.toFixed(1)}%
                </span>
              </>
            ) : (
              <span className="font-num block text-xs font-semibold text-alert tabular-nums">
                {changeText(worst)}
              </span>
            )}
            <span className="block text-xs text-sage-deep mt-0.5">詳しく見る ›</span>
          </div>
        </button>
      )}

      <div className="px-1">
        {items
          .filter((i) => i.key !== worst?.key)
          .map((item) => {
            const achieved = item.comparable && item.achieved === true
            return (
              <div
                key={item.key}
                role={achieved ? undefined : 'button'}
                tabIndex={achieved ? undefined : 0}
                onClick={achieved ? undefined : () => onSelect(item.key)}
                onKeyDown={
                  achieved
                    ? undefined
                    : (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onSelect(item.key)
                        }
                      }
                }
                aria-pressed={achieved ? undefined : selectedKpi === item.key}
                className={`flex items-center justify-between py-2.5 border-b border-line last:border-b-0 text-sm ${
                  achieved ? 'opacity-50' : `cursor-pointer rounded -mx-1 px-1 hover:bg-bg-alt ${FOCUS_RING}`
                }`}
              >
                <span className="text-sub">{item.label}</span>
                <span className="flex items-center gap-2">
                  <span
                    className={`font-num text-sm tabular-nums ${
                      achieved ? 'text-up font-semibold' : item.neutral ? 'text-ink' : 'text-ink font-semibold'
                    }`}
                  >
                    {item.value}
                  </span>
                  <span className="text-xs text-muted">
                    {item.comparable && item.achieveRate != null
                      ? achieved
                        ? `達成 ${item.achieveRate.toFixed(1)}%`
                        : `目標比 ${item.achieveRate.toFixed(1)}%`
                      : changeText(item)}
                  </span>
                </span>
              </div>
            )
          })}
      </div>

      {worst && (
        <p className="mt-3 pt-3 border-t border-line text-xs text-sub">
          最もギャップが大きいのは<b className="text-ink">{worst.label}</b>です。まずここから見ます。
        </p>
      )}
    </div>
  )
}
