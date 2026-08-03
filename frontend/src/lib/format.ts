/**
 * 数値の表示書式（単一の真実）。
 * 規則は docs/ui_number_and_chart_rules_2026-08-04.md を参照。
 *
 * 重要な使い分け:
 *   - 画面表示（KPIカード・グラフの軸） … 丸める（万・億）
 *   - 表・ツールチップ                  … 丸めない
 *   - CSV出力                            … `forExport` を使う。桁区切りも単位も付けない
 *
 * **表示用の関数を CSV 出力に使い回さないこと。** 出力側は機械が読む値であって、人が読む値ではない。
 */

/** 1万 */
const MAN = 10_000
/** 1億 */
const OKU = 100_000_000

/**
 * 金額を日本語の単位で丸める。
 * 日本語圏は3桁ではなく1万単位で数えるため、K/M 表記は使わない。
 *
 *   8,400        → "8,400円"
 *   1,234,500    → "123.5万円"
 *   123,456,789  → "1.23億円"
 */
export function formatYen(value: number | null | undefined, opts?: { unit?: boolean }): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const unit = opts?.unit !== false
  const abs = Math.abs(value)
  const sign = value < 0 ? '-' : ''
  if (abs >= OKU) {
    return `${sign}${trim(abs / OKU, 2)}${unit ? '億円' : '億'}`
  }
  if (abs >= MAN) {
    return `${sign}${trim(abs / MAN, 1)}${unit ? '万円' : '万'}`
  }
  return `${sign}${Math.round(abs).toLocaleString('ja-JP')}${unit ? '円' : ''}`
}

/** グラフの軸ラベル用。単位は短く（"123.5万" / "1.23億"） */
export function formatYenAxis(value: number | null | undefined): string {
  return formatYen(value, { unit: false })
}

/** 丸めない金額（表・ツールチップ用）。"1,234,500円" */
export function formatYenExact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${Math.round(value).toLocaleString('ja-JP')}円`
}

/** 件数・回数など。3桁区切り */
export function formatCount(value: number | null | undefined, suffix = ''): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${Math.round(value).toLocaleString('ja-JP')}${suffix}`
}

/** 率（CVR・CTR・ROAS・ROI・GPR・達成率）。小数1桁で統一 */
export function formatRate(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${trim(value, digits)}%`
}

/**
 * 「割合そのものの差」＝パーセントポイント。
 * CVR 3.42% → 3.24% は -5.3% ではなく -0.18pt。
 * 対象: CVR / CTR / ROAS / ROI / GPR / 達成率
 */
export function formatPoint(diff: number | null | undefined, digits = 2): string {
  if (diff == null || !Number.isFinite(diff)) return '—'
  return `${trim(Math.abs(diff), digits)}pt`
}

/** 変化率（率でない指標の前期比）。符号は矢印が持つので絶対値で返す */
export function formatChangeRate(pct: number | null | undefined, digits = 1): string {
  if (pct == null || !Number.isFinite(pct)) return '—'
  return `${trim(Math.abs(pct), digits)}%`
}

/**
 * CSV・API出力用。**桁区切りも単位も付けない。**
 * 表示用の関数をここに流用しないこと（機械が読む値のため）。
 */
export function forExport(value: number | null | undefined, digits?: number): string {
  if (value == null || !Number.isFinite(value)) return ''
  return digits == null ? String(value) : value.toFixed(digits)
}

/** 末尾の余分な 0 と小数点を落とす（"1.20" → "1.2"、"3.0" → "3"） */
function trim(value: number, digits: number): string {
  const s = value.toFixed(digits)
  if (!s.includes('.')) return Number(s).toLocaleString('ja-JP')
  const [int, frac] = s.split('.')
  const f = frac.replace(/0+$/, '')
  const head = Number(int).toLocaleString('ja-JP')
  return f ? `${head}.${f}` : head
}

/**
 * 「率の変化率(%)」から「率の差(pt)」を復元する。
 *
 * バックエンドが返す `*_wow` / `*_yoy` は**変化率**（(今 - 前) ÷ 前 × 100）。
 * 割合の指標（CVR/CTR/ROAS/ROI/GPR）はこれを pt に直して表示する必要がある。
 *   前 = 今 ÷ (1 + 変化率/100)
 *   差(pt) = 今 - 前
 * 前の値をAPIから取り直さなくても、この式で厳密に復元できる。
 *
 * 例: CVR 3.24%、変化率 -5.3% → 前 3.42% → 差 -0.18pt
 */
export function pointDiffFromChangeRate(
  current: number | null | undefined,
  changePct: number | null | undefined,
): number | null {
  if (current == null || changePct == null) return null
  if (!Number.isFinite(current) || !Number.isFinite(changePct)) return null
  const factor = 1 + changePct / 100
  if (factor === 0) return null // 前期が0で復元できない
  const prev = current / factor
  const diff = current - prev
  return Number.isFinite(diff) ? diff : null
}
