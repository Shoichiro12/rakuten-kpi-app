import { getAccessToken } from './supabase'

const BASE = '/api'

/** ログイン中なら Authorization ヘッダを返す（未ログイン/認証無効なら空）。 */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/* ─── RPP API パラメータ型 ────────────────────────────────── */
export interface RppSalesParams {
  period_type?: 'weekly' | 'monthly'
  year_month?: string
  date_from?: string
  date_to?: string
  item_code?: string
  limit?: number
  offset?: number
}

export interface RppSummaryParams {
  period_type?: 'weekly' | 'monthly'
  year_month?: string
  date_from?: string
  date_to?: string
}

/**
 * レスポンスボディを安全にJSONパースする。
 * - res.text() でテキストを受け取り、空文字なら fallback を返す
 * - JSON.parse 失敗時はコンソールにエラーログを出力し fallback を返す
 * - res.ok でない場合はステータスとボディをログに残した上でエラーをthrowする
 */
async function parseJson(
  res: Response,
  fallback: unknown = undefined,
): Promise<unknown> {
  let text = ''
  try {
    text = await res.text()
  } catch (e) {
    console.error('[API] レスポンス読み取りエラー:', e)
    if (!res.ok) {
      throw new Error(`HTTPエラー ${res.status}: レスポンスを読み取れませんでした`)
    }
    return fallback
  }

  if (!text.trim()) {
    if (!res.ok) {
      console.error(`[API] HTTPエラー ${res.status} ${res.url}: (空レスポンス)`)
      throw new Error(`HTTPエラー ${res.status}: ${res.statusText || 'APIエラーが発生しました'}`)
    }
    return fallback
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    console.error('[API] JSONパースエラー:', e, '本文:', text.slice(0, 300))
    if (!res.ok) {
      throw new Error(`HTTPエラー ${res.status}: ${text.slice(0, 200)}`)
    }
    return fallback
  }

  if (!res.ok) {
    const d = parsed as Record<string, string> | null
    const msg = d?.detail || d?.message || res.statusText || 'APIエラーが発生しました'
    console.error(`[API] HTTPエラー ${res.status} ${res.url}:`, msg)
    throw new Error(msg)
  }

  return parsed
}

/**
 * fetch の共通ラッパー。
 * - ネットワーク例外（Failed to fetch 等）をキャッチしてログを残した上で再throwする
 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const auth = await authHeaders()
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...auth,
        ...(options?.headers as Record<string, string> | undefined),
      },
    })
  } catch (e) {
    console.error(`[API] ネットワークエラー (${path}):`, e)
    throw new Error('サーバーに接続できませんでした。バックエンドが起動しているか確認してください。')
  }
  const data = await parseJson(res)
  return data as T
}

/**
 * CSV等のファイルをダウンロードする。
 * - JSONではなくblobで受け取り、Content-Disposition のファイル名でダウンロードを発火する。
 * - サーバーが filename*（RFC5987, UTF-8）を返す場合は日本語ファイル名を優先採用する。
 */
async function downloadCsv(path: string, fallbackName = 'export.csv'): Promise<void> {
  const auth = await authHeaders()
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { headers: auth })
  } catch (e) {
    console.error(`[API] ネットワークエラー (${path}):`, e)
    throw new Error('サーバーに接続できませんでした。バックエンドが起動しているか確認してください。')
  }
  if (!res.ok) {
    // エラー時はJSONボディの detail を拾って日本語メッセージ化する
    let msg = `HTTPエラー ${res.status}`
    try {
      const d = JSON.parse(await res.text()) as { detail?: string }
      if (d?.detail) msg = d.detail
    } catch {
      /* ボディがJSONでない場合はステータスのみ */
    }
    console.error(`[API] ダウンロード失敗 ${res.status} ${path}:`, msg)
    throw new Error(msg)
  }

  // ファイル名を Content-Disposition から取得（filename* を優先）
  const disp = res.headers.get('content-disposition') || ''
  let filename = fallbackName
  const star = disp.match(/filename\*=UTF-8''([^;]+)/i)
  const plain = disp.match(/filename="?([^";]+)"?/i)
  if (star) filename = decodeURIComponent(star[1])
  else if (plain) filename = plain[1]

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export const api = {
  dashboard: {
    get: (period: string, date?: string) =>
      request(`/dashboard?period=${period}${date ? `&date=${date}` : ''}`),
    alerts: (period: string, date?: string) =>
      request(`/dashboard/alerts?period=${period}${date ? `&date=${date}` : ''}`),
    trend: (weeks = 8) =>
      request(`/dashboard/trend?weeks=${weeks}`),
  },
  evaluation: {
    /** 17パターン評価マトリクス（目標×YoY統一判定）。includeInactive=false で廃盤除外 */
    matrix: (period: string, date?: string, includeInactive?: boolean) =>
      request<import('../types').EvaluationMatrixResponse>(
        `/evaluation/matrix?period=${period}${date ? `&date=${date}` : ''}${includeInactive === undefined ? '' : `&include_inactive=${includeInactive}`}`,
      ),
    /** アクセス逆算プラン（目標売上→必要アクセス→不足分→想定追加広告費） */
    accessPlan: (period: string, date?: string) =>
      request<import('../types').AccessPlanResponse>(
        `/evaluation/access-plan?period=${period}${date ? `&date=${date}` : ''}`,
      ),
  },
  gap: {
    shop: (period: string, date?: string, includeInactive?: boolean) =>
      request(`/gap/shop?period=${period}${date ? `&date=${date}` : ''}${includeInactive === undefined ? '' : `&include_inactive=${includeInactive}`}`),
    genre: (period: string, date?: string, includeInactive?: boolean) =>
      request(`/gap/genre?period=${period}${date ? `&date=${date}` : ''}${includeInactive === undefined ? '' : `&include_inactive=${includeInactive}`}`),
    product: (period: string, date?: string, genre?: string, includeInactive?: boolean) =>
      request(`/gap/product?period=${period}${date ? `&date=${date}` : ''}${genre ? `&genre=${encodeURIComponent(genre)}` : ''}${includeInactive === undefined ? '' : `&include_inactive=${includeInactive}`}`),
    kpiTree: (period: string, date?: string) =>
      request(`/gap/kpi-tree?period=${period}${date ? `&date=${date}` : ''}`),
  },
  products: {
    list: (period: string, date?: string, genre?: string, includeInactive = false) =>
      request(`/products?period=${period}${date ? `&date=${date}` : ''}${genre ? `&genre=${encodeURIComponent(genre)}` : ''}${includeInactive ? '&include_inactive=true' : ''}`),
    trend: (managementNo: string, weeks = 8) =>
      request(`/products/trend/${encodeURIComponent(managementNo)}?weeks=${weeks}`),
    genres: () => request('/products/genres'),
  },
  targets: {
    list: () => request('/targets'),
    upsert: (data: object) =>
      request('/targets', { method: 'POST', body: JSON.stringify(data) }),
  },
  /* ─── 店舗マスタ（単一店舗前提） ─────────────────── */
  shops: {
    /** 現ユーザーのデフォルト店舗（原価率・経費率のデフォルト等） */
    me: () => request<import('../types').Shop>('/shops/me'),
    /** 店舗名・デフォルト原価率・デフォルト経費率・発注アラート閾値の更新 */
    update: (data: Partial<Pick<import('../types').Shop, 'name' | 'default_cost_rate' | 'default_expense_rate' | 'restock_lead_days'>>) =>
      request<import('../types').Shop>('/shops/me', { method: 'PUT', body: JSON.stringify(data) }),
  },
  /* ─── 商品マスタ・カテゴリ ─────────────────── */
  master: {
    /** 商品マスタ一覧。opts未指定=全件（稼働中＋廃盤）。active/categoryId で絞り込み可 */
    products: (opts: { active?: boolean; categoryId?: number } = {}) => {
      const q = new URLSearchParams()
      if (opts.active !== undefined) q.set('is_active', String(opts.active))
      if (opts.categoryId != null) q.set('category_id', String(opts.categoryId))
      const qs = q.toString()
      return request<import('../types').MasterProductsResponse>(`/master/products${qs ? `?${qs}` : ''}`)
        .then((d) => d ?? { count: 0, items: [] })
    },
    /** product_name / category_id / is_active の編集 */
    updateProduct: (managementNo: string, data: Partial<Pick<import('../types').MasterProduct, 'product_name' | 'category_id' | 'is_active'>>) =>
      request(`/master/products/${encodeURIComponent(managementNo)}`, { method: 'PUT', body: JSON.stringify(data) }),
    /** カテゴリ・原価率が未確定の商品の提案キュー（廃盤は除外） */
    suggestions: () =>
      request<import('../types').SuggestionsResponse>('/master/suggestions').then((d) => d ?? { count: 0, items: [] }),
    /** 提案を個別承認（approve_category / approve_cost_rate を個別指定） */
    approveSuggestion: (managementNo: string, data: { approve_category: boolean; approve_cost_rate: boolean }) =>
      request<{ management_no: string; applied: { category: boolean; cost_rate: boolean }; recalculated_rows: number }>(
        `/master/suggestions/${encodeURIComponent(managementNo)}/approve`,
        { method: 'POST', body: JSON.stringify(data) },
      ),
    /** 高信頼提案のみ一括承認（低信頼は対象外） */
    approveAllSuggestions: (managementNos: string[]) =>
      request<{ approved_count: number; approved: unknown[]; recalculated_rows: number }>(
        '/master/suggestions/approve-all',
        { method: 'POST', body: JSON.stringify({ management_nos: managementNos }) },
      ),
    /** 楽天ジャンルマスタの3階層ツリー（カテゴリ選択ピッカー用の参照データ） */
    genreTree: () =>
      request<{ tree: import('../types').GenreTree }>('/master/genre-tree').then((d) => d?.tree ?? {}),
    /** カテゴリ一覧 */
    categories: () =>
      request<import('../types').CategoriesResponse>('/master/categories').then((d) => d ?? { count: 0, items: [] }),
    /** カテゴリ作成（同一階層があれば既存を返す） */
    createCategory: (data: { genre_u1?: string | null; genre_u2?: string | null; genre_u3?: string | null }) =>
      request<import('../types').Category>('/master/categories', { method: 'POST', body: JSON.stringify(data) }),
    /** カテゴリのリネーム */
    updateCategory: (id: number, data: { genre_u1?: string | null; genre_u2?: string | null; genre_u3?: string | null }) =>
      request<import('../types').Category>(`/master/categories/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    /** カテゴリ削除（参照商品は未分類化） */
    deleteCategory: (id: number) =>
      request<{ deleted_id: number; detached_products: number }>(`/master/categories/${id}`, { method: 'DELETE' }),
    /** 商品マスタをCSV（BOM付きUTF-8）でダウンロード */
    exportCsv: () => downloadCsv('/master/products/export', 'product_master.csv'),
    /** 商品マスタCSVを一括取込み（管理番号キーにupsert） */
    importCsv: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      let r: Response
      try {
        r = await fetch(`${BASE}/master/products/import`, { method: 'POST', body: form, headers: await authHeaders() })
      } catch (e) {
        console.error('[API] ネットワークエラー (master.importCsv):', e)
        throw new Error('サーバーに接続できませんでした。バックエンドが起動しているか確認してください。')
      }
      return await parseJson(r) as { updated: number; created: number; cost_set: number; recalculated_rows: number; processed: number } | undefined
    },
  },
  /* ─── 在庫アラート ─────────────────── */
  inventory: {
    /** 欠品・在庫僅少を機会損失順で（最新月 or 指定月、廃盤除外） */
    alerts: (yearMonth?: string) =>
      request<import('../types').InventoryAlertsResponse>(`/inventory/alerts${yearMonth ? `?year_month=${yearMonth}` : ''}`)
        .then((d) => d ?? { year_month: null, count: 0, out_count: 0, low_count: 0, threshold_days: 14, items: [] }),
  },
  /* ─── 請求（Stripe） ─────────────────── */
  billing: {
    /** 現在の契約状態（未契約でも200） */
    status: () =>
      request<import('../types').BillingStatus>('/billing/status')
        .then((d) => d ?? { enabled: false, plan: null, status: null, trial_end: null, current_period_end: null, is_active: false }),
    /** 設定済みプラン一覧＋トライアル日数 */
    plans: () =>
      request<import('../types').BillingPlansResponse>('/billing/plans')
        .then((d) => d ?? { enabled: false, trial_days: 14, plans: [] }),
    /** Checkout Session を作成しURLを返す（フロントはそこへ遷移） */
    checkout: (plan: 'standard' | 'consult') =>
      request<{ url: string }>('/billing/checkout', { method: 'POST', body: JSON.stringify({ plan }) }),
    /** Checkout完了で戻った直後に呼び、契約状態を確定する（session_id 由来） */
    confirm: (session_id: string) =>
      request<import('../types').BillingStatus>('/billing/confirm', { method: 'POST', body: JSON.stringify({ session_id }) }),
    /** カスタマーポータルのURLを発行 */
    portal: () =>
      request<{ url: string }>('/billing/portal', { method: 'POST', body: JSON.stringify({}) }),
  },
  /* ─── 原価マスタ ─────────────────── */
  costs: {
    /** 商品一覧＋適用中の率＋「個別/デフォルト」区分 */
    list: () => request<import('../types').CostsResponse>('/costs').then((d) => d ?? { default_cost_rate: 0.6, count: 0, items: [] }),
    /** 店舗デフォルト原価率を更新（→ RppWeekly 再計算） */
    setDefault: (rate: number) =>
      request<{ default_cost_rate: number; recalculated_rows: number }>('/costs/default', { method: 'PUT', body: JSON.stringify({ default_cost_rate: rate }) }),
    /** 商品別原価率を設定/更新（→ 対象商品のみ再計算） */
    setProduct: (managementNo: string, rate: number, memo?: string) =>
      request<{ management_no: string; cost_rate: number; recalculated_rows: number }>(`/costs/${encodeURIComponent(managementNo)}`, { method: 'PUT', body: JSON.stringify({ cost_rate: rate, memo }) }),
    /** 現在の率を RppWeekly に掛け直す */
    recalc: () => request<{ recalculated_rows: number }>('/costs/recalc', { method: 'POST', body: JSON.stringify({}) }),
  },
  import: {
    /** まとめて取込み: CSV/zip 複数ファイルを種別自動判別で一括インポート */
    auto: async (files: File[]) => {
      const form = new FormData()
      files.forEach((f) => form.append('files', f))
      let r: Response
      try {
        r = await fetch(`${BASE}/import/auto`, { method: 'POST', body: form, headers: await authHeaders() })
      } catch (e) {
        console.error('[API] ネットワークエラー (importAuto):', e)
        throw new Error('サーバーに接続できませんでした。バックエンドが起動しているか確認してください。')
      }
      return await parseJson(r) as import('../types').AutoImportResponse | undefined
    },
    /** ダウンロードフォルダ内のRMSレポート候補一覧 */
    inboxList: () =>
      request<import('../types').InboxListResponse>('/import/inbox').then(
        (d) => d ?? { dir: '', files: [] },
      ),
    /** ダウンロードフォルダ内の指定ファイルを取込み */
    inboxImport: (names: string[]) =>
      request<import('../types').AutoImportResponse>('/import/inbox', {
        method: 'POST',
        body: JSON.stringify({ files: names }),
      }),
    rpp: (csvText: string, overwrite = false) =>
      request('/import/rpp', {
        method: 'POST',
        body: JSON.stringify({ csv_text: csvText, overwrite }),
      }),
    monthly: (csvText: string) =>
      request('/import/monthly', {
        method: 'POST',
        body: JSON.stringify({ csv_text: csvText, overwrite: false }),
      }),
    rppFile: async (file: File, overwrite = false) => {
      const form = new FormData()
      form.append('file', file)
      form.append('overwrite', String(overwrite))
      let r: Response
      try {
        r = await fetch(`${BASE}/import/rpp/file`, { method: 'POST', body: form, headers: await authHeaders() })
      } catch (e) {
        console.error('[API] ネットワークエラー (rppFile):', e)
        throw new Error('サーバーに接続できませんでした。バックエンドが起動しているか確認してください。')
      }
      // parseJson内でres.ok チェックとエラーthrowを行う
      return await parseJson(r) as Record<string, unknown> | undefined
    },
    template: async () => fetch(`${BASE}/import/rpp/template`, { headers: await authHeaders() }),
    monthlyItemsPreview: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      let r: Response
      try {
        r = await fetch(`${BASE}/import/monthly-items/preview`, { method: 'POST', body: form, headers: await authHeaders() })
      } catch (e) {
        console.error('[API] ネットワークエラー (monthlyItemsPreview):', e)
        throw new Error('サーバーに接続できませんでした。バックエンドが起動しているか確認してください。')
      }
      return await parseJson(r) as Record<string, unknown> | undefined
    },
    /** データ整合性チェック（二重計上等の検出） */
    integrity: () =>
      request<import('../types').IntegrityResponse>('/import/integrity').then(
        (d) => d ?? { ok: true, issues: [] },
      ),
    /** 自動修復可能な整合性問題を修復 */
    integrityFix: () =>
      request<import('../types').IntegrityFixResult>('/import/integrity/fix', { method: 'POST' }),
    /** インポート済み月次商品分析データの年月一覧 */
    monthlyItemsPeriods: () =>
      request<import('../types').MonthlyItemsPeriodsResponse>('/import/monthly-items/periods').then(
        (d) => d ?? { months: [] },
      ),
    /** 指定年月の月次商品分析データを削除 */
    monthlyItemsDelete: (yearMonth: string) =>
      request<import('../types').DeleteResult>(`/import/monthly-items/${encodeURIComponent(yearMonth)}`, {
        method: 'DELETE',
      }),
    monthlyItemsUpload: async (file: File, overwrite = false) => {
      const form = new FormData()
      form.append('file', file)
      let r: Response
      try {
        r = await fetch(`${BASE}/import/monthly-items?overwrite=${overwrite}`, { method: 'POST', body: form, headers: await authHeaders() })
      } catch (e) {
        console.error('[API] ネットワークエラー (monthlyItemsUpload):', e)
        throw new Error('サーバーに接続できませんでした。バックエンドが起動しているか確認してください。')
      }
      return await parseJson(r) as Record<string, unknown> | undefined
    },
  },
  rpp: {
    /** インポート済み期間一覧（週次・月次） */
    periods: () =>
      request<import('../types').RppPeriods>('/import/rpp/periods').then(
        (d) => d ?? { weekly: [], monthly: [] },
      ),
    /** 商品別RPP実績一覧 */
    sales: (params: RppSalesParams = {}) => {
      const q = new URLSearchParams()
      if (params.period_type) q.set('period_type', params.period_type)
      if (params.year_month) q.set('year_month', params.year_month)
      if (params.date_from) q.set('date_from', params.date_from)
      if (params.date_to) q.set('date_to', params.date_to)
      if (params.item_code) q.set('item_code', params.item_code)
      if (params.limit != null) q.set('limit', String(params.limit))
      if (params.offset != null) q.set('offset', String(params.offset))
      const qs = q.toString()
      return request<import('../types').RppSalesResponse>(
        `/import/rpp/sales${qs ? `?${qs}` : ''}`,
      ).then((d) => d ?? { total: 0, count: 0, offset: 0, limit: 50, items: [] })
    },
    /** 期間指定でRPPデータを個別削除（weekly: date_from/date_to, monthly: year_month） */
    deletePeriod: (params: { period_type: 'weekly' | 'monthly'; date_from?: string; date_to?: string; year_month?: string }) => {
      const q = new URLSearchParams({ period_type: params.period_type })
      if (params.date_from) q.set('date_from', params.date_from)
      if (params.date_to) q.set('date_to', params.date_to)
      if (params.year_month) q.set('year_month', params.year_month)
      return request<import('../types').DeleteResult>(`/import/rpp/period?${q.toString()}`, {
        method: 'DELETE',
      })
    },
    /** 期間サマリー */
    summary: (params: RppSummaryParams = {}) => {
      const q = new URLSearchParams()
      if (params.period_type) q.set('period_type', params.period_type)
      if (params.year_month) q.set('year_month', params.year_month)
      if (params.date_from) q.set('date_from', params.date_from)
      if (params.date_to) q.set('date_to', params.date_to)
      const qs = q.toString()
      return request<import('../types').RppSummaryResponse>(
        `/import/rpp/summary${qs ? `?${qs}` : ''}`,
      ).then((d) => d ?? null)
    },
    /** 商品単位のRPP診断（management_no 省略で期間内の全商品を一括診断） */
    diagnosis: (params: RppSummaryParams & { management_no?: string } = {}) => {
      const q = new URLSearchParams()
      if (params.period_type) q.set('period_type', params.period_type)
      if (params.management_no) q.set('management_no', params.management_no)
      if (params.year_month) q.set('year_month', params.year_month)
      if (params.date_from) q.set('date_from', params.date_from)
      if (params.date_to) q.set('date_to', params.date_to)
      const qs = q.toString()
      return request<import('../types').RppDiagnosisResponse>(
        `/rpp/diagnosis${qs ? `?${qs}` : ''}`,
      ).then((d) => d ?? null)
    },
    /** 診断アクションのチェック状態（既存 actions.get と同パターン） */
    diagnosisChecks: (managementNo: string, periodKey: string) =>
      request<Record<string, boolean>>(
        `/rpp/diagnosis/checks?management_no=${encodeURIComponent(managementNo)}&period_key=${encodeURIComponent(periodKey)}`,
      ).then((d) => d ?? {}),
    /** 診断アクションのチェックをトグル（既存 actions.toggle と同パターン） */
    diagnosisToggle: (managementNo: string, periodKey: string, actionKey: string) =>
      request<{ action_key: string; checked: boolean }>('/rpp/diagnosis/toggle', {
        method: 'POST',
        body: JSON.stringify({ management_no: managementNo, period_key: periodKey, action_key: actionKey }),
      }),
  },
  /* ─── レポート・CSVエクスポート（要件No.9） ───────────────────
   * CSVはJSONではなくblobで受け取り、ブラウザのダウンロードを発火する。 */
  export: {
    /** KPIサマリCSVをダウンロード */
    summary: (period: string, date?: string) =>
      downloadCsv(`/export/summary?period=${period}${date ? `&date=${date}` : ''}`, 'kpi_summary.csv'),
    /** 商品別KPI CSVをダウンロード */
    products: (period: string, date?: string, genre?: string) =>
      downloadCsv(
        `/export/products?period=${period}${date ? `&date=${date}` : ''}${genre ? `&genre=${encodeURIComponent(genre)}` : ''}`,
        'products_kpi.csv',
      ),
  },
  /* ─── アカウント管理 ─────────────────────────────── */
  account: {
    /** アカウント情報（メール・登録データ件数・退会APIの利用可否） */
    get: () => request('/account'),
    /** 退会: 本人の全データと Supabase ユーザーを削除 */
    delete: () => request('/account', { method: 'DELETE' }),
  },
  /* ─── 今日やるべきこと（Phase 1） ─────────────────── */
  recommendations: {
    /** 優先度順の推奨アクション（既定3件） */
    get: (period: string, date?: string) =>
      request(`/recommendations?period=${period}${date ? `&date=${date}` : ''}`),
    /** 実施 / 後で（スヌーズ）を記録。実施時点のKPIも保存される */
    complete: (
      actionKey: string,
      periodKey: string,
      periodType: string,
      status: 'done' | 'snoozed',
      title?: string,
    ) =>
      request('/recommendations/complete', {
        method: 'POST',
        body: JSON.stringify({
          action_key: actionKey,
          period_key: periodKey,
          period_type: periodType,
          status,
          title,
        }),
      }),
    /** 実施した施策のその後（Phase 2 の効果測定） */
    outcomes: () => request('/recommendations/outcomes'),
    /** 実施記録を取り消して再表示する */
    undo: (actionKey: string, periodKey: string) =>
      request(
        `/recommendations/complete?action_key=${encodeURIComponent(actionKey)}&period_key=${encodeURIComponent(periodKey)}`,
        { method: 'DELETE' },
      ),
  },
  sampleData: () =>
    request('/sample-data', { method: 'POST' }),
  dataStatus: () => request('/data-status'),
  resetData: () => request('/reset-data', { method: 'POST' }),
  actions: {
    get: (productUrl: string, weekKey: string) =>
      request(`/actions?product_url=${encodeURIComponent(productUrl)}&week_key=${weekKey}`),
    toggle: (productUrl: string, weekKey: string, actionKey: string) =>
      request('/actions/toggle', {
        method: 'POST',
        body: JSON.stringify({ product_url: productUrl, week_key: weekKey, action_key: actionKey }),
      }),
    getInventory: (productUrl: string, managementNo?: string) =>
      request(`/actions/inventory?product_url=${encodeURIComponent(productUrl)}${managementNo ? `&management_no=${encodeURIComponent(managementNo)}` : ''}`),
    toggleInventory: (productUrl: string) =>
      request('/actions/inventory/toggle', {
        method: 'POST',
        body: JSON.stringify({ product_url: productUrl }),
      }),
    /** 店舗全体 or 特定ジャンル内の課題を種別別に集計（GAP分析 step1/2 用・要件No.3） */
    summary: (scope: 'shop' | 'genre', opts: { genre?: string; period?: string; date?: string } = {}) => {
      const q = new URLSearchParams()
      q.set('scope', scope)
      if (opts.genre) q.set('genre', opts.genre)
      if (opts.period) q.set('period', opts.period)
      if (opts.date) q.set('date', opts.date)
      return request<import('../types').ActionSummaryResponse>(`/actions/summary?${q.toString()}`)
        .then((d) => d ?? { scope, genre: null, year_month: null, count: 0, items: [] })
    },
  },
}
