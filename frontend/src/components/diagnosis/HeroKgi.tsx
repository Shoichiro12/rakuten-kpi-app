import { useState } from 'react'
import type { ReactNode } from 'react'
import { formatYen } from '../../lib/format'
import { formatCurrency } from '../../lib/utils'
import { FOCUS_RING } from '../../lib/a11y'

interface HeroKgiProps {
  /** 実績（RPP経由 or 商品分析の売上） */
  actualSales: number | null
  /** 按分目標。バーの100%・達成率・不足額の基準（修正指示2026-08-22）。
   *  週次はバックエンドが日割り合算按分済みの値を返す（KPI評価マトリクスと同一ソース）、
   *  月次・年次はフロントで経過割合按分した値（現状維持）。 */
  proratedTarget: number | null
  /** このペースの着地見込み */
  forecast: number | null
  /** 着地見込みの比較分母（週次=按分目標そのもの、月次・年次=フル目標）。
   *  forecastBasisLabel と分母が必ず一致すること（ラベルと実際の分母がズレていた不整合の修正）。 */
  forecastBasisValue: number | null
  /** 着地見込みの比較基準ラベル（週目標比/月目標比/年目標比） */
  forecastBasisLabel: string
  /** 実績の出所ラベル（RPP経由売上 / 商品分析（店舗全体）） */
  sourceLabel: string
  /** 按分方式のラベル（週按分/月按分/年按分）。大数字の右に按分目標と併記する（確認事項Q5） */
  periodBasisLabel: string
  /** 今日やるべきことの件数（区切り4でTodayActionsを撤去し、バッジだけここに残す。確認事項Q2） */
  recoCount?: number
  /** 展開時にだけ出す内訳（売上3分解カード等） */
  children?: ReactNode
}

/**
 * ダッシュボードのドリルダウン入口（段1）。
 * 開いた瞬間に見えるのは「予算 vs 売上」だけ。達成していれば既定では何も足さない。
 * 未達のときだけ「詳しく見る」で下（children）に掘れる（確認事項Q3で達成時も薄いリンクを残す）。
 *
 * バーは按分目標を100%とする単純な進捗バー（修正指示2026-08-22 A）。
 * 弾丸グラフ（BulletChart）は使わない — 期間途中の実績をフル目標軸で見せると
 * 常にほぼ空に見えてしまい、インラインラベルも衝突するため。BulletChart自体は
 * GAP分析等で使用中のため削除しない（HeroKgiからの参照だけ外す）。
 */
export default function HeroKgi({
  actualSales,
  proratedTarget,
  forecast,
  forecastBasisValue,
  forecastBasisLabel,
  sourceLabel,
  periodBasisLabel,
  recoCount,
  children,
}: HeroKgiProps) {
  const [expanded, setExpanded] = useState(false)

  const hasTarget = proratedTarget != null && proratedTarget > 0
  const achievementRate = hasTarget && actualSales != null ? (actualSales / proratedTarget) * 100 : null
  const achieved = achievementRate != null && achievementRate >= 100
  const diff = hasTarget && actualSales != null ? actualSales - proratedTarget : null
  const fillPct = achievementRate != null ? Math.min(100, Math.max(0, achievementRate)) : 0

  return (
    <div className="bg-paper rounded-xl border border-line p-5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">売上{hasTarget ? ' vs 目標' : ''}</span>
          <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-bg-alt text-sub">{sourceLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          {!!recoCount && recoCount > 0 && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-sage-soft text-sage-deep">
              今日やること {recoCount}件
            </span>
          )}
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
      </div>

      {/* 1行目: 実績（大・num）＋按分目標（右添え・muted） */}
      <p className="font-num text-[40px] leading-[1.05] font-semibold text-ink mt-2 tracking-tight tabular-nums">
        {formatYen(actualSales)}
        {hasTarget && (
          <span className="font-sans text-base font-normal text-muted ml-2">
            目標 {formatYen(proratedTarget)}（{periodBasisLabel}）
          </span>
        )}
      </p>

      {hasTarget ? (
        <>
          {/* バー: 按分目標=100%の単純な進捗バー。バー上に文字は置かない */}
          <div className="relative mt-4">
            <div className="h-1.5 rounded-[3px] bg-bg-alt overflow-hidden">
              <div
                className={`h-full rounded-[3px] ${achieved ? 'bg-up' : 'bg-alert'}`}
                style={{ width: `${fillPct}%` }}
              />
            </div>
            {/* 目標ティック（右端＝按分目標の位置） */}
            <div aria-hidden="true" className="absolute right-0 -top-0.5 -bottom-0.5 w-[1.5px] bg-sub" />
          </div>

          {/* 2行目: 達成率（左）／ 不足・超過額（右） */}
          <div className="flex items-center justify-between text-xs text-sub mt-2">
            <span className="font-num tabular-nums font-semibold text-ink">
              達成率 {achievementRate?.toFixed(1)}%
            </span>
            {diff != null && (
              <span className={`font-num tabular-nums font-bold ${diff >= 0 ? 'text-up' : 'text-alert'}`}>
                {diff >= 0 ? '超過' : '不足'} {formatYen(Math.abs(diff))}
              </span>
            )}
          </div>

          {/* 3行目: 着地見込み（罫線下・sub色） */}
          <div className="flex items-center justify-between text-xs mt-3 pt-3 border-t border-line">
            <span className="text-muted">{forecast != null ? 'このペースの着地見込み' : ''}</span>
            <span className="font-num font-medium text-sub tabular-nums">
              {forecast != null
                ? `${formatCurrency(forecast)}${
                    forecastBasisValue != null && forecastBasisValue > 0
                      ? `（${forecastBasisLabel} ${Math.round((forecast / forecastBasisValue) * 100)}%）`
                      : ''
                  }`
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
