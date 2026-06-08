export interface KPIs {
  gross: number
  cost_of_sales: number
  ad_cost: number
  cv: number
  ct: number
  gp: number
  gpr: number
  av: number
  cvr: number
  roas: number
  cpo: number
  limit_cpo: number
  cpc: number
  ctr: number
  steady_cost: number
  rev: number
  roi: number
}

export interface DashboardData {
  period: 'weekly' | 'monthly'
  period_label: string
  prev_label: string
  kpis: KPIs | null
  target_sales: number
  achievement_rate: number | null
  changes: Record<string, number | null>
}

export interface Alert {
  type: 'warning' | 'danger'
  metric: string
  message: string
}

export interface TrendPoint {
  week: string
  label: string
  gross: number
  gp: number
  ad_cost: number
  rev: number
  roi: number
  roas: number
  cvr: number
  cpc: number
  ctr: number
  cv: number
}

export interface Target {
  year_month: string
  target_sales: number
  target_access: number
  target_cvr: number
  target_av: number
  expense_rate: number
}

export interface ProductKPI extends KPIs {
  product_url: string
  management_no: string
  product_name: string
  genre: string
  week_start: string | null
  limit_cpo_exceeded: boolean
}

export interface GenreKPI {
  genre: string
  current: KPIs
  prev: KPIs | null
  changes: Record<string, number | null>
}

export interface KPITreeNode {
  label: string
  key: string
  target: number
  actual: number
  gap: number
  gap_rate: number
  achieve_rate: number
  unit: 'currency' | 'number' | 'percent'
}

export interface KPITree {
  has_target: boolean
  kgi: KPITreeNode
  access: KPITreeNode
  cvr: KPITreeNode
  av: KPITreeNode
}

export interface DataStatus {
  has_data: boolean
  rpp: { rows: number; weeks: number; latest: string | null }
  monthly: { rows: number; months: number; latest: string | null }
  targets: number
  steps: Array<{ key: 'rpp' | 'monthly' | 'targets'; done: boolean }>
}

/* ─── RPP分析 ───────────────────────────────────────────────── */

export interface RppWeeklyPeriod {
  year_month: string
  date_from: string
  date_to: string
}

export interface RppMonthlyPeriod {
  year_month: string
}

export interface RppPeriods {
  weekly: RppWeeklyPeriod[]
  monthly: RppMonthlyPeriod[]
}

export interface RppSalesItem {
  id: number
  period_type: 'weekly' | 'monthly'
  date_from: string
  date_to: string
  item_code: string | null
  item_url: string | null
  product_name: string | null
  ad_cost: number | null
  gross_720: number | null
  cv_720: number | null
  roas_720: number | null
  cpo_720: number | null
  cvr_720: number | null
  gross_12: number | null
  cv_12: number | null
  roas_12: number | null
  cpo_12: number | null
  cvr_12: number | null
}

export interface RppSalesResponse {
  total: number
  count: number
  offset: number
  limit: number
  items: RppSalesItem[]
}

export interface RppSummaryData {
  total_ad_cost: number | null
  total_ct: number | null
  avg_cpc: number | null
  total_gross_720: number | null
  roas_720: number | null
  cpo_720: number | null
  cvr_720: number | null
  total_gross_12: number | null
  roas_12: number | null
  cpo_12: number | null
  cvr_12: number | null
}

export interface RppSummaryResponse {
  period_type: string
  year_month: string
  count: number
  summary: RppSummaryData
}

export interface RppImportResult {
  message?: string
  inserted?: number
  updated?: number
  period_types?: string[]
  year_months?: string[]
  format?: string
}
