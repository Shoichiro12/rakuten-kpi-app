import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Target as TargetIcon, ArrowRight } from 'lucide-react'
import { api } from '../../lib/api'
import type { RevenuePlanResponse } from '../../types'

/**
 * 売上予算プラン（第4段階v2）。
 * 月次売上予算（季節指数按分） → 必要アクセス → 想定広告費 を一気通貫で表示する。
 * 既存 AccessPlanner（目標売上ベースの逆算）とは軸が違う数字なので、名前と説明で明確に分ける。
 */
export default function RevenuePlanPanel({ yearMonth }: { yearMonth: string }) {
  const [plan, setPlan] = useState<RevenuePlanResponse | null>(null)
  // 許容広告費（ギャップ逆算）。都度入力・保存しない（オーナー確定の仕様）
  const [allowableInput, setAllowableInput] = useState('')
  const [simulating, setSimulating] = useState(false)

  const load = useCallback(async (allowable?: number) => {
    try {
      const res = await api.revenuePlan.get(yearMonth, allowable)
      setPlan(res ?? null)
    } catch (e) {
      console.error('[RevenuePlanPanel] 取得エラー:', e)
      setPlan(null)
    }
  }, [yearMonth])

  useEffect(() => { setAllowableInput(''); load() }, [load])

  const simulate = async () => {
    const v = Number(allowableInput)
    if (!Number.isFinite(v) || v < 0) return
    setSimulating(true)
    try {
      await load(v)
    } finally {
      setSimulating(false)
    }
  }

  if (!plan) return null

  const cur = plan.current
  const conf = plan.seasonal_index.confidence

  return (
    <div className="bg-white rounded-xl border shadow-sm p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <div className="flex items-center gap-2">
          <TargetIcon size={15} className="text-violet-600" />
          <h3 className="text-sm font-semibold text-gray-700">売上予算プラン（{plan.base_month}）</h3>
          {plan.status === 'ok' && conf && (
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
              conf === 'high' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
            }`}>
              季節按分（{conf === 'high' ? '精度高' : '実績1周分'}）
            </span>
          )}
          {plan.status === 'flat' && (
            <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-amber-100 text-amber-700">均等按分</span>
          )}
        </div>
        <span className="text-xs text-gray-400">
          年間予算 {plan.annual_sales_budget != null ? `¥${plan.annual_sales_budget.toLocaleString()}` : '未設定'}
          ／年度 {plan.budget_year.from}〜{plan.budget_year.to}
        </span>
      </div>
      <p className="text-xs text-gray-400 mb-3">
        年間売上予算から逆算した「この月に必要な数字」。下の必要アクセス・広告費は目標達成のための試算値で、広告費の上限管理ではありません。
      </p>

      {(plan.status === 'no_budget' || plan.status === 'collect_data') && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
          <p className="text-sm font-medium text-gray-700">{plan.guide.title}</p>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">{plan.guide.message}</p>
          {plan.status === 'no_budget' && (
            <Link to="/targets" className="inline-block mt-2 text-xs font-medium text-blue-600 hover:underline">
              目標設定画面で年間売上予算を入力する →
            </Link>
          )}
          {plan.status === 'collect_data' && (
            <Link to="/import" className="inline-block mt-2 text-xs font-medium text-blue-600 hover:underline">
              データ取込み画面で商品分析レポートを取り込む →
            </Link>
          )}
        </div>
      )}

      {cur && (
        <>
          {/* 一気通貫: 予算 → 必要アクセス → 現状 → 想定広告費 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="bg-violet-50 border border-violet-100 rounded-lg p-3">
              <p className="text-xs text-violet-600 font-medium">月次売上予算（按分）</p>
              <p className="text-lg font-bold text-violet-900">¥{Math.round(cur.sales_budget).toLocaleString()}</p>
            </div>
            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 relative">
              <ArrowRight size={12} className="absolute -left-2 top-1/2 -translate-y-1/2 text-gray-300 hidden lg:block" />
              <p className="text-xs text-gray-500 font-medium">必要アクセス（UU）</p>
              <p className="text-lg font-bold text-gray-900">{Math.round(cur.required_access).toLocaleString()}</p>
              <p className="text-xs text-gray-400">目標CVR {cur.target_cvr}% × 客単価 ¥{Math.round(cur.target_av).toLocaleString()}</p>
            </div>
            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 relative">
              <ArrowRight size={12} className="absolute -left-2 top-1/2 -translate-y-1/2 text-gray-300 hidden lg:block" />
              <p className="text-xs text-gray-500 font-medium">現状アクセス（UU）</p>
              <p className="text-lg font-bold text-gray-900">
                {cur.actual_access != null ? cur.actual_access.toLocaleString() : '—'}
              </p>
              {cur.actual_access_month && cur.actual_access_month !== cur.year_month && (
                <p className="text-xs text-amber-600">{cur.actual_access_month}実績を見込みとして使用</p>
              )}
            </div>
            <div className={`border rounded-lg p-3 relative ${cur.shortfall_access > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
              <ArrowRight size={12} className="absolute -left-2 top-1/2 -translate-y-1/2 text-gray-300 hidden lg:block" />
              <p className={`text-xs font-medium ${cur.shortfall_access > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                {cur.shortfall_access > 0 ? `不足 ${Math.round(cur.shortfall_access).toLocaleString()} UU → 想定追加広告費` : '必要アクセス充足'}
              </p>
              <p className={`text-lg font-bold ${cur.shortfall_access > 0 ? 'text-amber-900' : 'text-green-800'}`}>
                {cur.shortfall_access <= 0 ? '追加投資なし' : cur.est_ad_cost != null ? `¥${Math.round(cur.est_ad_cost).toLocaleString()}` : '算出不可（RPP実績なし）'}
              </p>
              {cur.cpc != null && cur.shortfall_access > 0 && (
                <p className="text-xs text-gray-500">
                  CPC ¥{cur.cpc.toLocaleString()}（{cur.cpc_source_month}実績{cur.cpc_is_fallback ? '・直近月で代用' : ''}）
                </p>
              )}
            </div>
          </div>

          <p className="text-xs text-gray-400 mt-2 leading-snug">
            根拠: {cur.target_basis_detail}。{cur.note}。
            {plan.status === 'flat' && ` ${plan.guide.message}`}
          </p>

          {/* アイテム別目標との整合性（警告のみ・強制同期なし） */}
          {plan.item_target_check.count > 0 && (
            plan.item_target_check.over_budget ? (
              <div className="mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <p className="text-xs text-red-700">
                  ⚠️ アイテム別目標の合計 ¥{Math.round(plan.item_target_check.sum).toLocaleString()} が
                  月次売上予算 ¥{Math.round(cur.sales_budget).toLocaleString()} を上回っています
                  （{plan.item_target_check.coverage_rate}%）。どちらかの見直しを検討してください（自動では変更しません）。
                </p>
              </div>
            ) : plan.item_target_check.coverage_rate != null ? (
              <p className="mt-1.5 text-xs text-gray-400">
                アイテム別目標設定済み: {plan.item_target_check.count}商品・合計 ¥{Math.round(plan.item_target_check.sum).toLocaleString()}
                （月次予算の{plan.item_target_check.coverage_rate}%。全商品に設定する運用ではないため下回っていても正常です）
              </p>
            ) : null
          )}

          {/* ギャップ逆算: 許容広告費の入力（都度入力・保存しない） */}
          {cur.shortfall_access > 0 && (
            <div className="mt-3 border-t pt-3">
              <p className="text-xs font-semibold text-gray-600 mb-1.5">
                広告費にいくらまでかけられますか？（ギャップ逆算・試算のみ）
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-gray-500">¥</span>
                <input
                  type="number"
                  min={0}
                  step={50000}
                  value={allowableInput}
                  onChange={e => setAllowableInput(e.target.value)}
                  placeholder="例: 300000"
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <button
                  onClick={simulate}
                  disabled={simulating || allowableInput === ''}
                  className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  この予算で試算
                </button>
                <span className="text-xs text-gray-400">入力値は保存されません</span>
              </div>

              {plan.gap && (
                <div className="mt-3 space-y-2">
                  {plan.gap.within_budget === true && (
                    <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                      <p className="text-xs text-green-700">{plan.gap.note}</p>
                    </div>
                  )}
                  {plan.gap.within_budget === false && (
                    <>
                      <p className="text-xs text-gray-500">
                        許容広告費 ¥{plan.gap.allowable_ad_cost.toLocaleString()} で買える追加アクセスは
                        約 {Math.round(plan.gap.affordable_extra_ct ?? 0).toLocaleString()} クリック
                        （到達可能アクセス {Math.round(plan.gap.affordable_access ?? 0).toLocaleString()} UU、
                        残り不足 {Math.round(plan.gap.remaining_shortfall_access ?? 0).toLocaleString()} UU）。
                        この不足をアクセス以外のレバーで埋める選択肢:
                      </p>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                        {plan.gap.options.map(o => (
                          <div
                            key={o.type}
                            className={`border rounded-lg p-3 ${
                              o.feasible === false ? 'bg-gray-50 border-gray-200 opacity-75' : 'bg-white border-violet-200'
                            }`}
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-xs font-bold text-gray-800">{o.label}</p>
                              {o.feasible === true && (
                                <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-green-100 text-green-700">過去実績の範囲内</span>
                              )}
                              {o.feasible === false && (
                                <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-red-100 text-red-600">上限めやす超過</span>
                              )}
                            </div>
                            <p className="text-xs text-gray-600 mt-1 leading-relaxed">{o.detail}</p>
                            {o.improvement_pct != null && (
                              <p className="text-xs text-gray-400 mt-1">現在の目標値からの改善幅: +{o.improvement_pct}%</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {plan.gap.within_budget === null && plan.gap.note && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <p className="text-xs text-amber-700">{plan.gap.note}</p>
                    </div>
                  )}
                  {plan.gap.within_budget === false && plan.gap.note && (
                    <p className="text-xs text-gray-400 leading-snug">{plan.gap.note}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
