import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Upload, ClipboardPaste, CheckCircle, Sparkles, Eye,
  Package, ChevronDown, ChevronRight, HelpCircle, Megaphone, BarChart3,
  Trash2, ArrowRight, ExternalLink, XCircle, FolderDown,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import ErrorBanner from '../components/ErrorBanner'
import { supabase, authEnabled } from '../lib/supabase'
import { api } from '../lib/api'
import { formatCurrency, formatPercent } from '../lib/utils'
import type { DataStatus, RppPeriods, RppImportResult, AutoImportResponse, InboxListResponse, MonthlyItemsPeriod, IntegrityResponse } from '../types'

const RPP_TEMPLATE = `計測期間,商品URL,管理番号,商品名,ジャンル,RPP売上,売上原価,広告費,注文件数,クリック数,CTR(%),CPC(円)
2024-01-07,https://item.rakuten.co.jp/shop/item001/,ITEM-001,サンプル商品A,スポーツ/シューズ,150000,90000,18000,30,1200,1.5,150
2024-01-07,https://item.rakuten.co.jp/shop/item002/,ITEM-002,サンプル商品B,スポーツ/ウェア,80000,48000,10000,20,800,1.2,125`

type StatusType = { type: 'success' | 'error'; message: string; detail?: RppImportResult } | null

/** バックエンドの認証系エラーメッセージかどうか（再ログインCTAの出し分けに使う）。 */
function isAuthError(msg: string): boolean {
  return /認証|再ログイン|トークン|ログインしてください/.test(msg)
}

interface MonthlyItemsPreview {
  year_month: string
  count: number
  total_sales: number
  total_access_uu: number
  avg_cvr: number
  no_stock_count: number
  top_products: Array<{ management_no: string; product_name: string | null; sales: number }>
}

/* ─── ドラッグ&ドロップ対応のアップロード枠 ─────────────────────── */
function DropZone({
  onFile,
  loading,
  hint,
  accent = 'blue',
}: {
  onFile: (file: File) => void
  loading: boolean
  hint?: string
  accent?: 'blue' | 'violet'
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const pick = (files: FileList | null) => {
    const f = files?.[0]
    if (f) onFile(f)
  }

  const accentRing = accent === 'violet'
    ? 'hover:border-violet-400 hover:bg-violet-50'
    : 'hover:border-blue-400 hover:bg-blue-50'
  const dragRing = accent === 'violet'
    ? 'border-violet-500 bg-violet-50'
    : 'border-blue-500 bg-blue-50'

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        pick(e.dataTransfer.files)
      }}
      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
        loading ? 'opacity-50 pointer-events-none' : dragging ? dragRing : `border-gray-200 ${accentRing}`
      }`}
    >
      <Upload size={30} className={`mx-auto mb-3 ${dragging ? 'text-blue-500' : 'text-gray-300'}`} />
      <p className="text-sm font-medium text-gray-700">
        CSVファイルをドラッグ&ドロップ
      </p>
      <p className="text-xs text-gray-400 mt-1">またはクリックして選択</p>
      {hint && <p className="text-xs text-gray-400 mt-2">{hint}</p>}
      {loading && <p className="text-xs text-blue-500 mt-2">解析中...</p>}
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        onChange={(e) => { pick(e.target.files); e.target.value = '' }}
        className="hidden"
      />
    </div>
  )
}

/* ─── まとめて取込みドロップゾーン（複数ファイル・zip対応） ──────── */
function MultiDropZone({ onFiles, loading }: { onFiles: (files: File[]) => void; loading: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const pick = (files: FileList | null) => {
    if (!files || files.length === 0) return
    onFiles(Array.from(files))
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files) }}
      className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
        loading
          ? 'opacity-50 pointer-events-none'
          : dragging
            ? 'border-emerald-500 bg-emerald-50'
            : 'border-emerald-300 bg-emerald-50/40 hover:border-emerald-400 hover:bg-emerald-50'
      }`}
    >
      <Upload size={34} className={`mx-auto mb-3 ${dragging ? 'text-emerald-500' : 'text-emerald-400'}`} />
      <p className="text-sm font-bold text-gray-800">RMSからダウンロードしたファイルをここに放り込むだけ</p>
      <p className="text-xs text-gray-500 mt-1.5">
        zipのままでOK・複数ファイル同時OK・種別は自動判別（RPP広告 / 商品分析）
      </p>
      {loading && <p className="text-xs text-emerald-600 mt-2">取込み中...</p>}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.zip"
        multiple
        onChange={(e) => { pick(e.target.files); e.target.value = '' }}
        className="hidden"
      />
    </div>
  )
}

/* ─── 折りたたみセクション ─────────────────────────────────────── */
function Collapsible({
  title,
  icon: Icon,
  defaultOpen = false,
  children,
}: {
  title: string
  icon?: LucideIcon
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {Icon && <Icon size={13} />}
        {title}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

/* ─── 月次プレビューカード ─────────────────────────────────────── */
function PreviewCard({
  preview,
  onConfirm,
  onCancel,
  loading,
}: {
  preview: MonthlyItemsPreview
  onConfirm: (overwrite: boolean) => void
  onCancel: () => void
  loading: boolean
}) {
  const [overwrite, setOverwrite] = useState(false)

  return (
    <div className="bg-violet-50 border border-violet-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye size={16} className="text-violet-600" />
          <p className="text-sm font-semibold text-violet-900">取込み内容の確認 — {preview.year_month}</p>
        </div>
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600">キャンセル</button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: '商品数', value: `${preview.count.toLocaleString()}件` },
          { label: '売上合計', value: formatCurrency(preview.total_sales) },
          { label: 'アクセス(UU)', value: preview.total_access_uu.toLocaleString() },
          { label: '平均CVR', value: formatPercent(preview.avg_cvr, 2) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-lg border border-violet-100 p-3 text-center">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="text-sm font-bold text-gray-900 mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {preview.no_stock_count > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
          <Package size={13} className="text-amber-600 shrink-0" />
          <span>{preview.no_stock_count}件の在庫なし商品を検出 — 在庫ステータスが自動更新されます</span>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">売上上位5商品</p>
        <div className="bg-white rounded-lg border border-violet-100 divide-y divide-gray-50">
          {preview.top_products.map((p, i) => (
            <div key={p.management_no} className="flex items-center justify-between px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-gray-400 shrink-0">{i + 1}</span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">{p.product_name || p.management_no}</p>
                  <p className="text-xs text-gray-400">{p.management_no}</p>
                </div>
              </div>
              <span className="text-xs font-bold text-gray-900 shrink-0 ml-2">{formatCurrency(p.sales)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between pt-1">
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
            className="rounded"
          />
          同月のデータを上書きする
        </label>
        <button
          onClick={() => onConfirm(overwrite)}
          disabled={loading}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {loading ? 'インポート中...' : 'この内容でインポート'}
        </button>
      </div>
    </div>
  )
}

/* ─── セットアップ進捗ストリップ ───────────────────────────────── */
function SetupProgress({ status }: { status: DataStatus | null }) {
  const doneOf = (key: 'rpp' | 'monthly' | 'targets') =>
    status?.steps.find((s) => s.key === key)?.done ?? false

  const items = [
    {
      key: 'rpp',
      label: 'RPP広告レポート',
      done: doneOf('rpp'),
      detail: status && status.rpp.weeks > 0 ? `${status.rpp.weeks}週分` : '未登録',
    },
    {
      key: 'monthly',
      label: '商品分析レポート',
      done: doneOf('monthly'),
      detail: status && status.monthly.months > 0 ? `${status.monthly.months}ヶ月分` : '未登録',
    },
    {
      key: 'targets',
      label: 'KGI/KPI目標',
      done: doneOf('targets'),
      detail: status && status.targets > 0 ? '設定済み' : '未設定',
    },
  ]
  const doneCount = items.filter((i) => i.done).length

  return (
    <div className="bg-white rounded-xl border shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-gray-700">セットアップ進捗</p>
        <span className="text-xs text-gray-500">{doneCount} / {items.length} 完了</span>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        {items.map((item) => (
          <div
            key={item.key}
            className={`rounded-lg border p-3 flex items-center gap-2.5 ${
              item.done ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'
            }`}
          >
            {item.done
              ? <CheckCircle size={18} className="text-green-500 shrink-0" />
              : <div className="w-[18px] h-[18px] rounded-full border-2 border-gray-300 shrink-0" />}
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-800 truncate">{item.label}</p>
              <p className={`text-xs ${item.done ? 'text-green-600' : 'text-gray-400'}`}>{item.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DataImport() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<StatusType>(null)
  const [loading, setLoading] = useState(false)
  const [dataStatus, setDataStatus] = useState<DataStatus | null>(null)
  const [rppPeriods, setRppPeriods] = useState<RppPeriods | null>(null)
  const [monthlyPeriods, setMonthlyPeriods] = useState<MonthlyItemsPeriod[]>([])
  const [integrity, setIntegrity] = useState<IntegrityResponse | null>(null)

  // まとめて取込みの結果・ダウンロードフォルダ候補
  const [autoResults, setAutoResults] = useState<AutoImportResponse | null>(null)
  const [inbox, setInbox] = useState<InboxListResponse | null>(null)
  const [inboxSel, setInboxSel] = useState<Set<string>>(new Set())

  // 月次プレビュー state
  const [monthlyPreview, setMonthlyPreview] = useState<MonthlyItemsPreview | null>(null)
  const [monthlyFile, setMonthlyFile] = useState<File | null>(null)

  // テキスト貼り付け（上級者向け）
  const [rppText, setRppText] = useState('')
  const [monthlyText, setMonthlyText] = useState('')
  const [overwrite, setOverwrite] = useState(false)

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.dataStatus() as DataStatus
      setDataStatus(s)
    } catch { /* 取得失敗は無視（ガイドは出さない） */ }
  }, [])

  const loadRppPeriods = useCallback(async () => {
    try {
      const p = await api.rpp.periods()
      setRppPeriods(p)
    } catch { /* 取得失敗は無視 */ }
  }, [])

  const loadInbox = useCallback(async () => {
    try {
      const r = await api.import.inboxList()
      setInbox(r)
      setInboxSel(new Set(r.files.map((f) => f.name)))
    } catch { /* 取得失敗は無視（候補カードを出さないだけ） */ }
  }, [])

  const loadMonthlyPeriods = useCallback(async () => {
    try {
      const r = await api.import.monthlyItemsPeriods()
      setMonthlyPeriods(r.months)
    } catch { /* 取得失敗は無視 */ }
  }, [])

  const loadIntegrity = useCallback(async () => {
    try {
      const r = await api.import.integrity()
      setIntegrity(r)
    } catch { /* 取得失敗は無視 */ }
  }, [])

  useEffect(() => {
    loadStatus()
    loadRppPeriods()
    loadInbox()
    loadMonthlyPeriods()
    loadIntegrity()
  }, [loadStatus, loadRppPeriods, loadInbox, loadMonthlyPeriods, loadIntegrity])

  const flash = (s: StatusType) => {
    setStatus(s)
    if (s?.type === 'success') {
      loadStatus()
      loadRppPeriods()
      loadMonthlyPeriods()
      loadIntegrity()
    }
  }

  const handleIntegrityFix = async () => {
    if (!window.confirm('重複データ（月次由来の集計行）を自動修復します。よろしいですか？\n※週次データとRPP生データはそのまま残ります')) return
    setLoading(true); setStatus(null)
    try {
      const r = await api.import.integrityFix()
      flash({ type: 'success', message: r.message })
    } catch (e: unknown) {
      flash({ type: 'error', message: e instanceof Error ? e.message : '修復に失敗しました' })
    } finally {
      setLoading(false)
    }
  }

  /* ─── インポート済みデータの個別削除 ───────────────────────── */

  const handleDeleteRppWeek = async (dateFrom: string, dateTo: string) => {
    if (!window.confirm(`${dateFrom} 〜 ${dateTo} のRPPデータを削除します。よろしいですか？`)) return
    setLoading(true); setStatus(null)
    try {
      const r = await api.rpp.deletePeriod({ period_type: 'weekly', date_from: dateFrom, date_to: dateTo })
      flash({ type: 'success', message: r.message })
    } catch (e: unknown) {
      flash({ type: 'error', message: e instanceof Error ? e.message : '削除に失敗しました' })
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteRppMonth = async (ym: string) => {
    if (!window.confirm(`${ym} の月次RPPデータを削除します。よろしいですか？`)) return
    setLoading(true); setStatus(null)
    try {
      const r = await api.rpp.deletePeriod({ period_type: 'monthly', year_month: ym })
      flash({ type: 'success', message: r.message })
    } catch (e: unknown) {
      flash({ type: 'error', message: e instanceof Error ? e.message : '削除に失敗しました' })
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteMonthlyItems = async (ym: string) => {
    if (!window.confirm(`${ym} の商品分析データを削除します。よろしいですか？`)) return
    setLoading(true); setStatus(null)
    try {
      const r = await api.import.monthlyItemsDelete(ym)
      flash({ type: 'success', message: r.message })
    } catch (e: unknown) {
      flash({ type: 'error', message: e instanceof Error ? e.message : '削除に失敗しました' })
    } finally {
      setLoading(false)
    }
  }

  /* まとめて取込み（複数ファイル・zip・種別自動判別） */
  const applyAutoResult = (r: AutoImportResponse | undefined) => {
    if (!r) return
    setAutoResults(r)
    if (r.ok_count > 0) {
      flash({
        type: 'success',
        message: `${r.ok_count}件のファイルを取り込みました${r.ng_count > 0 ? `（${r.ng_count}件は取り込めませんでした。下の結果をご確認ください）` : ''}`,
      })
    } else {
      flash({ type: 'error', message: '取り込めるファイルがありませんでした。下の結果をご確認ください。' })
    }
  }

  const handleAutoFiles = async (files: File[]) => {
    setLoading(true); setStatus(null); setAutoResults(null)
    try {
      applyAutoResult(await api.import.auto(files))
    } catch (e: unknown) {
      flash({ type: 'error', message: e instanceof Error ? e.message : '取込みに失敗しました' })
    } finally {
      setLoading(false)
    }
  }

  const handleInboxImport = async () => {
    if (inboxSel.size === 0) return
    setLoading(true); setStatus(null); setAutoResults(null)
    try {
      applyAutoResult(await api.import.inboxImport(Array.from(inboxSel)))
    } catch (e: unknown) {
      flash({ type: 'error', message: e instanceof Error ? e.message : '取込みに失敗しました' })
    } finally {
      setLoading(false)
    }
  }

  /* RPPファイル（実RMS / 簡易 両対応・自動判別） */
  const handleRppFile = async (file: File) => {
    setLoading(true); setStatus(null)
    try {
      const result = await api.import.rppFile(file) as RppImportResult
      const msg = result?.message ?? 'インポートが完了しました'
      flash({ type: 'success', message: msg, detail: result })
    } catch (e: unknown) {
      flash({ type: 'error', message: e instanceof Error ? e.message : 'ファイルの読み込みに失敗しました' })
    } finally {
      setLoading(false)
    }
  }

  /* 月次ファイル → プレビュー */
  const handleMonthlyFile = async (file: File) => {
    setMonthlyFile(file)
    setMonthlyPreview(null)
    setStatus(null)
    setLoading(true)
    try {
      const preview = await api.import.monthlyItemsPreview(file) as unknown as MonthlyItemsPreview
      setMonthlyPreview(preview)
    } catch (e: unknown) {
      flash({ type: 'error', message: e instanceof Error ? e.message : 'ファイルの解析に失敗しました' })
      setMonthlyFile(null)
    } finally {
      setLoading(false)
    }
  }

  const handleMonthlyConfirm = async (ow: boolean) => {
    if (!monthlyFile) return
    setLoading(true); setStatus(null)
    try {
      const result = await api.import.monthlyItemsUpload(monthlyFile, ow) as { message: string }
      flash({ type: 'success', message: result.message })
      setMonthlyPreview(null)
      setMonthlyFile(null)
    } catch (e: unknown) {
      flash({ type: 'error', message: e instanceof Error ? e.message : 'インポートに失敗しました' })
    } finally {
      setLoading(false)
    }
  }

  const handleRppText = async () => {
    if (!rppText.trim()) return
    setLoading(true); setStatus(null)
    try {
      const result = await api.import.rpp(rppText, overwrite) as { message: string }
      flash({ type: 'success', message: result.message })
      setRppText('')
    } catch (e: unknown) {
      flash({ type: 'error', message: e instanceof Error ? e.message : 'インポートに失敗しました' })
    } finally {
      setLoading(false)
    }
  }

  const handleMonthlyText = async () => {
    if (!monthlyText.trim()) return
    setLoading(true); setStatus(null)
    try {
      const result = await api.import.monthly(monthlyText) as { message: string }
      flash({ type: 'success', message: result.message })
      setMonthlyText('')
    } catch (e: unknown) {
      flash({ type: 'error', message: e instanceof Error ? e.message : 'インポートに失敗しました' })
    } finally {
      setLoading(false)
    }
  }

  const handleSampleData = async () => {
    setLoading(true); setStatus(null)
    try {
      const result = await api.sampleData() as { message: string }
      flash({ type: 'success', message: result.message })
    } catch (e: unknown) {
      flash({ type: 'error', message: e instanceof Error ? e.message : 'サンプルデータの生成に失敗しました' })
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async () => {
    if (!window.confirm('登録済みのデータをすべて削除します。よろしいですか？')) return
    setLoading(true); setStatus(null)
    try {
      const result = await api.resetData() as { message: string }
      flash({ type: 'success', message: result.message })
    } catch (e: unknown) {
      flash({ type: 'error', message: e instanceof Error ? e.message : '削除に失敗しました' })
    } finally {
      setLoading(false)
    }
  }

  /** 再ログイン: サインアウトすると App 側が未ログインを検知してログイン画面に切り替わる。 */
  const handleRelogin = () => { supabase?.auth.signOut() }

  const hasData = dataStatus?.has_data ?? false

  return (
    <div className="flex flex-col h-full">
      <Header title="データ取込み" subtitle="楽天RMSのCSVをアップロードするだけで分析が始まります" />

      <div className="flex-1 overflow-auto p-6 bg-gray-50 space-y-5 max-w-5xl">
        {/* エラー: 認証エラーなら「再ログイン」CTA、常に「✕閉じる」を表示 */}
        {status && status.type === 'error' && (
          <ErrorBanner
            message={status.message}
            onClose={() => setStatus(null)}
            actionLabel={authEnabled && isAuthError(status.message) ? '再ログイン' : undefined}
            onAction={authEnabled && isAuthError(status.message) ? handleRelogin : undefined}
          />
        )}

        {/* 成功メッセージ */}
        {status && status.type === 'success' && (
          <div className="rounded-lg border px-4 py-3 text-sm border-green-200 bg-green-50 text-green-800">
            <div className="flex items-center gap-2.5">
              <CheckCircle size={16} className="text-green-500 shrink-0" />
              <span className="flex-1">{status.message}</span>
              {status.type === 'success' && hasData && (
                <button
                  onClick={() => navigate('/')}
                  className="flex items-center gap-1 text-xs font-medium text-green-700 hover:text-green-900 shrink-0"
                >
                  ダッシュボードで確認 <ArrowRight size={13} />
                </button>
              )}
            </div>
            {/* RPPインポート結果の詳細 */}
            {status.type === 'success' && status.detail && (
              <div className="mt-2 ml-6 flex flex-wrap gap-3 text-xs text-green-700">
                {status.detail.inserted != null && (
                  <span className="bg-green-100 rounded px-2 py-0.5">新規 {status.detail.inserted}件</span>
                )}
                {status.detail.updated != null && (
                  <span className="bg-green-100 rounded px-2 py-0.5">更新 {status.detail.updated}件</span>
                )}
                {status.detail.format && (
                  <span className="bg-green-100 rounded px-2 py-0.5">形式: {status.detail.format}</span>
                )}
                {status.detail.year_months && status.detail.year_months.length > 0 && (
                  <span className="bg-green-100 rounded px-2 py-0.5">
                    対象月: {status.detail.year_months.join(', ')}
                  </span>
                )}
                {status.type === 'success' && (
                  <button
                    onClick={() => navigate('/rpp')}
                    className="flex items-center gap-1 font-medium text-green-700 hover:text-green-900"
                  >
                    RPP実績を確認 <ExternalLink size={11} />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* データ整合性の警告（二重計上の常時チェック） */}
        {integrity && !integrity.ok && (
          <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 space-y-2.5">
            <div className="flex items-center gap-2">
              <XCircle size={17} className="text-red-500 shrink-0" />
              <p className="text-sm font-bold text-red-800">データの重複を検出しました — KPIが正しく集計されていない可能性があります</p>
            </div>
            <ul className="space-y-1 ml-6">
              {integrity.issues.map((issue, i) => (
                <li key={i} className="text-xs text-red-700 leading-relaxed">
                  ・{issue.detail}
                </li>
              ))}
            </ul>
            {integrity.issues.some((i) => i.fixable) && (
              <div className="flex justify-end">
                <button
                  onClick={handleIntegrityFix}
                  disabled={loading}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  {loading ? '修復中...' : '重複を自動修復する'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* セットアップ進捗 */}
        <SetupProgress status={dataStatus} />

        {/* はじめての方へ：3ステップ */}
        <div className="bg-blue-600 rounded-xl p-5 text-white">
          <div className="flex items-center gap-2 mb-3">
            <HelpCircle size={18} />
            <h3 className="text-sm font-bold">はじめての方へ — 3ステップで完了</h3>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            {[
              { n: '1', t: '楽天RMSでCSVを書き出す', d: '広告レポート（RPP）と商品分析の2種類' },
              { n: '2', t: '下の枠にドラッグ&ドロップ', d: 'zipのまま置くだけ。種別・文字コードは自動判別' },
              { n: '3', t: 'ダッシュボードで確認', d: 'KPIと改善アラートが自動表示されます' },
            ].map(({ n, t, d }) => (
              <div key={n} className="bg-white/10 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-5 h-5 rounded-full bg-white text-blue-700 text-xs font-bold flex items-center justify-center">{n}</span>
                  <p className="text-xs font-semibold">{t}</p>
                </div>
                <p className="text-xs text-blue-100 leading-relaxed">{d}</p>
              </div>
            ))}
          </div>
        </div>

        {/* まとめて取込み（おすすめ） */}
        <div className="bg-white rounded-xl border-2 border-emerald-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
              <Upload size={18} className="text-emerald-600" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900">まとめて取込み（おすすめ）</h3>
              <p className="text-xs text-gray-500 mt-0.5">種類を選ぶ必要はありません。全部まとめてどうぞ</p>
            </div>
          </div>

          <MultiDropZone onFiles={handleAutoFiles} loading={loading} />

          {/* ダウンロードフォルダの候補ファイル */}
          {inbox && inbox.files.length > 0 && (
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center gap-2 mb-2">
                <FolderDown size={15} className="text-emerald-600" />
                <p className="text-xs font-semibold text-gray-700">
                  ダウンロードフォルダに取込み候補が{inbox.files.length}件見つかりました（ドラッグ不要でそのまま取込めます）
                </p>
              </div>
              <div className="bg-gray-50 rounded-lg border border-gray-100 divide-y divide-gray-100 max-h-48 overflow-auto">
                {inbox.files.map((f) => (
                  <label key={f.name} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-100">
                    <input
                      type="checkbox"
                      checked={inboxSel.has(f.name)}
                      onChange={(e) => {
                        setInboxSel((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(f.name)
                          else next.delete(f.name)
                          return next
                        })
                      }}
                      className="rounded shrink-0"
                    />
                    <span className={`text-xs rounded px-1.5 py-0.5 shrink-0 ${
                      f.kind_guess === 'rpp' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
                    }`}>
                      {f.kind_guess === 'rpp' ? 'RPP広告' : '商品分析'}
                    </span>
                    <span className="text-xs text-gray-800 truncate flex-1">{f.name}</span>
                    <span className="text-xs text-gray-400 shrink-0">{f.modified}</span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end mt-2">
                <button
                  onClick={handleInboxImport}
                  disabled={loading || inboxSel.size === 0}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  {loading ? '取込み中...' : `選択した${inboxSel.size}件を取り込む`}
                </button>
              </div>
            </div>
          )}

          {/* 取込み結果（ファイルごと） */}
          {autoResults && (
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-700">
                  取込み結果: 成功 {autoResults.ok_count}件 / 失敗 {autoResults.ng_count}件
                </p>
                <button onClick={() => setAutoResults(null)} className="text-xs text-gray-400 hover:text-gray-600">
                  閉じる
                </button>
              </div>
              <div className="bg-gray-50 rounded-lg border border-gray-100 divide-y divide-gray-100">
                {autoResults.results.map((r, i) => (
                  <div key={`${r.source}-${i}`} className="flex items-start gap-2.5 px-3 py-2">
                    {r.ok
                      ? <CheckCircle size={14} className="text-green-500 shrink-0 mt-0.5" />
                      : <XCircle size={14} className="text-red-400 shrink-0 mt-0.5" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs rounded px-1.5 py-0.5 shrink-0 ${
                          r.kind === 'rpp'
                            ? 'bg-blue-100 text-blue-700'
                            : r.kind === 'monthly'
                              ? 'bg-violet-100 text-violet-700'
                              : 'bg-gray-200 text-gray-600'
                        }`}>
                          {r.kind === 'rpp' ? 'RPP広告' : r.kind === 'monthly' ? '商品分析' : '判別不可'}
                        </span>
                        <span className="text-xs font-medium text-gray-800 truncate">{r.source}</span>
                      </div>
                      <p className={`text-xs mt-0.5 ${r.ok ? 'text-gray-500' : 'text-red-500'}`}>{r.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 個別に取り込む（種類ごと） */}
        <div className="grid lg:grid-cols-2 gap-5">
          {/* RPP広告レポート */}
          <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
            <div className="flex items-start gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                <Megaphone size={18} className="text-blue-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">① RPP広告レポート（週次）</h3>
                <p className="text-xs text-gray-500 mt-0.5">広告費・ROAS・CPOなどの広告KPIを集計</p>
              </div>
            </div>

            <DropZone
              onFile={handleRppFile}
              loading={loading}
              accent="blue"
              hint="RMS実ファイル / 簡易テンプレート 両対応・自動判別"
            />

            <Collapsible title="楽天RMSでの入手方法" icon={HelpCircle}>
              <ol className="text-xs text-gray-600 space-y-1.5 pl-1">
                <li>① RMS →「広告・アフィリエイト」→ RPP を開く</li>
                <li>② レポートダウンロードを選択</li>
                <li>③ 対象期間（週／月）を指定してCSVを書き出す</li>
                <li>④ そのCSVを上の枠にドラッグ&ドロップ</li>
              </ol>
            </Collapsible>

            <Collapsible title="テキストで貼り付ける（上級者向け）" icon={ClipboardPaste}>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    {rppText.trim() ? `${rppText.trim().split('\n').length - 1}件` : '必須列: 商品URL / RPP売上 / 広告費 / 注文件数 / クリック数'}
                  </span>
                  <button onClick={() => setRppText(RPP_TEMPLATE)} className="text-xs text-blue-500 hover:text-blue-700">
                    テンプレートを挿入
                  </button>
                </div>
                <textarea
                  value={rppText}
                  onChange={(e) => setRppText(e.target.value)}
                  placeholder="CSVテキストをここに貼り付け"
                  className="w-full h-32 text-xs font-mono border border-gray-200 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} className="rounded" />
                  同じ週のデータを上書きする
                </label>
                <button
                  onClick={handleRppText}
                  disabled={loading || !rppText.trim()}
                  className="w-full py-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  {loading ? 'インポート中...' : 'インポート実行'}
                </button>
              </div>
            </Collapsible>
          </div>

          {/* 商品分析レポート */}
          <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
            <div className="flex items-start gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
                <BarChart3 size={18} className="text-violet-600" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900">② 商品分析レポート（月次）</h3>
                <p className="text-xs text-gray-500 mt-0.5">アクセス・CVR・在庫・レビューなど商品別の実績</p>
              </div>
            </div>

            {!monthlyPreview ? (
              <DropZone
                onFile={handleMonthlyFile}
                loading={loading}
                accent="violet"
                hint="アップロード後、内容をプレビューで確認できます"
              />
            ) : (
              <PreviewCard
                preview={monthlyPreview}
                onConfirm={handleMonthlyConfirm}
                onCancel={() => { setMonthlyPreview(null); setMonthlyFile(null) }}
                loading={loading}
              />
            )}

            <Collapsible title="楽天RMSでの入手方法" icon={HelpCircle}>
              <ol className="text-xs text-gray-600 space-y-1.5 pl-1">
                <li>① RMS →「データ分析」→ 商品分析 を開く</li>
                <li>② 対象月を指定してCSVダウンロード</li>
                <li>③ ファイルはそのままでOK（先頭のヘッダー行は自動スキップ）</li>
                <li>④ 上の枠にドラッグ&ドロップ</li>
              </ol>
            </Collapsible>

            <Collapsible title="テキストで貼り付ける（旧形式）" icon={ClipboardPaste}>
              <div className="space-y-2">
                <span className="text-xs text-gray-400">必須列: 商品URL / 年月（YYYY-MM）</span>
                <textarea
                  value={monthlyText}
                  onChange={(e) => setMonthlyText(e.target.value)}
                  placeholder="月次分析データを貼り付け"
                  className="w-full h-32 text-xs font-mono border border-gray-200 rounded-lg p-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <button
                  onClick={handleMonthlyText}
                  disabled={loading || !monthlyText.trim()}
                  className="w-full py-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  {loading ? 'インポート中...' : 'インポート実行'}
                </button>
              </div>
            </Collapsible>
          </div>
        </div>

        {/* インポート済みRPP期間一覧 */}
        {rppPeriods && (rppPeriods.weekly.length > 0 || rppPeriods.monthly.length > 0) && (
          <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Megaphone size={15} className="text-blue-600" />
                <h3 className="text-sm font-bold text-gray-900">インポート済みRPPデータ</h3>
              </div>
              <button
                onClick={() => navigate('/rpp')}
                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800"
              >
                実績を閲覧 <ExternalLink size={12} />
              </button>
            </div>
            <p className="text-xs text-gray-400">× を押すとその期間のデータだけを削除できます</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {rppPeriods.weekly.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">週次</p>
                  <div className="flex flex-wrap gap-1.5">
                    {rppPeriods.weekly.map((p) => (
                      <span key={`${p.year_month}-${p.date_from}`} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-100 rounded px-2 py-0.5">
                        {p.date_from} 〜 {p.date_to}
                        <button
                          onClick={() => handleDeleteRppWeek(p.date_from, p.date_to)}
                          disabled={loading}
                          title="この週のデータを削除"
                          className="text-blue-300 hover:text-red-500 font-bold leading-none disabled:opacity-40"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {rppPeriods.monthly.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">月次</p>
                  <div className="flex flex-wrap gap-1.5">
                    {rppPeriods.monthly.map((p) => (
                      <span key={p.year_month} className="inline-flex items-center gap-1 text-xs bg-violet-50 text-violet-700 border border-violet-100 rounded px-2 py-0.5">
                        {p.year_month}
                        <button
                          onClick={() => handleDeleteRppMonth(p.year_month)}
                          disabled={loading}
                          title="この月のデータを削除"
                          className="text-violet-300 hover:text-red-500 font-bold leading-none disabled:opacity-40"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* インポート済み商品分析データ一覧（個別削除対応） */}
        {monthlyPeriods.length > 0 && (
          <div className="bg-white rounded-xl border shadow-sm p-5 space-y-3">
            <div className="flex items-center gap-2">
              <BarChart3 size={15} className="text-violet-600" />
              <h3 className="text-sm font-bold text-gray-900">インポート済み商品分析データ（月次）</h3>
            </div>
            <p className="text-xs text-gray-400">× を押すとその月のデータだけを削除できます</p>
            <div className="flex flex-wrap gap-1.5">
              {monthlyPeriods.map((m) => (
                <span key={m.year_month} className="inline-flex items-center gap-1 text-xs bg-violet-50 text-violet-700 border border-violet-100 rounded px-2 py-0.5">
                  {m.year_month}（{m.rows.toLocaleString()}件）
                  <button
                    onClick={() => handleDeleteMonthlyItems(m.year_month)}
                    disabled={loading}
                    title="この月のデータを削除"
                    className="text-violet-300 hover:text-red-500 font-bold leading-none disabled:opacity-40"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* お試し / リセット */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <Sparkles size={18} className="text-amber-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">まずは試してみたい方へ</p>
            <p className="text-xs text-amber-700 mt-0.5">
              実データがなくても、サンプルデータ（10商品×8週間）で全機能を体験できます。あとから実データに差し替え可能です。
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleSampleData}
              disabled={loading}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-colors"
            >
              {loading ? '処理中...' : 'サンプルを生成'}
            </button>
            {hasData && (
              <button
                onClick={handleReset}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-gray-600 text-sm rounded-lg transition-colors"
              >
                <Trash2 size={14} /> 全削除
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
