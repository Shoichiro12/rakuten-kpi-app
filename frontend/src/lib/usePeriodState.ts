import { useState, useEffect } from 'react'
import { api } from './api'
import { getSundayOfCurrentWeek, getCurrentYearMonth } from './utils'
import type { DataStatus } from '../types'

export type Period = 'weekly' | 'monthly' | 'yearly'

/**
 * 期間セレクタ（週次/月次/年次＋日付）の状態を管理する共通フック。
 *
 * 楽天RMSのデータは「過去の月」のことが多く、初期表示を当週・当月に固定すると
 * 取込み済みでも「データなし」に見えてしまう。これを避けるため、マウント時に
 * /api/data-status から「データが存在する最新期間」を取得し、初期表示と
 * 期間切替時の既定値として優先採用する。
 *
 * ユーザーが日付を手動変更した後は、自動上書きしない（操作を尊重する）。
 * 年次（UIバックログ2026-08-03 区切りB）は暦年固定。dateValue は他期間と同じく
 * 日付文字列のまま持ち、対象年は先頭4桁で表す（例: '2026-01-01'）。
 */
export function usePeriodState() {
  const [period, setPeriodState] = useState<Period>('weekly')
  const [dateValue, setDateValue] = useState(getSundayOfCurrentWeek())
  const [latest, setLatest] = useState<{ week: string | null; month: string | null }>({
    week: null,
    month: null,
  })
  const [touched, setTouched] = useState(false)

  // データのある最新期間を一度だけ取得し、未操作なら初期表示に反映する
  useEffect(() => {
    let cancelled = false
    api
      .dataStatus()
      .then((s) => {
        if (cancelled) return
        const d = s as DataStatus
        const week = d?.rpp?.latest ?? null
        const month = d?.monthly?.latest ?? null
        setLatest({ week, month })
        if (!touched) {
          if (period === 'weekly' && week) setDateValue(week)
          else if (period === 'monthly' && month) setDateValue(`${month}-01`)
          else if (period === 'yearly' && month) setDateValue(`${month.slice(0, 4)}-01-01`)
        }
      })
      .catch(() => {
        /* 取得失敗時は現在期間のまま（ガードのみ） */
      })
    return () => {
      cancelled = true
    }
    // マウント時に一度だけ実行する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 期間種別の切替：データのある最新期間を優先、無ければ現在期間にフォールバック
  const setPeriod = (p: Period) => {
    setPeriodState(p)
    if (p === 'monthly') setDateValue(`${latest.month ?? getCurrentYearMonth()}-01`)
    else if (p === 'yearly') setDateValue(`${(latest.month ?? getCurrentYearMonth()).slice(0, 4)}-01-01`)
    else setDateValue(latest.week ?? getSundayOfCurrentWeek())
  }

  // ユーザーによる日付変更（以後は自動上書きを止める）
  const onDateChange = (d: string) => {
    setTouched(true)
    setDateValue(d)
  }

  // 「最新データへ」ボタン用: 現在の期間種別で、データのある最新期間へジャンプする
  const jumpToLatest = () => {
    setTouched(true)
    if (period === 'monthly' && latest.month) setDateValue(`${latest.month}-01`)
    else if (period === 'yearly' && latest.month) setDateValue(`${latest.month.slice(0, 4)}-01-01`)
    else if (period === 'weekly' && latest.week) setDateValue(latest.week)
  }

  const hasLatest = period === 'weekly' ? latest.week != null : latest.month != null

  return { period, dateValue, setPeriod, setDateValue: onDateChange, jumpToLatest, hasLatest }
}
