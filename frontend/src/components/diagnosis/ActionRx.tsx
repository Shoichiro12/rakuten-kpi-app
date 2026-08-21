import { useEffect, useState } from 'react'
import { CheckSquare, Square, Package } from 'lucide-react'
import { api } from '../../lib/api'
import type { KPIs, InventoryInfo, RecommendationsResponse, Recommendation } from '../../types'
import { CATEGORY_COLOR, ISSUE_LABEL, actionsForIssue, type IssueType } from '../gap/actionLibrary'
import { FOCUS_RING } from '../../lib/a11y'

interface ProductInfo {
  product_url: string
  product_name: string
  management_no: string
  current: KPIs
}

interface ActionRxProps {
  product: ProductInfo
  shopKpis: KPIs
  weekKey: string
  recos: RecommendationsResponse | null
  onActionChanged: () => void
}

/** アクセス母数がこの値未満の場合、CVR・客単価は統計的に信用しない（ActionPanel.tsxと同じ基準） */
const MIN_ACCESS_FOR_CVR_EVAL = 100

/** 課題検出。ActionPanel.tsx の detectIssues と同一ロジック（優先度: 在庫 > アクセス > 客単価 = CVR）。
 * ロジックを複製せず共有したいところだが、ActionPanel はモーダル内での複数課題の折り畳み表示、
 * こちらは「最優先1件を主役にする」段5専用の表示という別の見せ方のため、判定部分だけ複製している。
 * 変更するときは両方直すこと。 */
function detectIssues(product: ProductInfo, shopKpis: KPIs, hasInventory: boolean): IssueType[] {
  if (!hasInventory) return ['inventory']
  if (product.current.ct < MIN_ACCESS_FOR_CVR_EVAL) return ['access']
  const issues: IssueType[] = []
  if (shopKpis.ctr > 0 && product.current.ctr < shopKpis.ctr * 0.75) issues.push('access')
  if (product.current.cvr < shopKpis.cvr * 0.85) issues.push('cvr')
  if (product.current.av < shopKpis.av * 0.85) issues.push('av')
  if (issues.length === 0) issues.push('access')
  return issues
}

/**
 * 段5（アクション）。最優先1件を大カードで立て、残りは副施策の行にする。
 * 選択商品に `recommendations`（想定効果・追加費・所要の数値試算つき）があればそれを使い、
 * 無ければ4Pタクティクス集（actionLibrary.ts）から課題ベースの一般的な打ち手を出す
 * （店舗全体のトップN商品にしか数値試算が無いため、フォールバックが必要）。
 */
export default function ActionRx({ product, shopKpis, weekKey, recos, onActionChanged }: ActionRxProps) {
  const [hasInventory, setHasInventory] = useState(true)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [recoBusy, setRecoBusy] = useState(false)
  const [recoDone, setRecoDone] = useState(false)

  useEffect(() => {
    setLoading(true)
    setRecoDone(false)
    Promise.all([
      api.actions.get(product.product_url, weekKey) as Promise<Record<string, boolean> | null>,
      api.actions.getInventory(product.product_url, product.management_no) as Promise<InventoryInfo | null>,
    ])
      .then(([actions, inv]) => {
        setChecked(actions ?? {})
        setHasInventory(inv?.has_inventory ?? true)
      })
      .catch(() => {
        setChecked({})
        setHasInventory(true)
      })
      .finally(() => setLoading(false))
  }, [product.product_url, product.management_no, weekKey])

  const matchedReco: Recommendation | undefined = recos?.product_recommendations?.find(
    (r) => r.management_no === product.management_no,
  )

  const issues = detectIssues(product, shopKpis, hasInventory)
  const primaryIssue = issues[0]
  const primaryActions = actionsForIssue(primaryIssue)
  const restActions = issues.slice(1).flatMap((i) => actionsForIssue(i))

  const toggleAction = async (actionKey: string) => {
    const next = !checked[actionKey]
    setChecked((prev) => ({ ...prev, [actionKey]: next }))
    try {
      await api.actions.toggle(product.product_url, weekKey, actionKey)
    } catch {
      setChecked((prev) => ({ ...prev, [actionKey]: !next }))
    }
  }

  const completeReco = async () => {
    if (!matchedReco || !recos) return
    setRecoBusy(true)
    try {
      await api.recommendations.complete(matchedReco.key, recos.period_key, recos.period, 'done', matchedReco.title)
      setRecoDone(true)
      onActionChanged()
    } finally {
      setRecoBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-paper rounded-xl border border-line p-5">
        <div className="h-24 flex items-center justify-center text-sm text-muted">読み込み中...</div>
      </div>
    )
  }

  return (
    <div className="bg-paper rounded-xl border border-line p-5">
      <h3 className="text-sm font-semibold text-ink mb-3">{product.product_name} — 何をすべきか</h3>

      {!hasInventory && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-alert-bg px-3 py-2 text-xs text-alert">
          <Package size={14} />
          在庫切れです。他の対策より先に仕入れを調整してください。
        </div>
      )}

      {matchedReco ? (
        <div className="rounded-lg border border-line bg-paper p-4 mb-3">
          <span className="inline-block text-xs font-bold text-alert bg-alert-bg rounded-full px-2.5 py-0.5 mb-2">
            最優先
          </span>
          <h4 className="text-[15px] font-bold text-ink mb-1.5">{matchedReco.title}</h4>
          <p className="text-xs text-sub mb-3 max-w-[56ch] leading-relaxed">{matchedReco.reason}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted mb-3">
            {matchedReco.impact && <span className="font-num text-ink">{matchedReco.impact}</span>}
            <span>
              所要 <b className="font-num text-ink">{matchedReco.effort}</b>
            </span>
            {matchedReco.badges?.map((b) => (
              <span key={b}>{b}</span>
            ))}
          </div>
          {recoDone ? (
            <span className="text-xs text-up font-medium">記録しました</span>
          ) : (
            <button
              type="button"
              onClick={completeReco}
              disabled={recoBusy}
              className={`bg-ink-strong text-white text-xs font-medium px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity ${FOCUS_RING}`}
            >
              この施策を実施した
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-paper p-4 mb-3">
          <span className="inline-block text-xs font-bold text-alert bg-alert-bg rounded-full px-2.5 py-0.5 mb-2">
            最優先
          </span>
          <h4 className="text-[15px] font-bold text-ink mb-1.5">{ISSUE_LABEL[primaryIssue]}への対策</h4>
          <ul className="space-y-2">
            {primaryActions.slice(0, 3).map((a) => (
              <li key={a.key}>
                <button
                  type="button"
                  onClick={() => toggleAction(a.key)}
                  className={`w-full flex items-start gap-2 text-left rounded p-1 -mx-1 hover:bg-bg-alt ${FOCUS_RING}`}
                >
                  {checked[a.key] ? (
                    <CheckSquare size={14} className="text-sage-deep mt-0.5 shrink-0" />
                  ) : (
                    <Square size={14} className="text-line mt-0.5 shrink-0" />
                  )}
                  <span className={`text-xs leading-snug ${checked[a.key] ? 'line-through text-muted' : 'text-sub'}`}>
                    {a.text}
                    {a.detail && !checked[a.key] && <span className="block text-muted mt-0.5">{a.detail}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {restActions.length > 0 && (
        <div>
          {restActions.map((a) => (
            <div key={a.key} className="flex items-center justify-between gap-3 py-2.5 border-t border-line text-xs">
              <button
                type="button"
                onClick={() => toggleAction(a.key)}
                className={`flex items-start gap-2 text-left flex-1 min-w-0 rounded p-1 -mx-1 hover:bg-bg-alt ${FOCUS_RING}`}
              >
                {checked[a.key] ? (
                  <CheckSquare size={13} className="text-sage-deep mt-0.5 shrink-0" />
                ) : (
                  <Square size={13} className="text-line mt-0.5 shrink-0" />
                )}
                <span className={`leading-snug ${checked[a.key] ? 'line-through text-muted' : 'text-ink font-medium'}`}>
                  {a.text}
                </span>
              </button>
              <span className={`shrink-0 px-1.5 py-0.5 rounded font-medium ${CATEGORY_COLOR[a.category]}`}>
                {a.category}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
