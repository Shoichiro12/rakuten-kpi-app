import { useState } from 'react'
import type { ReactNode } from 'react'
import BulletChart from '../kpi/BulletChart'
import { formatYen, formatYenAxis } from '../../lib/format'
import { formatCurrency } from '../../lib/utils'
import { FOCUS_RING } from '../../lib/a11y'

interface HeroKgiProps {
  /** 実績（RPP経由 or 商品分析の売上） */
  actualSales: number | null
  /** 目標（バックエンドが期間に応じて按分済みの値を返す） */
  targetSales: number | null
  /** あるべき進捗（ペーサー）。目標 × 経過割合 */
  pacer: number | null
  /** このペースの着地見込み */
  forecast: number | null
  /** 達成率（%） */
  achievementRate: number | null
  /** 実績の出所ラベル（RPP経由売上 / 商品分析（店舗全体）） */
  sourceLabel: string
  /** 週次のときだけ「目標（週按分）」と明記する（確認事項Q5） */
  periodBasisNote?: string
  /** 展開時にだけ出す内訳（売上3分解カード等） */
  children?: ReactNode
}

/**
 * ダッシュボードのドリルダウン入口（段1）。
 * 開いた瞬間に見えるのは「予算 vs 売上」だけ。達成していれば既定では何も足さない。
 * 未達のときだけ「詳しく見る」で下（children）に掘れる（確認事項Q3で達成時も薄いリンクを残す）。
 */
export default function HeroKgi({
  actualSales,
  targetSales,
  pacer,
  forecast,
  achievementRate,
  sourceLabel,
  periodBasisNote,
  children,
}: HeroKgiProps) {
  const [expanded, setExpanded] = useState(false)

  const hasTarget = targetSales != null && targetSales > 0
  const achieved = hasTarget && achievementRate != null && achievementRate >= 100
  const diff = hasTarget && actualSales != null ? actualSales - targetSales : null

  return (
    <div className="bg-paper rounded-xl border border-line p-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">売上{hasTarget ? ' vs 目標' : ''}</span>
          <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-bg-alt text-sub">{sourceLabel}</span>
        </div>
        {hasTarget && (
          <span
            className={`text-xs font-bold px-2.5 py-1 rounded-full ${
              achieved ? 'bg-up-bg text-up' : 'bg-alert-bg text-alert'
            }`}
          >
            {achieved ? '達成' : '未達'}
          </span>
        )}
      </div>

      {/* 金額はカード上では万・億で丸める（規約: docs/ui_number_and_chart_rules_2026-08-04.md 1-1） */}
      <p className="font-num text-[40px] leading-[1.05] font-semibold text-ink mt-2 tracking-tight tabular-nums">
        {formatYen(actualSales)}
        {hasTarget && (
          <span className="font-sans text-base font-normal text-muted ml-2">
            目標 {formatYen(targetSales)}
          </span>
        )}
      </p>

      {hasTarget ? (
        <>
          <div className="mt-4">
            <BulletChart
              value={actualSales ?? 0}
              target={targetSales}
              pace={pacer}
              projection={forecast}
              lowerIsBetter={false}
              formatTick={(v) => formatYenAxis(v)}
              valueLabel={formatYen(actualSales)}
              projectionLabel={forecast != null ? `着地見込 ${formatYen(forecast)}` : undefined}
              ariaLabel={`売上の弾丸グラフ。実績 ${formatYen(actualSales)}、目標 ${formatYen(targetSales)}`}
              height={86}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-sub mt-1">
            <span className="font-num tabular-nums font-semibold text-ink">
              達成率 {achievementRate?.toFixed(1)}%
            </span>
            {diff != null && (
              <span className={`font-num tabular-nums font-bold ${diff >= 0 ? 'text-up' : 'text-alert'}`}>
                {diff >= 0 ? '超過' : '不足'} {formatYen(Math.abs(diff))}
              </span>
            )}
          </div>
          {periodBasisNote && <p className="text-[11px] text-muted mt-1">{periodBasisNote}</p>}

          <div className="flex items-center justify-between text-xs mt-3 pt-3 border-t border-line">
            <span className="text-muted">{forecast != null ? 'このペースの着地見込み' : ''}</span>
            <span className="font-num font-medium text-sub tabular-nums">
              {forecast != null
                ? `${formatCurrency(forecast)}${hasTarget ? `（目標比 ${Math.round((forecast / targetSales) * 100)}%）` : ''}`
                : '—'}
            </span>
          </div>

          {children && !expanded && (
            <div className="mt-3">
              {achieved ? (
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className={`text-xs text-sage-deep hover:underline ${FOCUS_RING} rounded`}
                >
                  達成していますが内訳を見る
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className={`inline-flex items-center gap-1 bg-ink-strong text-white text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90 transition-opacity ${FOCUS_RING}`}
                >
                  詳しく見る →
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-muted mt-3">目標未設定（目標設定画面で売上目標を入力すると達成率が出ます）</p>
      )}

      {expanded && children && <div className="mt-4 pt-4 border-t border-line">{children}</div>}
    </div>
  )
}
