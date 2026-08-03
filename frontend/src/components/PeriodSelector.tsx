import { useRef } from 'react'
import { ChevronLeft, ChevronRight, CalendarCheck } from 'lucide-react'
import type { Period } from '../lib/usePeriodState'

/**
 * 期間切り替えUI（UIバックログ2026-08-03 区切りB で刷新）。
 *
 * 旧UIの課題への対応:
 * - 「今どの集計期間を見ているか」が分からない → 実際の集計期間をラベルで常時表示
 *   （週次は日曜起点の週の範囲、月次は年月、年次は年）
 * - 週次のdate inputで任意の日付が選べて内部の週丸めとずれて見える →
 *   ラベル中央＋前後矢印を主導線にし、ピッカーはラベルクリック時のみ（週次は
 *   選んだ日付を含む「日曜起点の週」に丸めてから反映する）
 * - 最新データに戻る手段が無い → 「最新データへ」ボタンを追加
 *
 * 年次は暦年固定。診断・アラート系は月次のまま（呼び出し側で注記を出す）。
 */
interface PeriodSelectorProps {
  period: Period
  onPeriodChange: (p: Period) => void
  dateValue: string
  onDateChange: (d: string) => void
  /** データのある最新期間へジャンプ（usePeriodState.jumpToLatest）。未指定なら非表示 */
  onJumpToLatest?: () => void
  /** 年次を出さない画面用（既定 true=表示） */
  allowYearly?: boolean
}

const PERIOD_LABELS: { key: Period; label: string }[] = [
  { key: 'weekly', label: '週次' },
  { key: 'monthly', label: '月次' },
  { key: 'yearly', label: '年次' },
]

/** 日曜起点の週頭に丸める（バックエンド get_week_start と同一ロジック） */
function toSunday(d: Date): Date {
  const r = new Date(d)
  r.setDate(r.getDate() - (r.getDay() % 7))
  return r
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function PeriodSelector({
  period,
  onPeriodChange,
  dateValue,
  onDateChange,
  onJumpToLatest,
  allowYearly = true,
}: PeriodSelectorProps) {
  const pickerRef = useRef<HTMLInputElement>(null)
  const yearRef = useRef<HTMLSelectElement>(null)

  const shift = (direction: 1 | -1) => {
    if (period === 'weekly') {
      const d = new Date(dateValue)
      d.setDate(d.getDate() + direction * 7)
      onDateChange(fmtDate(d))
    } else if (period === 'monthly') {
      const [year, month] = dateValue.split('-').map(Number)
      const next = new Date(year, month - 1 + direction, 1)
      onDateChange(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`)
    } else {
      const year = Number(dateValue.slice(0, 4)) + direction
      onDateChange(`${year}-01-01`)
    }
  }

  // 実際の集計期間のラベル（表示と集計のずれを無くす）
  const label = (() => {
    if (period === 'weekly') {
      const start = toSunday(new Date(dateValue))
      const end = new Date(start)
      end.setDate(end.getDate() + 6)
      const endPart = start.getMonth() === end.getMonth()
        ? `${end.getDate()}`
        : `${end.getMonth() + 1}/${end.getDate()}`
      return `${start.getFullYear()}/${start.getMonth() + 1}/${start.getDate()}〜${endPart}`
    }
    if (period === 'monthly') {
      return `${dateValue.slice(0, 4)}年${Number(dateValue.slice(5, 7))}月`
    }
    return `${dateValue.slice(0, 4)}年`
  })()

  const openPicker = () => {
    const el: HTMLInputElement | HTMLSelectElement | null =
      period === 'yearly' ? yearRef.current : pickerRef.current
    if (!el) return
    const maybe = el as HTMLInputElement & { showPicker?: () => void }
    if (typeof maybe.showPicker === 'function') maybe.showPicker()
  }

  const onPick = (value: string) => {
    if (!value) return
    if (period === 'weekly') {
      // 選んだ日付を含む「日曜起点の週」に丸めてから反映（表示との一致を保証）
      onDateChange(fmtDate(toSunday(new Date(value))))
    } else if (period === 'monthly') {
      onDateChange(`${value.slice(0, 7)}-01`)
    } else {
      onDateChange(`${value.slice(0, 4)}-01-01`)
    }
  }

  const periods = allowYearly ? PERIOD_LABELS : PERIOD_LABELS.filter((p) => p.key !== 'yearly')

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* 期間種別セグメント */}
      <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm" role="group" aria-label="期間の種別">
        {periods.map(({ key, label: pl }, i) => (
          <button
            key={key}
            onClick={() => onPeriodChange(key)}
            aria-pressed={period === key}
            className={`px-3 py-1.5 transition-colors ${i > 0 ? 'border-l border-gray-200' : ''} ${
              period === key ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {pl}
          </button>
        ))}
      </div>

      {/* 期間ナビ: ◀ 期間ラベル ▶（ラベルクリックでピッカー） */}
      <div className="flex items-center rounded-lg border border-gray-200 overflow-hidden bg-white">
        <button onClick={() => shift(-1)} aria-label="前の期間へ" className="p-1.5 hover:bg-gray-100 text-gray-600">
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button
          onClick={openPicker}
          title="クリックして期間を選択"
          className="relative px-2.5 py-1.5 text-sm font-medium text-gray-800 tabular-nums whitespace-nowrap hover:bg-gray-50 min-w-[7.5rem] text-center"
        >
          {label}
          {/* 不可視のネイティブピッカー（ラベルクリックで開く） */}
          {period === 'yearly' ? (
            <select
              ref={yearRef}
              value={dateValue.slice(0, 4)}
              onChange={(e) => onPick(`${e.target.value}-01-01`)}
              aria-label="対象年を選択"
              tabIndex={-1}
              className="absolute inset-0 opacity-0 cursor-pointer"
            >
              {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() + 1 - i).map((y) => (
                <option key={y} value={y}>{y}年</option>
              ))}
            </select>
          ) : (
            <input
              ref={pickerRef}
              type={period === 'weekly' ? 'date' : 'month'}
              value={period === 'weekly' ? dateValue : dateValue.slice(0, 7)}
              onChange={(e) => onPick(e.target.value)}
              aria-label={period === 'weekly' ? '週（含まれる日付）を選択' : '対象月を選択'}
              tabIndex={-1}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          )}
        </button>
        <button onClick={() => shift(1)} aria-label="次の期間へ" className="p-1.5 hover:bg-gray-100 text-gray-600">
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>

      {/* 最新データへ */}
      {onJumpToLatest && (
        <button
          onClick={onJumpToLatest}
          title="データが取り込まれている最新の期間へ移動"
          className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded transition-colors"
        >
          <CalendarCheck size={13} aria-hidden="true" />最新データへ
        </button>
      )}
    </div>
  )
}
