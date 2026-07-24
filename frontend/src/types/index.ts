/**
 * アクセス指標の軸（要件No.5）。母数が異なるため混在させない。
 * - rpp_click: RppWeekly.ct（RPP広告クリック数）。cvr = cv/ct（クリック→注文）
 * - site_uu  : MonthlyItemSales.access_uu（店舗ページ訪問UU）。cvr = cv/uu（訪問→注文）
 * バックエンド backend/access_definitions.py が単一の真実。
 */
export type AccessAxis = 'rpp_click' | 'site_uu'

/** アクセス軸の表示ラベル（UIで「アクセス」単独表示を避けるため統一） */
export const ACCESS_AXIS_LABEL: Record<AccessAxis, string> = {
  rpp_click: 'アクセス（RPPクリック）',
  site_uu: 'アクセス（UU）',
}

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

export interface ShopMetrics {
  sales: number
  access: number
  cv: number
  cvr: number
  av: number
}

export interface DashboardData {
  period: 'weekly' | 'monthly'
  period_label: string
  prev_label: string
  kpis: KPIs | null
  shop?: ShopMetrics | null
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
  ct: number
}

export interface Target {
  year_month: string
  target_sales: number
  target_access: number
  target_cvr: number
  target_av: number
  expense_rate: number
}

export interface Shop {
  id: number
  name: string
  mall_type: string
  default_cost_rate: number
  default_expense_rate: number
  restock_lead_days: number
  is_active: boolean
}

export interface MasterProduct {
  id: number
  management_no: string
  product_name: string | null
  product_url: string | null
  shop_id: number | null
  category_id: number | null
  genre_u1: string | null
  genre_u2: string | null
  genre_u3: string | null
  is_active: boolean
  updated_at: string | null
}

export interface MasterProductsResponse {
  count: number
  items: MasterProduct[]
}

export interface Category {
  id: number
  genre_u1: string | null
  genre_u2: string | null
  genre_u3: string | null
}

export interface CategoriesResponse {
  count: number
  items: Category[]
}

/** 楽天ジャンルマスタの3階層ツリー { 大分類: { 中分類: [小分類, ...] } } */
export type GenreTree = Record<string, Record<string, string[]>>

/** カテゴリ選択ピッカーが扱う大/中/小の値 */
export interface GenreValue {
  genre_u1: string
  genre_u2: string
  genre_u3: string
}

export interface CostItem {
  management_no: string
  product_name: string | null
  cost_rate: number
  source: 'product' | 'default'
  memo: string | null
  is_active: boolean | null
}

export interface CostsResponse {
  default_cost_rate: number
  count: number
  items: CostItem[]
}

/* ─── 商品マスタ入力支援（自動提案キュー） ─────────────────── */
/** 提案の信頼度。high=まとめて承認の対象 / low=個別承認のみ */
export type Confidence = 'high' | 'low'

export interface CategorySuggestion {
  category_id: number
  label: string
  basis: string
  confidence: Confidence
}

export interface CostRateSuggestion {
  suggested_rate: number
  basis: string
  confidence: Confidence
}

export interface SuggestionItem {
  management_no: string
  product_name: string | null
  current: { category_id: number | null; cost_rate: number | null }
  suggested: {
    /** カテゴリ確定済みなら null。該当候補なしなら null（新規作成を促す） */
    category: CategorySuggestion | null
    cost_rate: CostRateSuggestion
  }
}

export interface SuggestionsResponse {
  count: number
  items: SuggestionItem[]
}

/* ─── アクションサマリ（スコープ内の課題集中度） ─────────────────── */
export interface ActionSummaryItem {
  action_key: string
  label: string
  metric: string | null
  priority: 'critical' | 'recommended' | 'check'
  affected_count: number
  impact_estimate: number
  sample_products: { management_no: string | null; product_name: string | null }[]
}

export interface ActionSummaryResponse {
  scope: 'shop' | 'genre'
  genre: string | null
  year_month: string | null
  count: number
  items: ActionSummaryItem[]
}

export interface InventoryAlert {
  management_no: string
  product_name: string | null
  status: 'out' | 'low'
  stock_count: number
  zero_stock_days: number
  days_left: number | null
  sales: number
  value_at_risk: number
}

export interface InventoryAlertsResponse {
  year_month: string | null
  count: number
  out_count: number
  low_count: number
  threshold_days: number
  items: InventoryAlert[]
}

export interface ProductKPI extends KPIs {
  product_url: string
  management_no: string
  product_name: string
  genre: string
  week_start: string | null
  limit_cpo_exceeded: boolean
  is_active?: boolean
  /** アクセス指標の軸（要件No.5） */
  access_axis?: AccessAxis
  /** アクセス母数が閾値以上か。false ならCVR・客単価は参考値（要件No.6） */
  reliable?: boolean
}

export interface GenreKPI {
  genre: string
  current: KPIs
  prev: KPIs | null
  changes: Record<string, number | null>
  /** アクセス指標の軸（要件No.5） */
  access_axis?: AccessAxis
  /** アクセス母数が閾値以上か。false ならCVR・客単価は参考値（要件No.6） */
  reliable?: boolean
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
  /** 集計データ軸: shop=店舗全体UU（商品分析） / rpp=RPP広告クリック数 */
  axis?: 'shop' | 'rpp'
  /** アクセス指標の軸（要件No.5） */
  access_axis?: AccessAxis
  /** アクセス母数が閾値以上か。false ならCVR・客単価は参考値（要件No.6） */
  reliable?: boolean
  kgi: KPITreeNode
  access: KPITreeNode
  cvr: KPITreeNode
  av: KPITreeNode
}

/* ─── 評価マトリクス（17パターン・目標×YoY統一判定） ─────────── */

export interface EvaluationJudge {
  key: string
  label: string
  actual: number
  target: number | null
  achieve_rate: number | null
  prev_year: number | null
  yoy_rate: number | null
  target_ok: boolean | null
  yoy_ok: boolean | null
  achieved: boolean | null
  basis: 'target' | 'yoy' | null
  /** 100UUルールにより評価対象外（母数不足） */
  excluded?: boolean
}

export interface EvaluationResult {
  pattern_no: number
  rank: '◎' | '○' | '△' | '×' | '−'
  priority: '維持' | '中' | '高' | '−'
  focus: Array<'access' | 'cvr' | 'av'>
  comment: string
  metrics: {
    sales: EvaluationJudge
    access: EvaluationJudge
    cvr: EvaluationJudge
    av: EvaluationJudge
  }
  undetermined: string[]
  /** アクセス母数不足（100UUルール適用中） */
  low_sample?: boolean
  /** 母数不足の閾値（デフォルト100） */
  min_access?: number
  /** アクセス指標の軸（要件No.5） */
  access_axis?: AccessAxis
}

export interface EvaluationMatrixResponse {
  period: 'weekly' | 'monthly'
  period_label: string
  has_data: boolean
  has_target?: boolean
  /** アクセスのデータ軸: shop=店舗全体UU（商品分析） / rpp=RPP広告クリック数 */
  axis?: 'shop' | 'rpp'
  /** アクセス指標の軸（要件No.5） */
  access_axis?: AccessAxis
  evaluation: EvaluationResult | null
}

/* ─── アクセス逆算プラン ──────────────────────────────────────── */

export interface AccessPlan {
  target_sales: number
  actual_gross: number
  actual_ct: number
  cvr: number
  av: number
  cpc: number
  ad_cost: number
  required_access: number
  shortfall_ct: number
  est_additional_ad_cost: number | null
  fill_rate: number | null
  achieved: boolean
}

export interface AccessPlanResponse {
  period: 'weekly' | 'monthly'
  period_label: string
  has_data: boolean
  has_target: boolean
  plan: AccessPlan | null
}

/* ─── 在庫ステータス（自動連携対応） ──────────────────────────── */

export interface InventoryInfo {
  product_url: string | null
  management_no?: string | null
  has_inventory: boolean
  is_active?: boolean | null
  source: 'auto' | 'manual' | 'inactive'
  stock_count: number | null
  zero_stock_days: number | null
  year_month: string | null
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

export interface MonthlyItemsPeriod {
  year_month: string
  rows: number
}

export interface MonthlyItemsPeriodsResponse {
  months: MonthlyItemsPeriod[]
}

export interface DeleteResult {
  message: string
  deleted?: number
  deleted_sales?: number
  deleted_weekly?: number
}

/* ─── データ整合性チェック（二重計上の常時監視） ─────────────── */

export interface IntegrityIssue {
  type: string
  year_month: string | null
  rows: number
  fixable: boolean
  detail: string
}

export interface IntegrityResponse {
  ok: boolean
  issues: IntegrityIssue[]
}

export interface IntegrityFixResult {
  message: string
  deleted: number
  fixed_months: string[]
}

export interface RppImportResult {
  message?: string
  inserted?: number
  updated?: number
  period_types?: string[]
  year_months?: string[]
  format?: string
}

/* ─── かんたん取込み（zip・複数ファイル・自動判別） ───────────── */

export interface AutoImportItemResult {
  source: string
  kind: 'rpp' | 'monthly' | 'unknown'
  ok: boolean
  message: string
  count?: number
  inserted?: number
  updated?: number
  year_month?: string
}

export interface AutoImportResponse {
  results: AutoImportItemResult[]
  ok_count: number
  ng_count: number
}

export interface InboxFile {
  name: string
  size: number
  modified: string
  kind_guess: 'rpp' | 'monthly'
}

export interface InboxListResponse {
  dir: string
  files: InboxFile[]
}

/* ─── RPP診断（RppAnalysisページ専用） ────────────────────────── */

/** 確信度。needs_check はキーワード別レポート取込後に confirmed へ昇格予定 */
export type RppConfidence = 'confirmed' | 'needs_check' | 'info'
export type RppDiagnosisStatus = 'insufficient_data' | 'issues' | 'good'

/** 既存ActionPanelのActionDefと同構造 + confidence（バックエンドRPP_ACTIONSと対応） */
export interface RppActionDef {
  key: string
  category: 'Promotion' | 'Price' | 'Product' | 'Place' | '仕入れ'
  confidence: RppConfidence
  text: string
  detail?: string
}

export interface RppDiagnosisIssue {
  issue: string
  confidence: RppConfidence
  action_key: string | null
  label: string
  action: RppActionDef | null
}

export interface RppDiagnosisMetrics {
  ct: number
  ctr: number
  cvr_720: number
  roas_720: number
  cpo_720: number
  cpc: number
  prev_cpc: number | null
  cpc_change_rate: number | null
  ad_cost: number
  gross_720: number
  cv_720: number
  bid_price: number
}

export interface RppDiagnosisItem {
  management_no: string
  product_name: string | null
  item_url: string | null
  status: RppDiagnosisStatus
  issues: RppDiagnosisIssue[]
  metrics: RppDiagnosisMetrics
}

export interface RppDiagnosisBenchmarks {
  avg_ctr?: number
  avg_cvr?: number
  roas_line?: number
  ctr_ratio?: number
  cvr_ratio?: number
  cpc_spike_rate?: number
}

export interface RppDiagnosisResponse {
  period_type: 'weekly' | 'monthly'
  year_month: string | null
  date_from: string | null
  date_to: string | null
  /** チェック状態保存用キー（weekly=date_from / monthly=year_month） */
  period_key: string
  /** 原価データが無いためLimit CPO判定は現状スキップ（false） */
  cpo_evaluable: boolean
  cpo_skip_reason: string
  min_ct: number
  issue_labels: Record<string, string>
  actions: RppActionDef[]
  benchmarks: RppDiagnosisBenchmarks
  items: RppDiagnosisItem[]
}


export type RecommendationPriority = 'critical' | 'recommended' | 'check'

export interface Recommendation {
  key: string
  priority: RecommendationPriority
  metric: string
  title: string
  reason: string
  impact: string | null
  effort: string
  badges: string[]
  link: string | null
  /** 商品単位の提案のみ設定される（店舗全体の提案では undefined） */
  product_name?: string
  management_no?: string
  impact_value?: number
}

export interface RecommendationsResponse {
  period: 'weekly' | 'monthly'
  period_label: string
  period_key: string
  target_gap: number | null
  recommendations: Recommendation[]
  /** 商品単位の提案（どの商品の何を直すか）。機会損失の大きい順。 */
  product_recommendations?: Recommendation[]
  done_count: number
}

/** 実施した施策の「その後」（Phase 2 の効果測定） */
export interface ActionOutcome {
  action_key: string
  title: string | null
  period_key: string
  status: 'measured' | 'pending' | 'not_applicable'
  metric: string | null
  metric_label: string | null
  before: number | null
  after: number | null
  delta_pct: number | null
  next_period: string | null
}

export interface OutcomeSummary {
  count: number
  positive: number
  metric: string | null
  metric_label: string | null
  avg_delta_pct: number | null
}

export interface OutcomesResponse {
  results: ActionOutcome[]
  summary: Record<string, OutcomeSummary>
  measured_count: number
  pending_count: number
  /** この件数未満は提案順位に反映しない（偶然を学習しないため） */
  min_sample_for_weight: number
}
