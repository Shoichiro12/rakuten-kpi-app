import { Zap, TrendingUp } from 'lucide-react'
import type { AccessPlan } from '../../types'

/**
 * アクセス逆算パネル。
 * 売上 = アクセス × CVR × 客単価 のうち、アクセスは広告運用で直接コントロール
 * できる最速のレバーであるという運用思想に基づき、CVR・客単価を現状値で固定して
 * 「目標売上に必要なアクセス数」「不足分」「想定追加広告費」を可視化する。
 */
export default function AccessPlanner({ plan }: { plan: AccessPlan }) {
  const fillRate = plan.fill_rate ?? 0
  const barWidth = Math.min(fillRate, 100)

  return (
    <div className="bg-white rounded-xl border-2 border-blue-200 shadow-sm overflow-hidden">
      {/* ヘッダー */}
      <div className="px-4 py-3 bg-blue-50 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shrink-0">
          <Zap size={16} className="text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-gray-900">アクセス逆算 — 最速レバーの現在地</p>
          <p className="text-[11px] text-gray-500">
            CVR {plan.cvr.toFixed(2)}%・客単価 ¥{Math.round(plan.av).toLocaleString()} を現状値で固定した場合の必要アクセス
          </p>
        </div>
        {plan.achieved && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-green-100 text-green-700 shrink-0">
            必要アクセス充足
          </span>
        )}
      </div>

      <div className="p-4 space-y-3">
        {/* 充足バー */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-gray-500">アクセス充足率</p>
            <p className={`text-sm font-bold ${fillRate >= 100 ? 'text-green-600' : 'text-blue-700'}`}>
              {fillRate.toFixed(1)}%
            </p>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${fillRate >= 100 ? 'bg-green-500' : 'bg-blue-500'}`}
              style={{ width: `${barWidth}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>実績: {Math.round(plan.actual_ct).toLocaleString()} クリック</span>
            <span>必要: {Math.round(plan.required_access).toLocaleString()} クリック</span>
          </div>
        </div>

        {/* 数値カード */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className={`rounded-lg p-2.5 text-center ${plan.achieved ? 'bg-green-50' : 'bg-red-50 border border-red-100'}`}>
            <p className="text-[11px] text-gray-500">不足アクセス</p>
            <p className={`text-sm font-bold ${plan.achieved ? 'text-green-700' : 'text-red-600'}`}>
              {plan.achieved ? '0' : Math.round(plan.shortfall_ct).toLocaleString()}
              <span className="text-[10px] font-normal ml-0.5">CT</span>
            </p>
          </div>
          <div className={`rounded-lg p-2.5 text-center ${plan.achieved ? 'bg-green-50' : 'bg-amber-50 border border-amber-100'}`}>
            <p className="text-[11px] text-gray-500">想定追加広告費</p>
            <p className={`text-sm font-bold ${plan.achieved ? 'text-green-700' : 'text-amber-700'}`}>
              {plan.achieved
                ? '¥0'
                : plan.est_additional_ad_cost != null
                ? `¥${Math.round(plan.est_additional_ad_cost).toLocaleString()}`
                : '算出不可'}
            </p>
            <p className="text-[9px] text-gray-400">現在CPC ¥{plan.cpc.toLocaleString()} 基準</p>
          </div>
          <div className="rounded-lg p-2.5 text-center bg-gray-50">
            <p className="text-[11px] text-gray-500">現在の広告費</p>
            <p className="text-sm font-bold text-gray-900">¥{Math.round(plan.ad_cost).toLocaleString()}</p>
          </div>
          <div className="rounded-lg p-2.5 text-center bg-gray-50">
            <p className="text-[11px] text-gray-500">売上（目標比）</p>
            <p className="text-sm font-bold text-gray-900">
              ¥{Math.round(plan.actual_gross).toLocaleString()}
            </p>
            <p className="text-[9px] text-gray-400">目標 ¥{Math.round(plan.target_sales).toLocaleString()}</p>
          </div>
        </div>

        {!plan.achieved && plan.est_additional_ad_cost != null && (
          <p className="flex items-start gap-1.5 text-xs text-blue-800 bg-blue-50 rounded-lg px-3 py-2 leading-snug">
            <TrendingUp size={13} className="shrink-0 mt-0.5" />
            <span>
              CVR・客単価が現状のままなら、あと{' '}
              <b>{Math.round(plan.shortfall_ct).toLocaleString()}クリック</b>（広告費 約{' '}
              <b>¥{Math.round(plan.est_additional_ad_cost).toLocaleString()}</b>）で目標売上に届く計算です。
              広告の入札・予算調整が最短ルートです。
            </span>
          </p>
        )}
      </div>
    </div>
  )
}
