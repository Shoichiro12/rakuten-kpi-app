/**
 * 指標メタの単一の真実。
 *
 * **`up = 緑` を全指標に当ててはいけない。** CPC が上がって緑になる事故が起きる。
 * Plausible / Grafana / Datadog はいずれも指標ごとに方向を持たせている（Datadog には「中立」もある）。
 * 規則は docs/ui_number_and_chart_rules_2026-08-04.md の 1-7。
 */

/** 良い方向。neutral は色を付けない（単体では良し悪しが決まらない指標） */
export type Direction = 'up' | 'down' | 'neutral'

export interface MetricMeta {
  label: string
  /** 'yen' = 金額（万・億で丸める） / 'rate' = 割合（差は pt） / 'count' = 件数 */
  kind: 'yen' | 'rate' | 'count'
  direction: Direction
  /** ⚠️判定のしきい値。生の数値で比較すること（表示用に丸めた文字列で比較しない） */
  threshold?: { value: number; comparator: 'lt' | 'gt'; label: string }
  /** この母数を下回る期間は値と前期比を出さない */
  minSample?: { field: string; value: number; label: string }
}

export const METRICS = {
  gross: { label: 'RPP売上（Gross）', kind: 'yen', direction: 'up' },
  gp: { label: '売上総利益（GP）', kind: 'yen', direction: 'up' },
  rev: { label: 'Rev（営業利益）', kind: 'yen', direction: 'up' },
  av: { label: '客単価（Av）', kind: 'yen', direction: 'up' },

  gpr: { label: 'GPR（売上総利益率）', kind: 'rate', direction: 'up' },
  roi: {
    label: 'ROI（投資利益率）', kind: 'rate', direction: 'up',
    threshold: { value: 100, comparator: 'lt', label: '100%未満' },
  },
  roas: { label: 'ROAS（売上回収率）', kind: 'rate', direction: 'up' },
  cvr: {
    label: 'CVR（注文率）', kind: 'rate', direction: 'up',
    minSample: { field: 'ct', value: 30, label: 'クリック' },
  },
  ctr: {
    label: 'CTR（平均クリック率）', kind: 'rate', direction: 'up',
    threshold: { value: 1, comparator: 'lt', label: '1%未満' },
  },
  achievement: { label: '達成率', kind: 'rate', direction: 'up' },

  // 下がったら良い指標。ここを間違えると上昇が緑になる
  ad_cost: { label: '広告費（AdCost）', kind: 'yen', direction: 'down' },
  cpc: { label: 'CPC（平均クリック単価）', kind: 'yen', direction: 'down' },
  cpo: {
    label: 'CPO（注文獲得単価）', kind: 'yen', direction: 'down',
    minSample: { field: 'cv', value: 5, label: '注文' },
  },

  // 中立。売上に比例して増えるので単体では良し悪しが決まらない（効率は GPR と Rev が見る）
  ct: { label: 'クリック数（CT）', kind: 'count', direction: 'neutral' },
  cv: { label: '注文件数（CV）', kind: 'count', direction: 'neutral' },
  access: { label: 'アクセス（UU）', kind: 'count', direction: 'neutral' },
  cost_of_sales: { label: '売上原価', kind: 'yen', direction: 'neutral' },
  steady_cost: { label: '店舗運営経費', kind: 'yen', direction: 'neutral' },
  limit_cpo: { label: 'Limit CPO（限界CPO）', kind: 'yen', direction: 'neutral' },
} as const satisfies Record<string, MetricMeta>

export type MetricKey = keyof typeof METRICS

export function metaOf(key: MetricKey): MetricMeta {
  return METRICS[key]
}

/** 割合の指標かどうか（前期比を pt で出すかの判定） */
export function isRate(key: MetricKey): boolean {
  return METRICS[key].kind === 'rate'
}

/**
 * 前期比の色を決める。**方向は指標メタから引く。呼び出し側で up=緑 と決め打ちしない。**
 * 戻り値: 'good' | 'bad' | 'neutral'
 */
export function deltaTone(key: MetricKey, diff: number | null | undefined): 'good' | 'bad' | 'neutral' {
  if (diff == null || !Number.isFinite(diff) || diff === 0) return 'neutral'
  const dir = METRICS[key].direction
  if (dir === 'neutral') return 'neutral'
  const improved = dir === 'up' ? diff > 0 : diff < 0
  return improved ? 'good' : 'bad'
}
