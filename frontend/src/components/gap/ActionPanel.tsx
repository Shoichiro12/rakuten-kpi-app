import { useEffect, useState } from 'react'
import { X, Package, AlertTriangle, CheckSquare, Square, ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '../../lib/api'
import { formatCurrency, formatPercent } from '../../lib/utils'
import type { KPIs, InventoryInfo } from '../../types'

type IssueType = 'access' | 'cvr' | 'av' | 'inventory'

interface ActionDef {
  key: string
  category: 'Promotion' | 'Price' | 'Product' | 'Place' | '仕入れ'
  issue: IssueType[]
  text: string
  /** 具体的なタクティクスの補足（NATIONS資料の4Pアクション例より）。 */
  detail?: string
}

// 4P改善アクション（要件No.10: NATIONS資料のタクティクスをカテゴリ別に網羅）。
// 既存の action_key は保存済みチェック状態との互換のため変更しない。新規タクティクスを追加している。
const ACTIONS: ActionDef[] = [
  // ── アクセス課題（Promotion） ─────────────────────────────
  { key: 'rpp_bid', category: 'Promotion', issue: ['access'], text: 'RPP広告のCPC・入札単価を見直す', detail: 'ROAS目標を下回る入札は下げ、伸びるキーワードへ予算を寄せる' },
  { key: 'seo_keyword', category: 'Promotion', issue: ['access'], text: '商品名・キャッチコピーにキーワードを追加（SEO対策）', detail: '検索需要の高い語・型番・用途語をタイトル前方に配置' },
  { key: 'search_rank', category: 'Promotion', issue: ['access'], text: '検索順位・流入キーワードを分析して対策', detail: '主要キーワードの表示順位を確認し、上位化の余地を探す' },
  { key: 'thumbnail', category: 'Promotion', issue: ['access'], text: 'CTRが低い場合：サムネイル・バナーを改善', detail: '1枚目画像の訴求・価格・特典表示で検索一覧のクリック率を上げる' },
  { key: 'coupon', category: 'Promotion', issue: ['access'], text: 'キャンペーン・クーポンでアクセスを増やす', detail: '目玉クーポンで集客し、回遊・併売につなげる' },
  { key: 'sale_event', category: 'Promotion', issue: ['access'], text: '楽天スーパーSALE・お買い物マラソンにエントリー', detail: 'イベント時の割引・買い回り需要でアクセスを集中的に獲得' },
  { key: 'rmp', category: 'Promotion', issue: ['access'], text: '楽天市場内の広告枠（RMP）を活用', detail: 'ディスプレイ広告・クーポンアドバンス等で露出を拡大' },
  { key: 'sns_external', category: 'Promotion', issue: ['access'], text: 'SNS・外部流入（Instagram/LINE等）を強化', detail: '楽天外からの送客でUUの母数自体を増やす' },

  // ── 転換率(CVR)課題（Price / Product / Place） ────────────
  { key: 'price_review', category: 'Price', issue: ['cvr'], text: '販売価格・クーポンを見直す', detail: '競合と並んだときに選ばれる実質価格になっているか確認' },
  { key: 'competitor_price', category: 'Price', issue: ['cvr'], text: '競合の価格・送料・ポイントを調査して対抗', detail: '実質価格（本体＋送料−ポイント）で比較し差を埋める' },
  { key: 'point_rate', category: 'Price', issue: ['cvr'], text: 'ポイント還元率（SPU・倍率）を上げる', detail: '期間限定ポイントで実質値引き感を出す' },
  { key: 'time_sale', category: 'Price', issue: ['cvr'], text: 'タイムセール・期間限定値引きで背中を押す', detail: '「今買う理由」を作り、離脱・カゴ落ちを減らす' },
  { key: 'lp_review', category: 'Product', issue: ['cvr'], text: '商品ページLP（ファーストビュー）を改善する', detail: 'ベネフィット・比較・購入ボタンを上部に集約し離脱を防ぐ' },
  { key: 'image_improve', category: 'Product', issue: ['cvr'], text: '商品説明・画像（サイズ/素材/使用シーン）を充実させる', detail: '不安要素を先回りで解消し、返品懸念を減らす' },
  { key: 'review_promo', category: 'Product', issue: ['cvr'], text: 'レビュー投稿を促進する（サンキューメール・特典）', detail: 'レビュー件数・評点は転換率と検索順位の両方に効く' },
  { key: 'faq', category: 'Product', issue: ['cvr'], text: 'よくある質問・不安要素の解消コンテンツを追加', detail: 'サイズ選び・使い方・保証などの疑問をページ内で解決' },
  { key: 'shipping', category: 'Place', issue: ['cvr'], text: '出荷リードタイム・送料を見直す', detail: '「あす楽」対応や送料無料化で購入ハードルを下げる' },
  { key: 'delivery_info', category: 'Place', issue: ['cvr'], text: '在庫表示・配送日時の表示を分かりやすくする', detail: '「いつ届くか」を明示し、離脱を防ぐ' },
  { key: 'payment', category: 'Place', issue: ['cvr'], text: '決済手段（後払い・分割等）を拡充する', detail: '希望する支払い方法が無いことによる離脱を防ぐ' },

  // ── 客単価(Av)課題（Product / Price） ─────────────────────
  { key: 'bundle', category: 'Product', issue: ['av'], text: 'セット販売・まとめ買いプランを作成', detail: '単品より1注文あたりの購入点数を増やす' },
  { key: 'cross_sell', category: 'Product', issue: ['av'], text: '関連商品のクロスセル導線を設定', detail: '併用品・消耗品をページ内・同梱提案で回遊させる' },
  { key: 'upsell', category: 'Product', issue: ['av'], text: '上位グレード・大容量へのアップセル導線', detail: '「少し上の商品」を並べて単価の底上げを狙う' },
  { key: 'subscription', category: 'Product', issue: ['av'], text: '定期購入・頒布会を設定する', detail: '継続購入でLTVと1回あたり単価を安定させる' },
  { key: 'bundle_price', category: 'Price', issue: ['av'], text: 'バンドル価格・セット割を見直す', detail: 'まとめ買いのお得感を明確にして点数増を促す' },
  { key: 'qty_discount', category: 'Price', issue: ['av'], text: 'まとめ買い割引（2個以上で〇%オフ）を設定', detail: '数量に応じた割引で1注文の金額を引き上げる' },
  { key: 'free_shipping', category: 'Price', issue: ['av'], text: '送料無料ラインを調整する', detail: '「あと〇円で送料無料」で客単価アップを誘導' },

  // ── 大前提：在庫なし（仕入れ・最優先） ───────────────────
  { key: 'restock', category: '仕入れ', issue: ['inventory'], text: '入荷スケジュールを見直す', detail: '売れ筋の欠品期間を最小化する' },
  { key: 'qty_adjust', category: '仕入れ', issue: ['inventory'], text: '仕入れ数量を調整する', detail: '販売ペースに対して発注量・タイミングを最適化' },
  { key: 'preorder', category: '仕入れ', issue: ['inventory'], text: '予約販売・入荷待ち登録で機会損失を防ぐ', detail: '在庫切れ中も需要を取りこぼさない' },
  { key: 'alt_product', category: '仕入れ', issue: ['inventory'], text: '代替商品への切り替え・誘導を検討', detail: '欠品品の受け皿となる類似商品を用意' },
  { key: 'pause_ads', category: '仕入れ', issue: ['inventory'], text: '在庫切れ商品の広告を一時停止する', detail: '買えない商品への広告費（無駄打ち）を止める' },
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

/** アクセス母数がこの値未満の場合、CVR・客単価は統計的に信用しない（NATIONS講座ルール） */
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
