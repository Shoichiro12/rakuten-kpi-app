export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—'
  return `¥${Math.round(value).toLocaleString('ja-JP')}`
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—'
  return Math.round(value).toLocaleString('ja-JP')
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null) return '—'
  return `${value.toFixed(digits)}%`
}

export function formatChange(value: number | null | undefined): { text: string; positive: boolean | null } {
  if (value == null) return { text: '—', positive: null }
  const sign = value > 0 ? '+' : ''
  return {
    text: `${sign}${value.toFixed(1)}%`,
    positive: value > 0,
  }
}

/**
 * メールアドレスをマスクして表示する。ローカル部の先頭数文字だけ残して伏せる。
 * 例: k11mm121@gmail.com → k11m***@gmail.com / ab@x.com → a***@x.com
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return ''
  const at = email.lastIndexOf('@')
  if (at <= 0) return email // @ が無い/先頭にある場合はそのまま
  const local = email.slice(0, at)
  const domain = email.slice(at) // '@' を含むドメイン部
  const keep = Math.min(4, Math.max(1, local.length - 1))
  return `${local.slice(0, keep)}***${domain}`
}

export function getWeekSunday(d: Date = new Date()): Date {
  const day = d.getDay() // 0=Sun
  const diff = d.getDate() - day
  return new Date(d.setDate(diff))
}

export function formatDateJP(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export function toDateInputValue(d: Date): string {
  return d.toISOString().split('T')[0]
}

export function getCurrentYearMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function getSundayOfCurrentWeek(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day
  const sunday = new Date(now)
  sunday.setDate(diff)
  return sunday.toISOString().split('T')[0]
}
