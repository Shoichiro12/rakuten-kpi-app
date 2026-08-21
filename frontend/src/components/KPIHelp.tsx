import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { HelpCircle } from 'lucide-react'

export const KPI_DEFINITIONS: Record<string, { formula: string; desc: string; good?: string }> = {
  Rev: {
    formula: 'GP − (広告費 + 店舗運営経費)',
    desc: '実際の営業利益。マイナスは赤字を意味します。',
    good: '目標：プラス維持',
  },
  ROI: {
    formula: 'GP ÷ 広告費 × 100',
    desc: '広告費に対する利益の比率。100%以上で広告投資が黒字。',
    good: '目標：200% 以上',
  },
  CPO: {
    formula: '広告費 ÷ 注文件数',
    desc: '1注文を獲得するのにかかった広告費。低いほど効率的。',
    good: 'Limit CPO 以下を維持',
  },
  'Limit CPO': {
    formula: 'GP ÷ 注文件数',
    desc: 'CPOがこの値を超えると利益が出ない上限値。',
    good: 'CPO < Limit CPO を守る',
  },
  GPR: {
    formula: 'GP ÷ RPP売上 × 100',
    desc: '売上に占める粗利の割合。原価率を下げると改善。',
    good: '目標：40% 以上',
  },
  GP: {
    formula: 'RPP売上 − 売上原価',
    desc: '売上から原価を引いた粗利益。広告費・経費の原資。',
  },
  ROAS: {
    formula: 'RPP売上 ÷ 広告費 × 100',
    desc: '広告費1円に対して何円の売上を生んだか。',
    good: '目標：300% 以上',
  },
  CVR: {
    formula: '注文件数 ÷ クリック数 × 100',
    desc: '広告をクリックした人が購入に至った割合。商品ページの訴求力を示す。',
    good: '目標：1〜3%',
  },
  CTR: {
    formula: 'クリック数 ÷ 広告表示回数 × 100',
    desc: '広告が表示された中でクリックされた割合。タイトル・画像の魅力を示す。',
    good: '目標：1% 以上',
  },
  CPC: {
    formula: '広告費 ÷ クリック数',
    desc: '1クリックあたりのコスト。上昇トレンドは競合増加のサイン。',
    good: '上昇トレンドに注意',
  },
  Av: {
    formula: 'RPP売上 ÷ 注文件数',
    desc: '1注文あたりの平均購入金額。セット販売・アップセルで改善。',
  },
  Gross: {
    formula: '集計期間内のRPP広告経由の売上合計',
    desc: 'RPP広告経由で発生した売上。広告外の自然検索売上は含まない。',
  },
}

interface KPIHelpProps {
  metric: string
  size?: number
}

/** ツールチップ本体の幅（px）。位置計算・画面端クランプの両方で使う。 */
const TOOLTIP_WIDTH = 240

/** 同時に1つしか開かないようにするための排他制御イベント名。
 *  外側クリック判定（mousedown）はボタンを跨いだ開閉のタイミング次第で取りこぼしうるため、
 *  「開いたら他の全インスタンスへ閉じるよう通知する」方式で確実に単一表示を保証する。 */
const EXCLUSIVE_OPEN_EVENT = 'kpi-help-open'

export default function KPIHelp({ metric, size = 13 }: KPIHelpProps) {
  const [open, setOpen] = useState(false)
  const instanceId = useRef(Symbol(metric))
  const btnRef = useRef<HTMLButtonElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  // ボタン中心のx座標・ツールチップ下端のy座標（= ボタン上端）。Portalでbody直下に
  // 描画するため、カード側の overflow-hidden によるクリップを構造的に受けない。
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  // 開いた瞬間にボタンの画面座標からツールチップ位置を計算する。
  // レイアウト確定後・描画前に計算したいので useLayoutEffect を使う（ちらつき防止）。
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    setPos({ x: rect.left + rect.width / 2, y: rect.top - 8 })
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (btnRef.current?.contains(target)) return
      if (tooltipRef.current?.contains(target)) return
      setOpen(false)
    }
    // スクロール・リサイズが起きるとボタンとツールチップの位置がずれるため閉じる
    // （position:fixed はビューポート基準で、スクロールに追従しないため）。
    const handleDismiss = () => setOpen(false)
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('scroll', handleDismiss, true)
    window.addEventListener('resize', handleDismiss)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('scroll', handleDismiss, true)
      window.removeEventListener('resize', handleDismiss)
    }
  }, [open])

  // 他のKPIHelpインスタンスが開いたら自分を閉じる（同時に複数開かないための排他制御）
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail !== instanceId.current) setOpen(false)
    }
    document.addEventListener(EXCLUSIVE_OPEN_EVENT, handler)
    return () => document.removeEventListener(EXCLUSIVE_OPEN_EVENT, handler)
  }, [])

  const def = KPI_DEFINITIONS[metric]
  if (!def) return null

  // 画面端でツールチップが見切れないよう、中心xを画面内にクランプする
  const clampedX = pos
    ? Math.min(Math.max(pos.x, TOOLTIP_WIDTH / 2 + 8), window.innerWidth - TOOLTIP_WIDTH / 2 - 8)
    : 0

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => {
            const next = !o
            if (next) document.dispatchEvent(new CustomEvent(EXCLUSIVE_OPEN_EVENT, { detail: instanceId.current }))
            return next
          })
        }}
        className="text-gray-300 hover:text-gray-500 transition-colors"
        aria-label={`${metric}の説明`}
        aria-expanded={open}
      >
        <HelpCircle size={size} />
      </button>

      {open && pos && createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          style={{ top: pos.y, left: clampedX, width: TOOLTIP_WIDTH }}
          className="fixed z-[999] -translate-x-1/2 -translate-y-full bg-gray-900 text-white rounded-xl shadow-xl p-3.5 text-left"
        >
          <div className="space-y-2">
            <p className="text-xs font-bold text-white">{metric}</p>
            <div className="bg-gray-800 rounded-lg px-2.5 py-1.5">
              <p className="text-xs text-gray-400 mb-0.5">計算式</p>
              <p className="text-xs font-mono text-blue-300">{def.formula}</p>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed">{def.desc}</p>
            {def.good && (
              <p className="text-xs text-green-400 font-medium">{def.good}</p>
            )}
          </div>
          {/* 矢印。中心xがクランプされた場合はボタン直下からずれうるが、視認性への影響は軽微 */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
        </div>,
        document.body,
      )}
    </>
  )
}
