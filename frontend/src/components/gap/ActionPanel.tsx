import { useEffect, useState } from 'react'
import { X, Package, AlertTriangle, CheckSquare, Square, ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '../../lib/api'
import { formatCurrency, formatPercent } from '../../lib/utils'
import type { KPIs, InventoryInfo } from '../../types'
// 打ち手の文言は actionLibrary.ts が単一の真実（KpiActionHint.tsx と共用）。ここに書き足さないこと。
import { CATEGORY_COLOR, ISSUE_LABEL, actionsForIssue, type IssueType } from './actionLibrary'


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

/** アクセス母数がこの値未満の場合、CVR・客単価は統計的に信用しない（EC実務基準） */
const MIN_ACCESS_FOR_CVR_EVAL = 100

/**
 * 課題検出。優先度は「在庫 > アクセス > 客単価 = CVR」（4P分析のステップ準拠）。
 *
 * - 在庫なし: 買える状態が大前提。他の課題は評価せず仕入れ対策のみ提示する
 * - アクセス(クリック数)が100未満: 母数不足でCVR・客単価は信用できないため、
 *   アクセス対策（Promotion）だけを提示する
 * - アクセスが弱い(CTRがショップ平均の75%未満): CVR・客単価に課題があっても
 *   アクセス対策を先頭で必ず提示する（以前は CVR/客単価の課題があると
 *   アクセス対策が表示されない仕様だったのを修正）
 * - 配列の順序がそのまま表示順（＝優先度順）になる
 */
function detectIssues(product: ProductInfo, shopKpis: KPIs, hasInventory: boolean): IssueType[] {
  // 優先度1: 在庫（買える状態でなければ他の対策は無意味）
  if (!hasInventory) return ['inventory']

  // 優先度2: アクセス。母数不足なら他のKPIは評価せずアクセス対策に集中
  if (product.current.ct < MIN_ACCESS_FOR_CVR_EVAL) return ['access']

  const issues: IssueType[] = []
  // アクセスが目標水準に達していなければ、最優先で提示（CVR/客単価より先）
  if (shopKpis.ctr > 0 && product.current.ctr < shopKpis.ctr * 0.75) {
    issues.push('access')
  }
  // 優先度3: 客単価・CVR（同列）
  if (product.current.cvr < shopKpis.cvr * 0.85) issues.push('cvr')
  if (product.current.av < shopKpis.av * 0.85) issues.push('av')
  // 明確な課題が無い場合もアクセス改善から検討する
  if (issues.length === 0) issues.push('access')
  return issues
}

export default function ActionPanel({ product, shopKpis, weekKey, onClose }: ActionPanelProps) {
  const [hasInventory, setHasInventory] = useState(true)
  const [inventoryInfo, setInventoryInfo] = useState<InventoryInfo | null>(null)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [expandedIssues, setExpandedIssues] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.actions.get(product.product_url, weekKey) as Promise<Record<string, boolean> | null>,
      api.actions.getInventory(product.product_url, product.management_no) as Promise<InventoryInfo | null>,
    ]).then(([actions, inv]) => {
      setChecked(actions ?? {})
      setHasInventory(inv?.has_inventory ?? true)
      setInventoryInfo(inv ?? null)
    }).catch((e: unknown) => {
      console.error('[ActionPanel] アクションデータ取得エラー:', e)
      setChecked({})
      setHasInventory(true)
      setInventoryInfo(null)
    }).finally(() => setLoading(false))
  }, [product.product_url, product.management_no, weekKey])

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
    // 自動連携中（月次在庫数が正）・廃盤（取扱停止）は手動トグル不可
    if (inventoryInfo?.source === 'auto' || inventoryInfo?.source === 'inactive') return
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
        {/* KPIサマリ（アクセス母数が少ない場合、CVR・客単価は参考値扱い） */}
        <div className="px-4 py-3 border-b">
          {(() => {
            const lowAccess = product.current.ct < MIN_ACCESS_FOR_CVR_EVAL
            const cards = [
              { label: 'アクセス', val: `${product.current.ct.toLocaleString()}`, warn: lowAccess, note: lowAccess ? '⚠️ 母数不足' : undefined },
              { label: 'CVR', val: formatPercent(product.current.cvr, 2), warn: !lowAccess && product.current.cvr < shopKpis.cvr * 0.85, note: lowAccess ? '参考値' : undefined },
              { label: '客単価', val: formatCurrency(product.current.av), warn: !lowAccess && product.current.av < shopKpis.av * 0.85, note: lowAccess ? '参考値' : undefined },
              { label: 'ROAS', val: formatPercent(product.current.roas), warn: product.current.roas < 200, note: undefined },
            ]
            return (
              <div className="grid grid-cols-2 gap-2 text-xs">
                {cards.map(({ label, val, warn, note }) => (
                  <div key={label} className={`rounded-lg p-2 text-center ${warn ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}>
                    <p className="text-gray-500">{label}</p>
                    <p className={`font-bold ${warn ? 'text-red-600' : 'text-gray-900'}`}>{val}</p>
                    {note ? (
                      <p className={warn ? 'text-red-400' : 'text-gray-400'} style={{ fontSize: 9 }}>{note}</p>
                    ) : warn ? (
                      <p className="text-red-400" style={{ fontSize: 9 }}>⚠️ 要改善</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )
          })()}
        </div>

        {/* 大前提：在庫確認（月次商品分析データがあれば自動連携） */}
        <div className="px-4 py-3 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package size={14} className={hasInventory ? 'text-green-600' : 'text-red-500'} />
              <p className="text-xs font-semibold text-gray-700">大前提：在庫ステータス</p>
            </div>
            {inventoryInfo?.source === 'inactive' ? (
              <span
                className="text-xs px-2.5 py-1 rounded-full font-medium bg-gray-200 text-gray-600"
                title="商品マスタで廃盤（取扱停止）に設定されています"
              >
                ⛔ 取扱停止
              </span>
            ) : inventoryInfo?.source === 'auto' ? (
              <span
                className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                  hasInventory ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}
                title={`月次商品分析データ（${inventoryInfo.year_month}）から自動判定`}
              >
                {hasInventory
                  ? `✅ 在庫 ${inventoryInfo.stock_count?.toLocaleString()}点`
                  : '⚠️ 在庫なし'}
              </span>
            ) : (
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
            )}
          </div>
          {inventoryInfo?.source === 'auto' && (
            <p className="mt-1 text-[10px] text-gray-400">
              🔗 月次商品分析データ（{inventoryInfo.year_month}）と自動連携中
              {(inventoryInfo.zero_stock_days ?? 0) > 0 && (
                <span className="text-amber-600"> ／ 在庫0日数: {inventoryInfo.zero_stock_days}日</span>
              )}
            </p>
          )}
          {inventoryInfo?.source === 'inactive' ? (
            <p className="mt-1.5 text-xs text-gray-600 bg-gray-100 rounded p-2">
              この商品は商品マスタで廃盤（取扱停止）に設定されています。改善アクションの対象外です。
            </p>
          ) : !hasInventory && (
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
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                検出された課題と改善アクション
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">
                優先度: 在庫 &gt; アクセス &gt; 客単価・CVR の順に表示
              </p>
              {hasInventory && product.current.ct < MIN_ACCESS_FOR_CVR_EVAL && (
                <p className="mt-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 leading-snug">
                  アクセスが{MIN_ACCESS_FOR_CVR_EVAL}未満のため、CVR・客単価は評価していません。
                  まずアクセス対策で母数を確保しましょう。
                </p>
              )}
            </div>

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
                                {action.detail && !isChecked && (
                                  <p className="text-[10px] text-gray-400 leading-snug mt-0.5">
                                    {action.detail}
                                  </p>
                                )}
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
