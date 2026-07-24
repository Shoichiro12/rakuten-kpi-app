import type { AccessAxis } from '../types'
import { ACCESS_AXIS_LABEL } from '../types'

interface ReliabilityNoteProps {
  /** バックエンドの reliable。false のときだけ注記を出す（要件No.6） */
  reliable?: boolean
  /** どちらの母数で判定したか（要件No.5）。指定するとラベルに軸を添える */
  accessAxis?: AccessAxis
  /** 'inline'=小さい注記文 / 'badge'=バッジ表示。既定は inline */
  variant?: 'inline' | 'badge'
  className?: string
}

/**
 * 母数不足（reliable=false）のとき「※母数不足のため参考値」を統一トーンで表示する共通注記。
 * 評価マトリクスの母数不足バッジと同じ amber 系で揃える（要件No.6）。
 * reliable が false 以外（true / undefined）のときは何も描画しない。
 */
export default function ReliabilityNote({
  reliable,
  accessAxis,
  variant = 'inline',
  className = '',
}: ReliabilityNoteProps) {
  if (reliable !== false) return null

  const axisText = accessAxis ? `（${ACCESS_AXIS_LABEL[accessAxis]}が不足）` : ''
  const title = `アクセス母数が少ないため、CVR・客単価は統計的に信用できません${axisText}。参考値として扱ってください。`

  if (variant === 'badge') {
    return (
      <span
        className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-100 text-amber-700 ${className}`}
        title={title}
      >
        ⚠️ 母数不足・参考値
      </span>
    )
  }

  return (
    <p className={`text-[10px] text-amber-600 leading-snug ${className}`} title={title}>
      ※ 母数不足のため参考値（CVR・客単価は信用できません）
    </p>
  )
}
