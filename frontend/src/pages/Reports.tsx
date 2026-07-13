import { useEffect, useState } from 'react'
import { FileSpreadsheet, Download, BarChart3, Package, Info } from 'lucide-react'
import Header from '../components/layout/Header'
import PeriodSelector from '../components/PeriodSelector'
import ErrorBanner from '../components/ErrorBanner'
import { api } from '../lib/api'
import { usePeriodState } from '../lib/usePeriodState'

/**
 * レポート出力ページ（要件No.9）
 * 経営者・マネージャー共有用に、集計済みKPIをCSVでダウンロードする。
 * 集計は各画面と同じバックエンドロジック（/api/export）を使うため数値が一致する。
 */
export default function Reports() {
  const { period, dateValue, setPeriod, setDateValue } = usePeriodState()
  const [genres, setGenres] = useState<string[]>([])
  const [genre, setGenre] = useState<string>('')
  const [downloading, setDownloading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 商品別CSVのジャンル絞り込み用にジャンル一覧を取得
  useEffect(() => {
    api.products
      .genres()
      .then((d) => setGenres((d as { genres?: string[] } | null)?.genres ?? []))
      .catch(() => setGenres([]))
  }, [])

  const dateParam = period === 'monthly' ? dateValue.slice(0, 7) : dateValue

  const run = async (key: string, fn: () => Promise<void>) => {
    setError(null)
    setDownloading(key)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ダウンロードに失敗しました')
    } finally {
      setDownloading(null)
    }
  }

  const periodLabel = period === 'weekly' ? '週次' : '月次'

  return (
    <div className="flex flex-col h-full">
      <Header
        title="レポート出力"
        subtitle="経営者・マネージャー共有用に、KPIをCSVでダウンロードします"
        actions={
          <PeriodSelector
            period={period}
            onPeriodChange={setPeriod}
            dateValue={dateValue}
            onDateChange={setDateValue}
          />
        }
      />

      <div className="p-6 max-w-4xl space-y-4">
        {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

        <div className="flex items-start gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
          <Info size={14} className="mt-0.5 shrink-0 text-gray-400" />
          <p className="leading-relaxed">
            出力対象は現在選択中の期間（{periodLabel}・{dateParam}）です。CSVは
            Excel（日本語環境）でそのまま開けるUTF-8形式で保存されます。
          </p>
        </div>

        {/* KPIサマリCSV */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
            <BarChart3 size={20} className="text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-gray-900">KPIサマリ</h3>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              主要KPI（売上・利益・ROI・ROAS・CVR・CTR・CPC等）の実績値・前期比・前年比YoY、
              および売上目標と達成率を1枚にまとめて出力します。
            </p>
          </div>
          <button
            onClick={() => run('summary', () => api.export.summary(period, dateParam))}
            disabled={downloading !== null}
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            <Download size={15} />
            {downloading === 'summary' ? '出力中...' : 'CSV出力'}
          </button>
        </div>

        {/* 商品別KPI CSV */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center shrink-0">
            <Package size={20} className="text-green-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-bold text-gray-900">商品別KPI一覧</h3>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              商品ごとのRPP売上・利益・ROI・ROAS・CVR・CPO・Limit CPO超過などを売上降順で出力します。
            </p>
            {genres.length > 0 && (
              <div className="mt-2.5 flex items-center gap-2">
                <label className="text-xs text-gray-500">ジャンル絞り込み:</label>
                <select
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  className="border border-gray-200 rounded px-2 py-1 text-xs text-gray-700 max-w-[220px]"
                >
                  <option value="">すべて</option>
                  {genres.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <button
            onClick={() =>
              run('products', () => api.export.products(period, dateParam, genre || undefined))
            }
            disabled={downloading !== null}
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            <FileSpreadsheet size={15} />
            {downloading === 'products' ? '出力中...' : 'CSV出力'}
          </button>
        </div>
      </div>
    </div>
  )
}
