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

  const load = useCallback(async () => {
    try {
      const res = await api.revenuePlan.get(yearMonth)
      setPlan(res ?? null)
    } catch (e) {
      console.error('[RevenuePlanPanel] 取得エラー:', e)
      setPlan(null)
    }
  }, [yearMonth])

  useEffect(() => { load() }, [load])

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
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              conf === 'high' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
            }`}>
              季節按分（{conf === 'high' ? '精度高' : '実績1周分'}）
            </span>
          )}
          {plan.status === 'flat' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-100 text-amber-700">均等按分</span>
          )}
        </div>
        <span className="text-[10px] text-gray-400">
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
        </div>
      )}

      {cur && (
        <>
          {/* 一気通貫: 予算 → 必要アクセス → 現状 → 想定広告費 */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="bg-violet-50 border border-violet-100 rounded-lg p-3">
              <p className="text-[10px] text-violet-600 font-medium">月次売上予算（按分）</p>
              <p className="text-lg font-bold text-violet-900">¥{Math.round(cur.sales_budget).toLocaleString()}</p>
            </div>
            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 relative">
              <ArrowRight size={12} className="absolute -left-2 top-1/2 -translate-y-1/2 text-gray-300 hidden lg:block" />
              <p className="text-[10px] text-gray-500 font-medium">必要アクセス（UU）</p>
              <p className="text-lg font-bold text-gray-900">{Math.round(cur.required_access).toLocaleString()}</p>
              <p className="text-[10px] text-gray-400">目標CVR {cur.target_cvr}% × 客単価 ¥{Math.round(cur.target_av).toLocaleString()}</p>
            </div>
            <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 relative">
              <ArrowRight size={12} className="absolute -left-2 top-1/2 -translate-y-1/2 text-gray-300 hidden lg:block" />
              <p className="text-[10px] text-gray-500 font-medium">現状アクセス（UU）</p>
              <p className="text-lg font-bold text-gray-900">
                {cur.actual_access != null ? cur.actual_access.toLocaleString() : '—'}
              </p>
              {cur.actual_access_month && cur.actual_access_month !== cur.year_month && (
                <p className="text-[10px] text-amber-600">{cur.actual_access_month}実績を見込みとして使用</p>
              )}
            </div>
            <div className={`border rounded-lg p-3 relative ${cur.shortfall_access > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
              <ArrowRight size={12} className="absolute -left-2 top-1/2 -translate-y-1/2 text-gray-300 hidden lg:block" />
              <p className={`text-[10px] font-medium ${cur.shortfall_access > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                {cur.shortfall_access > 0 ? `不足 ${Math.round(cur.shortfall_access).toLocaleString()} UU → 想定追加広告費` : '必要アクセス充足'}
              </p>
              <p className={`text-lg font-bold ${cur.shortfall_access > 0 ? 'text-amber-900' : 'text-green-800'}`}>
                {cur.shortfall_access <= 0 ? '追加投資なし' : cur.est_ad_cost != null ? `¥${Math.round(cur.est_ad_cost).toLocaleString()}` : '算出不可（RPP実績なし）'}
              </p>
              {cur.cpc != null && cur.shortfall_access > 0 && (
                <p className="text-[10px] text-gray-500">
                  CPC ¥{cur.cpc.toLocaleString()}（{cur.cpc_source_month}実績{cur.cpc_is_fallback ? '・直近月で代用' : ''}）
                </p>
              )}
            </div>
          </div>

          <p className="text-[10px] text-gray-400 mt-2 leading-snug">
            根拠: {cur.target_basis_detail}。{cur.note}。
            {plan.status === 'flat' && ` ${plan.guide.message}`}
          </p>
        </>
      )}
    </div>
  )
}
