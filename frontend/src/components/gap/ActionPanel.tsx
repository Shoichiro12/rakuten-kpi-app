import { useEffect, useState } from 'react'
import { X, Package, AlertTriangle, CheckSquare, Square, ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '../../lib/api'
import { formatCurrency, formatPercent } from '../../lib/utils'
import type { KPIs } from '../../types'

type IssueType = 'access' | 'cvr' | 'av' | 'inventory'

interface ActionDef {
  key: string
  category: 'Promotion' | 'Price' | 'Product' | 'Place' | '仕入れ'
  issue: IssueType[]
  text: string
}

const ACTIONS: ActionDef[] = [
  // アクセス（Promotion）
  { key: 'rpp_bid', category: 'Promotion', issue: ['access'], text: 'RPP広告のCPC・入札単価を見直す' },
  { key: 'seo_keyword', category: 'Promotion', issue: ['access'], text: '商品名にキーワードを追加（SEO対策）' },
  { key: 'thumbnail', category: 'Promotion', issue: ['access'], text: 'CTRが低い場合：サムネイル・バナーを改善' },
  { key: 'coupon', category: 'Promotion', issue: ['access'], text: 'キャンペーン・クーポンでアクセス増加' },
  { key: 'rmp', category: 'Promotion', issue: ['access'], text: '楽天市場内の広告枠（RMP）を活用' },
  // CVR（Price）
  { key: 'price_review', category: 'Price', issue: ['cvr'], text: '販売価格・クーポンを見直す' },
  { key: 'point_rate', category: 'Price', issue: ['cvr'], text: 'ポイント還元率を上げる' },
  // CVR（Product）
  { key: 'lp_review', category: 'Product', issue: ['cvr'], text: '商品ページLP・レビューを改善する' },
  { key: 'image_improve', category: 'Product', issue: ['cvr'], text: '商品説明・画像を充実させる' },
  // CVR（Place）
  { key: 'shipping', category: 'Place', issue: ['cvr'], text: '出荷リードタイム・送料を確認' },
  { key: 'delivery_info', category: 'Place', issue: ['cvr'], text: '在庫表示・配送日時を見直す' },
  // 客単価（Product）
  { key: 'bundle', category: 'Product', issue: ['av'], text: 'セット販売・まとめ買いプランを作成' },
  { key: 'cross_sell', category: 'Product', issue: ['av'], text: '関連商品のクロスセルを設定' },
  // 客単価（Price）
  { key: 'bundle_price', category: 'Price', issue: ['av'], text: 'バンドル価格を見直す' },
  { key: 'free_shipping', category: 'Price', issue: ['av'], text: '送料無料ラインを調整' },
  // 在庫
  { key: 'restock', category: '仕入れ', issue: ['inventory'], text: '入荷スケジュールを見直す' },
  { key: 'qty_adjust', category: '仕入れ', issue: ['inventory'], text: '仕入れ数量を調整する' },
  { key: 'alt_product', category: '仕入れ', issue: ['inventory'], text: '代替商品への切り替えを検討' },
  { key: 'pause_ads', category: '仕入れ', issue: ['inventory'], text: '在庫切れ商品の広告を一時停止' },
]

const CATEGORY_COLOR: Record<string, string> = {
  Promotion: 'bg-blue-100 text-blue-700',
  Price: 'bg-green-100 text-green-700',
  Product: 'bg-purple-100 text-purple-700',
  Place: 'bg-orange-100 text-orange-700',
  '仕入れ': 'bg-red-100 text-red-700',
}

const ISSUE_LABEL: Record<IssueType, string> = {
  access: 'アクセス不足',
  cvr: '転換率低下',
  av: '客単価低下',
  inventory: '在庫なし',
}

interface ProductInfo {
  product_url: string
  product_name: string
  management_no: string
  current: KPIs
}

interface ActionPanelProps {
  product: ProductInfo
  shopKpis: KPIs
  weekKey: string
  onClose: () => void
}

function detectIssues(product: ProductInfo, shopKpis: KPIs, hasInventory: boolean): IssueType[] {
  if (!hasInventory) return ['inventory']
  const issues: IssueType[] = []
  if (product.current.cvr < shopKpis.cvr * 0.85) issues.push('cvr')
  if (product.current.av < shopKpis.av * 0.85) issues.push('av')
  if (issues.length === 0 || (shopKpis.ctr > 0 && product.current.ctr < shopKpis.ctr * 0.75)) {
    issues.push('access')
  }
  return issues
}

export default function ActionPanel({ product, shopKpis, weekKey, onClose }: ActionPanelProps) {
  const [hasInventory, setHasInventory] = useState(true)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [expandedIssues, setExpandedIssues] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.actions.get(product.product_url, weekKey) as Promise<Record<string, boolean> | null>,
      api.actions.getInventory(product.product_url) as Promise<{ has_inventory?: boolean } | null>,
    ]).then(([actions, inv]) => {
      setChecked(actions ?? {})
      setHasInventory(inv?.has_inventory ?? true)
    }).catch((e: unknown) => {
      console.error('[ActionPanel] アクションデータ取得エラー:', e)
      setChecked({})
      setHasInventory(true)
    }).finally(() => setLoading(false))
  }, [product.product_url, weekKey])

  const issues = detectIssues(product, shopKpis, hasInventory)

  // 初期展開: 全issue
  useEffect(() => {
    const init: Record<string, boolean> = {}
    issues.forEach(i => { init[i] = true })
    setExpandedIssues(init)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.product_url, hasInventory])

  const toggleAction = async (actionKey: string) => {
    const next = !checked[actionKey]
    setChecked(prev => ({ ...prev, [actionKey]: next }))
    try {
      await api.actions.toggle(product.product_url, weekKey, actionKey)
    } catch (e) {
      console.error('[ActionPanel] アクション更新エラー:', e)
      // 楽観的更新を元に戻す
      setChecked(prev => ({ ...prev, [actionKey]: !next }))
    }
  }

  const toggleInventory = async () => {
    try {
      const inv = await api.actions.toggleInventory(product.product_url) as { has_inventory?: boolean } | null
      setHasInventory(inv?.has_inventory ?? hasInventory)
    } catch (e) {
      console.error('[ActionPanel] 在庫ステータス更新エラー:', e)
    }
  }

  const toggleIssue = (issue: string) => {
    setExpandedIssues(prev => ({ ...prev, [issue]: !prev[issue] }))
  }

  const actionsForIssue = (issue: IssueType) =>
    ACTIONS.filter(a => a.issue.includes(issue))

  return (
    <div className="w-80 shrink-0 bg-white border-l border-gray-200 flex flex-col h-full overflow-hidden">
      {/* ヘッダー */}
      <div className="px-4 py-3 border-b flex items-start justify-between gap-2 bg-gray-50">
        <div className="min-w-0">
          <p className="text-xs text-gray-500">改善アクション</p>
          <p className="text-sm font-semibold text-gray-900 leading-tight">{product.product_name}</p>
          <p className="text-xs text-gray-400">{product.management_no}</p>
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-gray-200 rounded-lg shrink-0">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* KPIサマリ */}
        <div className="px-4 py-3 border-b">
          <div className="grid grid-cols-3 gap-2 text-xs">
            {[
              { label: 'CVR', val: formatPercent(product.current.cvr, 2), warn: product.current.cvr < shopKpis.cvr * 0.85 },
              { label: '客単価', val: formatCurrency(product.current.av), warn: product.current.av < shopKpis.av * 0.85 },
              { label: 'ROAS', val: formatPercent(product.current.roas), warn: product.current.roas < 200 },
            ].map(({ label, val, warn }) => (
              <div key={label} className={`rounded-lg p-2 text-center ${warn ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}>
                <p className="text-gray-500">{label}</p>
                <p className={`font-bold ${warn ? 'text-red-600' : 'text-gray-900'}`}>{val}</p>
                {warn && <p className="text-red-400" style={{ fontSize: 9 }}>⚠️ 要改善</p>}
              </div>
            ))}
          </div>
        </div>

        {/* 大前提：在庫確認 */}
        <div className="px-4 py-3 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package size={14} className={hasInventory ? 'text-green-600' : 'text-red-500'} />
              <p className="text-xs font-semibold text-gray-700">大前提：在庫ステータス</p>
            </div>
            <button
              onClick={toggleInventory}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                hasInventory
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-red-100 text-red-700 hover:bg-red-200'
              }`}
            >
              {hasInventory ? '✅ 在庫あり' : '⚠️ 在庫なし'}
            </button>
          </div>
          {!hasInventory && (
            <p className="mt-1.5 text-xs text-red-600 bg-red-50 rounded p-2">
              在庫なしの場合は仕入れ調整を最優先で対応してください
            </p>
          )}
        </div>

        {/* 検出課題 */}
        {loading ? (
          <div className="px-4 py-6 text-center text-sm text-gray-400">読み込み中...</div>
        ) : (
          <div className="px-4 py-3 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              検出された課題と改善アクション
            </p>

            {issues.map((issue) => {
              const issueActions = actionsForIssue(issue)
              const doneCount = issueActions.filter(a => checked[a.key]).length
              const expanded = expandedIssues[issue] ?? true

              return (
                <div key={issue} className="rounded-xl border overflow-hidden">
                  {/* 課題ヘッダー */}
                  <button
                    onClick={() => toggleIssue(issue)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-left ${
                      issue === 'inventory' ? 'bg-red-50' : 'bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {issue !== 'inventory'
                        ? <AlertTriangle size={13} className="text-amber-500" />
                        : <Package size={13} className="text-red-500" />
                      }
                      <p className="text-xs font-bold text-gray-800">{ISSUE_LABEL[issue]}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400">{doneCount}/{issueActions.length} 完了</span>
                      {expanded ? <ChevronUp size={12} className="text-gray-400" /> : <ChevronDown size={12} className="text-gray-400" />}
                    </div>
                  </button>

                  {/* アクション一覧 */}
                  {expanded && (
                    <ul className="divide-y divide-gray-50">
                      {issueActions.map((action) => {
                        const isChecked = !!checked[action.key]
                        return (
                          <li key={action.key}>
                            <button
                              onClick={() => toggleAction(action.key)}
                              className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors ${
                                isChecked ? 'opacity-60' : ''
                              }`}
                            >
                              {isChecked
                                ? <CheckSquare size={14} className="text-blue-500 mt-0.5 shrink-0" />
                                : <Square size={14} className="text-gray-300 mt-0.5 shrink-0" />
                              }
                              <div className="flex-1 min-w-0">
                                <p className={`text-xs leading-snug ${isChecked ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                                  {action.text}
                                </p>
                                <span className={`inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded font-medium ${CATEGORY_COLOR[action.category]}`}>
                                  {action.category}
                                </span>
                              </div>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
