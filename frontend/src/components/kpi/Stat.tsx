import type { ReactNode } from 'react'

/**
 * KPIタイル。**並びは ラベル → 数値 → デルタ で固定**（Plausible / Grafana / PostHog 共通の形）。
 * デルタを数値の上に置かないこと。
 *
 * 文字サイズは2段階しか用意しない（規則 2-2: サイズは3種類まで・大きい要素は最大2つまで）。
 *   hero    … 1画面に1つだけ。多くて2つ
 *   default … それ以外すべて
 *
 * ヒーロー数値に `tabular-nums` は付けない（等幅だと大きい字は間延びする）。
 * 表の数値列には付ける（`Table` 側の責務）。
 */

interface Props {
  label: string
  /** 整形済みの文字列を渡す（format.ts を通したもの） */
  value: string
  /** 値の右に小さく添える単位など */
  suffix?: string
  /** <Delta /> を渡す */
  delta?: ReactNode
  /** 補足の1行 */
  note?: ReactNode
  size?: 'hero' | 'default'
  /** ラベル右のアイコン（ヘルプなど） */
  aside?: ReactNode
  className?: string
}

export default function Stat({
  label,
  value,
  suffix,
  delta,
  note,
  size = 'default',
  aside,
  className = '',
}: Props) {
  const hero = size === 'hero'
  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-2">
        {/* 日本語ラベルに uppercase / tracking-wide を付けないこと（効かないか、間延びする） */}
        <p className={`font-semibold text-gray-600 ${hero ? 'text-sm' : 'text-xs'}`}>{label}</p>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      <p
        className={`mt-1 font-bold text-gray-900 ${
          hero ? 'text-[40px] leading-[1.05] tracking-tight' : 'text-[22px] leading-tight tracking-tight'
        }`}
      >
        {value}
        {suffix && (
          <span className={`ml-0.5 font-semibold text-gray-500 ${hero ? 'text-2xl' : 'text-sm'}`}>{suffix}</span>
        )}
      </p>
      {delta && <div className="mt-1">{delta}</div>}
      {note && <div className="mt-1 text-xs text-gray-500 leading-relaxed">{note}</div>}
    </div>
  )
}
