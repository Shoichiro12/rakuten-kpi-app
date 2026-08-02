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
  /** 年間売上予算（円）。null=未設定（売上予算プランはオフ表示） */
  annual_sales_budget: number | null
  /** 予算年度の起点月（1〜12、既定1=暦年） */
  budget_year_start_month: number
  is_active: boolean
}

/* ─── 売上予算プラン（第4段階v2 / /api/revenue-plan） ─────────────── */

export type RevenuePlanStatus = 'ok' | 'flat' | 'collect_data' | 'no_budget'
export type SeasonalConfidence = 'high' | 'medium' | 'low'

export interface RevenuePlanMonth {
  year_month: string
  /** 季節指数（平均=1.0）。按分できない状態では null */
  index: number | null
  sales_budget: number | null
  /** index=自動按分（季節/均等） / manual=手動補正 */
  sales_budget_source: 'index' | 'manual' | null
  actual_sales: number | null
  achievement_rate: number | null
  /* ── 12ヶ月フル逆算（追加指示書3章）。算出できない月は null＋basis_detail ── */
  required_access: number | null
  target_cvr: number | null
  target_cvr_basis: 'manual' | 'rule' | null
  target_av: number | null
  target_av_basis: 'manual' | 'rule' | null
  basis_detail: string | null
  actual_access: number | null
  /** actual_access の出どころ月。当月以外なら直近実績月を見込みとして使用 */
  actual_access_month: string | null
  shortfall_access: number | null
  cpc: number | null
  cpc_source_month: string | null
  cpc_is_fallback: boolean | null
  est_ad_cost: number | null
}

export interface RevenuePlanResponse {
  status: RevenuePlanStatus
  annual_sales_budget: number | null
  budget_year_start_month: number
  budget_year: { from: string; to: string }
  base_month: string
  seasonal_index: {
    source: 'item_sales' | 'rpp'
    access_axis: 'site_uu' | 'rpp_click'
    confidence: SeasonalConfidence | null
    valid_months: number
    covered_calendar_months: number
    period_from: string | null
    period_to: string | null
    min_access_per_month: number
  }
  months: RevenuePlanMonth[]
  /** 基準月の一気通貫: 予算→必要アクセス→想定広告費（ok/flat時のみ） */
  current: RevenuePlanCurrent | null
  /** ギャップ逆算（allowable_ad_cost 指定時のみ） */
  gap: RevenuePlanGap | null
  /** アイテム別目標との整合性（警告のみ・強制同期なし） */
  item_target_check: { count: number; sum: number; coverage_rate: number | null; over_budget: boolean }
  guide: { title: string; message: string }
}

export interface RevenuePlanGapOption {
  type: 'cvr' | 'cvr_plus_av'
  label: string
  detail: string
  feasible: boolean | null
  improvement_pct: number | null
  /* 案A（cvr） */
  required_cvr?: number
  current_target_cvr?: number
  ceiling?: number
  ceiling_source?: string
  /* 案B（cvr_plus_av） */
  cvr_at_ceiling?: number
  required_av?: number
  current_target_av?: number
}

export interface RevenuePlanGap {
  allowable_ad_cost: number
  within_budget: boolean | null
  affordable_extra_ct: number | null
  affordable_access: number | null
  remaining_shortfall_access: number | null
  options: RevenuePlanGapOption[]
  note: string | null
}

export interface RevenuePlanCurrent {
  year_month: string
  sales_budget: number
  target_cvr: number
  target_av: number
  /** manual=手入力目標 / rule=MIN(現状,前年) / mixed=指標で出どころが異なる */
  target_basis: 'manual' | 'rule' | 'mixed'
  target_basis_detail: string
  required_access: number
  access_axis: 'site_uu'
  actual_access: number | null
  actual_access_month: string | null
  shortfall_access: number
  cpc: number | null
  cpc_source_month: string | null
  cpc_is_fallback: boolean | null
  est_ad_cost: number | null
  note: string
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
  /** 発売月 YYYY-MM。null は実績データの初出月から自動推定 */
  launch_month: string | null
  /** 商品フェーズの上書き。null=自動判定（発売から3ヶ月は新商品） */
  phase_override: 'new' | 'established' | null
  /** ページ品質ゲート。null=未回答 / false=未完成（広告提案を保留） / true=完成 */
  page_ready: boolean | null
  /** 意図確認ゲートの回答。true=新商品への意図的出稿として許容中 */
  investment_intent: boolean | null
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

/* ─── 請求（Stripe） ─────────────────── */
export interface BillingStatus {
  enabled: boolean
  plan: string | null
  plan_label?: string | null
  status: string | null
  trial_end: string | null
  current_period_end: string | null
  is_active: boolean
}

export interface BillingPlan {
  plan: string
  label: string
  /** カード表示用の金額文字列（例: "¥20,000（税抜） / ¥22,000（税込）"）。請求額は Stripe の price が正 */
  price_label?: string
}

/** 課金設定の診断結果（GET /api/billing/diagnose）。切り分け用 */
export interface BillingDiagnosis {
  ok: boolean
  checks: { level: 'ok' | 'warn' | 'error'; message: string }[]
  config: {
    billing_enabled: boolean
    trial_days: number
    price_id: string | null
    /** 手動の税率ID（請求書に消費税の内訳を出すため。Stripe Taxは使わない） */
    tax_rate_id?: string | null
    webhook_secret_set: boolean
    app_base_url: string
    key_livemode?: boolean | null
  }
  /** 手動の税率の設定内容 */
  tax_rate?: {
    id: string | null
    display_name: string | null
    percentage: number | null
    inclusive: boolean | null
    active: boolean | null
    country: string | null
    livemode: boolean | null
  } | null
  price: {
    id: string
    type: string | null
    recurring: { interval: string | null; interval_count: number | null } | null
    unit_amount: number | null
    currency: string | null
    active: boolean | null
    livemode: boolean | null
    product_id: string | null
    product_name: string | null
    /** exclusive=外税（unit_amountは税抜）/ inclusive=内税（税込）/ unspecified=未設定 */
    tax_behavior?: string | null
  } | null
  subscription: {
    id: string
    status: string | null
    trial_start: string | null
    trial_end: string | null
    cancel_at_period_end: boolean | null
    price_id: string | null
    interval: string | null
    interval_count: number | null
    current_period_end: string | null
    /** 自動税計算(Stripe Tax)。この設計では無効が正しい */
    automatic_tax_enabled?: boolean | null
    /** 契約に付いている手動税率のID。空だとその契約の請求書に内訳が出ない */
    default_tax_rate_ids?: string[]
  } | null
  db: Record<string, unknown> | null
  db_vs_stripe: { field: string; db: string | null; stripe: string | null }[]
  livemode_mismatch?: boolean
}

/** フィードバック（不具合報告・要望・解約について）の送信内容 */
export interface FeedbackPayload {
  category: 'bug' | 'request' | 'other' | 'cancel'
  message: string
  /** 送信時に開いていた画面のパス（自動添付） */
  page?: string | null
}

/** コンサル問い合わせフォームの送信内容 */
export interface ConsultingInquiryPayload {
  name: string
  company_name: string
  scale_hint?: string | null
  contact_email: string
  contact_phone?: string | null
  message?: string | null
}

export interface BillingPlansResponse {
  enabled: boolean
  trial_days: number
  /** Stripe鍵のモード（true=本番 / false=テスト / null=未設定）。テスト時だけ4242案内を出す */
  livemode?: boolean | null
  plans: BillingPlan[]
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
  /** 17パターンの改善アクション（未達KPIの組み合わせから動的生成） */
  actions?: {
    headline: string
    shop: string[]
    product: string[]
    note: string | null
  }
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
/** gated = ゲート判定（在庫・ページ品質）に該当し、診断分類の対象外 */
export type RppDiagnosisStatus = 'insufficient_data' | 'issues' | 'good' | 'gated'

/* ─── ゲート判定（設計ドキュメント2026-08-01 2-A / gates.py） ────── */

export type GateKind = 'stock' | 'page_quality' | 'sample_size'

export interface GateResult {
  gate: GateKind
  label: string
  proposal: {
    title: string
    reason: string
    effort: string
  }
  context: Record<string, unknown>
}

/** 商品フェーズ（3-A）。新商品はデフォルト発売3ヶ月、担当者が上書き可能 */
export interface PhaseInfo {
  phase: 'new' | 'established'
  basis: 'override' | 'launch_month' | 'unknown'
  launch_month: string | null
  label: string
}

/** 意図確認（ゲート4・フラグ型）。ask=true は確認の問いかけ、false は許容済みの注記 */
export interface IntentCheck {
  ask: boolean
  question?: string
  note?: string
}

/** ベンチマーク解決の結果（benchmarks.py の3段フォールバック） */
export interface BenchmarkResolution {
  metric: 'page_cvr' | 'ad_cvr' | 'ctr'
  metric_label: string
  value: number
  source: 'manual_genre' | 'shop_genre' | 'shop_avg' | 'default'
  source_label: string
  detail: string
}

/* ─── 診断分類（設計ドキュメント2026-08-01 2-B / diagnosis.py） ───── */

export type DiagnosisType =
  | 'nurture'       // 育成型
  | 'bleeding'      // 出血型（停止候補）
  | 'page_improve'  // 要ページ改善型
  | 'watch'         // 要観察型
  | 'high_cpc'      // 高CPC型
  | 'low_exposure'  // 低露出型
  | 'almost'        // 惜しい群
  | 'good'          // 良好型

/** 提案1件。kind: primary=第一候補 / second_best=代替案 / note=補足 */
export interface ClassificationProposal {
  title: string
  detail: string
  kind: 'primary' | 'second_best' | 'note'
  estimate: string | null
}

export interface Classification {
  type: DiagnosisType
  label: string
  /** バッジ色のトーン（danger/warning/info/success） */
  tone: 'danger' | 'warning' | 'info' | 'success'
  summary: string
  proposals: ClassificationProposal[]
  /** Limit CPO（複合条件）が判定できたか（原価率設定済み商品のみ true） */
  limit_cpo_evaluable: boolean
}

/* ─── アイテム別目標（設計3-B'' / /api/item-targets。第3段階） ───── */

export interface ItemTarget {
  management_no: string
  year_month: string
  /** 利用者が唯一手入力する値 */
  target_sales: number
  /** 自動算出 = MIN(現状CVR, 前年CVR)。site_uu軸(%) */
  target_cvr: number | null
  /** 自動算出 = MIN(現状客単価, 前年客単価) */
  target_av: number | null
  /** 自動算出 = (目標売上÷目標客単価)÷目標CVR */
  required_access: number | null
  /** rule=確定公式 / estimated=推定(参考値・要承認) / insufficient=算出不能 */
  calc_basis: 'rule' | 'estimated' | 'insufficient'
  basis_detail: string | null
  estimated_approved: boolean
  /** 診断・逆算で使ってよい状態か（rule、または承認済みestimated） */
  usable: boolean
}

export interface ItemTargetListEntry {
  management_no: string
  product_name: string | null
  target: ItemTarget | null
  /** 直近実績（site_uu軸・参考表示用）。実績が無い商品は null */
  latest_actual: {
    year_month: string
    access_uu: number
    cvr: number
    av: number
  } | null
}

export interface ItemTargetListResponse {
  year_month: string
  count: number
  items: ItemTargetListEntry[]
}

/** ジャンル別ベンチマーク手入力値（/api/master/benchmarks） */
export interface GenreBenchmarkItem {
  id: number
  genre_u1: string
  genre_u2: string | null
  genre_u3: string | null
  metric: 'page_cvr' | 'ad_cvr' | 'ctr'
  metric_label: string
  value: number
  memo: string | null
  updated_at: string | null
}

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
  /** 限界CPO（粗利÷CV）。原価率設定済み商品のみ。gated時は未設定 */
  limit_cpo?: number | null
}

export interface RppDiagnosisItem {
  management_no: string
  product_name: string | null
  item_url: string | null
  status: RppDiagnosisStatus
  /** ゲート判定に該当した場合のみ（status='gated'） */
  gate?: GateResult | null
  /** 商品フェーズ（新商品/稼働済み）。母数基準の切替根拠 */
  phase?: PhaseInfo
  /** 意図確認（新商品の損益分岐点割れ時のみ） */
  intent_check?: IntentCheck | null
  /** 診断分類（8分類）。gated / insufficient_data 時は null */
  classification?: Classification | null
  /** この商品のベンチマーク解決結果（どの段の基準を使ったか） */
  benchmark_sources?: { ad_cvr: BenchmarkResolution; ctr: BenchmarkResolution }
  /** この商品に適用された最低クリック母数（新商品=50 / 稼働済み=10） */
  min_ct?: number
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
  /** ベースラインの解決結果（どの段のベンチマークを使ったかの根拠表示用） */
  baseline_ad_cvr?: BenchmarkResolution
  baseline_ctr?: BenchmarkResolution
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
  /** 新商品フェーズの最低クリック母数（パターン1'の商品粒度読み替え） */
  min_ct_new?: number
  /** ROAS合格ライン（300%）。roas_line（100%=損益分岐点）とは別の基準 */
  roas_pass_line?: number
  /** 診断分類キー→表示ラベル */
  type_labels?: Record<string, string>
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
