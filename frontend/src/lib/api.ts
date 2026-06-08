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

export const api = {
  dashboard: {
    get: (period: string, date?: string) =>
      request(`/dashboard?period=${period}${date ? `&date=${date}` : ''}`),
    alerts: (period: string, date?: string) =>
      request(`/dashboard/alerts?period=${period}${date ? `&date=${date}` : ''}`),
    trend: (weeks = 8) =>
      request(`/dashboard/trend?weeks=${weeks}`),
  },
  gap: {
    shop: (period: string, date?: string) =>
      request(`/gap/shop?period=${period}${date ? `&date=${date}` : ''}`),
    genre: (period: string, date?: string) =>
      request(`/gap/genre?period=${period}${date ? `&date=${date}` : ''}`),
    product: (period: string, date?: string, genre?: string) =>
      request(`/gap/product?period=${period}${date ? `&date=${date}` : ''}${genre ? `&genre=${encodeURIComponent(genre)}` : ''}`),
    kpiTree: (period: string, date?: string) =>
      request(`/gap/kpi-tree?period=${period}${date ? `&date=${date}` : ''}`),
  },
  products: {
    list: (period: string, date?: string, genre?: string) =>
      request(`/products?period=${period}${date ? `&date=${date}` : ''}${genre ? `&genre=${encodeURIComponent(genre)}` : ''}`),
    trend: (managementNo: string, weeks = 8) =>
      request(`/products/trend/${encodeURIComponent(managementNo)}?weeks=${weeks}`),
    genres: () => request('/products/genres'),
  },
  targets: {
    list: () => request('/targets'),
    upsert: (data: object) =>
      request('/targets', { method: 'POST', body: JSON.stringify(data) }),
  },
  import: {
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
    getInventory: (productUrl: string) =>
      request(`/actions/inventory?product_url=${encodeURIComponent(productUrl)}`),
    toggleInventory: (productUrl: string) =>
      request('/actions/inventory/toggle', {
        method: 'POST',
        body: JSON.stringify({ product_url: productUrl }),
      }),
  },
}
