/**
 * GAP分析の「選択したKPIを主役にする」表示と、ジャンル・商品の並べ替えの共通ロジック。
 *
 * ■ 並び順は**選択KPIに関係なく「売上の前期比が悪い順」で固定**（2026-08-04 オーナー決定）
 *   選んだKPIごとに並び替え軸を切り替える作りは**採らない**。
 *   売上が主で、アクセス・CVR・客単価はその分解でしかないため、
 *   「どこを直すと売上に効くか」を探す順番は常に売上の落ち込みで決める。
 *   **この方針を「選択KPI基準に戻したほうが親切では」と後から変えないこと。**
 *
 * ■ 基準は「前期比」であって「目標比」ではない
 *   ジャンル・商品の階層には目標値が無い（`/api/gap/genre` `/api/gap/product` は
 *   目標を返さない。アイテム別目標は商品単位の任意入力で、全商品を覆っていない）。
 *   そのため乖離＝前期からの落ち込みで並べる。**画面には基準を必ず明記すること**
 *   （基準の無い「-10%」は意味がない、が数字の規約）。
 *
 * ■ 割合の指標は pt、それ以外は変化率(%)
 *   CVR は「割合そのものの差」なので pt で扱う（カードの主役指標の前期比表示に使う）。
 */

import type { KPIs } from '../../types'
import type { MetricKey } from '../../lib/metrics'
import { pointDiffFromChangeRate } from '../../lib/format'

/** ロジックツリーで選べるKPI */
export type GapKpi = 'access' | 'cvr' | 'av'

/** 前期比つきの行（ジャンルカード・商品行の共通形） */
export interface GapRow {
  current: KPIs
  prev: KPIs | null
  changes: Record<string, number | null>
}

/** 集計軸が商品分析（店舗全体UU）かどうか */
export function isShopAxis(axis?: string | null): boolean {
  return axis === 'shop' || axis === 'site_uu'
}

/** KPIの表示ラベル。アクセスは軸で名前が変わる（軸を混ぜない規約） */
export function gapKpiLabel(kpi: GapKpi, axis?: string | null): string {
  if (kpi === 'cvr') return '転換率（CVR）'
  if (kpi === 'av') return '客単価'
  return isShopAxis(axis) ? 'アクセス（UU）' : 'アクセス（RPPクリック）'
}

/** 指標メタのキー。色と pt/% の判定はここから引く（up=緑 と決め打ちしない） */
export function gapMetricKey(kpi: GapKpi, axis?: string | null): MetricKey {
  if (kpi === 'cvr') return 'cvr'
  if (kpi === 'av') return 'av'
  return isShopAxis(axis) ? 'access' : 'ct'
}

/** KPIの実測値を取り出す。アクセスは両軸とも `ct` に入っている（shop軸では access のミラー） */
export function gapKpiValue(row: GapRow, kpi: GapKpi): number | null {
  const c = row.current
  if (!c) return null
  if (kpi === 'cvr') return c.cvr ?? null
  if (kpi === 'av') return c.av ?? null
  return c.ct ?? null
}

/**
 * 前期からの動き。**CVRは pt、アクセス・客単価は変化率(%)。**
 *
 * 前期の実測値（`prev`）があるときはそこから直接計算する（厳密）。
 * 無いときだけ `changes` の変化率から復元する。
 * 週次（RPP軸）は `changes` にアクセスの項目が無いため、この二段構えが要る。
 */
export function gapKpiDelta(row: GapRow, kpi: GapKpi): number | null {
  const cur = gapKpiValue(row, kpi)
  const prev = row.prev
    ? kpi === 'cvr' ? row.prev.cvr : kpi === 'av' ? row.prev.av : row.prev.ct
    : null

  if (kpi === 'cvr') {
    // 割合の差 = pt
    if (cur != null && prev != null) return cur - prev
    return pointDiffFromChangeRate(cur, row.changes?.cvr)
  }

  const changeKey = kpi === 'av' ? 'av' : 'access'
  const fromApi = row.changes?.[changeKey] ?? (kpi === 'access' ? row.changes?.ct : null)
  if (fromApi != null) return fromApi
  if (cur != null && prev != null && prev !== 0) return ((cur - prev) / prev) * 100
  return null
}

/** 売上の前期比（変化率%）。API が返さない場合だけ実測値から計算する */
export function salesGapDelta(row: GapRow): number | null {
  const fromApi = row.changes?.gross
  if (fromApi != null && Number.isFinite(fromApi)) return fromApi
  const cur = row.current?.gross
  const prev = row.prev?.gross
  if (cur != null && prev != null && prev !== 0) return ((cur - prev) / prev) * 100
  return null
}

/**
 * **売上の落ち込みが大きい順**（悪化 → 改善）に並べ替える。ジャンルカードと商品テーブル共通。
 *
 * 選択KPIでは切り替えない（この関数に KPI を渡さないのは意図的。冒頭のコメント参照）。
 *
 * - 前期比が取れない行は方向に関係なく末尾（「データ無し」を上位に出さない。
 *   `useTableSort` の空値ルールと同じ考え方）
 * - 破壊的ソートを避けるため必ずコピーしてから並べ替える
 */
export function orderBySalesGap<T extends GapRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const da = salesGapDelta(a)
    const db = salesGapDelta(b)
    const aEmpty = da == null || !Number.isFinite(da)
    const bEmpty = db == null || !Number.isFinite(db)
    if (aEmpty && bEmpty) return 0
    if (aEmpty) return 1
    if (bEmpty) return -1
    return da - db // 昇順＝マイナスが大きいものが先頭
  })
}

/** 並び順の根拠を画面に出すための文言（基準を書かない数字は出さない） */
export const SALES_ORDER_NOTE = '売上の前期比が悪い順'
