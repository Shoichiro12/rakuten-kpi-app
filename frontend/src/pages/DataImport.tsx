import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Upload, ClipboardPaste, CheckCircle, XCircle, Sparkles, Eye,
  Package, ChevronDown, ChevronRight, HelpCircle, Megaphone, BarChart3,
  Trash2, ArrowRight, ExternalLink,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Header from '../components/layout/Header'
import { api } from '../lib/api'
import { formatCurrency, formatPercent } from '../lib/utils'
import type { DataStatus, RppPeriods, RppImportResult } from '../types'

const RPP_TEMPLATE = `計測期間,商品URL,管理番号,商品名,ジャンル,RPP売上,売上原価,広告費,注文件数,クリック数,CTR(%),CPC(円)
2024-01-07,https://item.rakuten.co.jp/shop/item001/,ITEM-001,サンプル商品A,スポーツ/シューズ,150000,90000,18000,30,1200,1.5,150
2024-01-07,https://item.rakuten.co.jp/shop/item002/,ITEM-002,サンプル商品B,スポーツ/ウェア,80000,48000,10000,20,800,1.2,125`

type StatusType = { type: 'success' | 'error'; message: string; detail?: RppImportResult } | null

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

  useEffect(() => {
    loadStatus()
    loadRppPeriods()
  }, [loadStatus, loadRppPeriods])

  const flash = (s: StatusType) => {
    setStatus(s)
    if (s?.type === 'success') {
      loadStatus()
      loadRppPeriods()
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

  const hasData = dataStatus?.has_data ?? false

  return (
    <div className="flex flex-col h-full">
      <Header title="データ取込み" subtitle="楽天RMSのCSVをアップロードするだけで分析が始まります" />

      <div className="flex-1 overflow-auto p-6 bg-gray-50 space-y-5 max-w-5xl">
        {/* ステータスメッセージ */}
        {status && (
          <div className={`rounded-lg border px-4 py-3 text-sm ${
            status.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}>
            <div className="flex items-center gap-2.5">
              {status.type === 'success'
                ? <CheckCircle size={16} className="text-green-500 shrink-0" />
                : <XCircle size={16} className="text-red-500 shrink-0" />}
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
              { n: '2', t: '下の枠にドラッグ&ドロップ', d: 'ファイルを置くだけ。文字コードは自動判別' },
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

        {/* メイン：2種類のレポートアップロード */}
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
            <div className="grid sm:grid-cols-2 gap-3">
              {rppPeriods.weekly.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">週次</p>
                  <div className="flex flex-wrap gap-1.5">
                    {rppPeriods.weekly.slice(0, 8).map((p) => (
                      <span key={`${p.year_month}-${p.date_from}`} className="text-xs bg-blue-50 text-blue-700 border border-blue-100 rounded px-2 py-0.5">
                        {p.date_from} 〜 {p.date_to}
                      </span>
                    ))}
                    {rppPeriods.weekly.length > 8 && (
                      <span className="text-xs text-gray-400">他 {rppPeriods.weekly.length - 8}件</span>
                    )}
                  </div>
                </div>
              )}
              {rppPeriods.monthly.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">月次</p>
                  <div className="flex flex-wrap gap-1.5">
                    {rppPeriods.monthly.map((p) => (
                      <span key={p.year_month} className="text-xs bg-violet-50 text-violet-700 border border-violet-100 rounded px-2 py-0.5">
                        {p.year_month}
                      </span>
                    ))}
                  </div>
                </div>
              )}
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
