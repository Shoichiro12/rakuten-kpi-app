import { useEffect, useState } from 'react'
import { X, AlertTriangle, Info, CheckSquare, Square, CheckCircle2, PackageX, HelpCircle } from 'lucide-react'
import { api } from '../../lib/api'
import { formatCurrency, formatPercent } from '../../lib/utils'
import type { RppConfidence, RppDiagnosisItem, RppDiagnosisResponse } from '../../types'

/**
 * RPP診断パネル（RppAnalysisページ専用）。
 *
 * 既存 ActionPanel.tsx（GAP分析）とトンマナを揃えつつ、confirmed / needs_check を
 * バッジ色で区別する（confirmed=赤、needs_check=黄）。
 * 判定・アクション文言はすべてバックエンド（/api/rpp/diagnosis）から受け取り、
 * ここでは表示とチェック状態の管理のみ行う。
 */

const CONFIDENCE_BADGE: Record<RppConfidence, { label: string; className: string }> = {
  confirmed: { label: '確定', className: 'bg-red-100 text-red-700' },
  needs_check: { label: '要確認', className: 'bg-amber-100 text-amber-700' },
  info: { label: '情報', className: 'bg-gray-100 text-gray-600' },
}

const CATEGORY_COLOR: Record<string, string> = {
  Promotion: 'bg-blue-100 text-blue-700',
  Price: 'bg-green-100 text-green-700',
  Product: 'bg-purple-100 text-purple-700',
  Place: 'bg-orange-100 text-orange-700',
  '仕入れ': 'bg-red-100 text-red-700',
}

interface RppDiagnosisPanelProps {
  item: RppDiagnosisItem
  diagnosis: RppDiagnosisResponse
  onClose: () => void
}

export default function RppDiagnosisPanel({ item, diagnosis, onClose }: RppDiagnosisPanelProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)

  const periodKey = diagnosis.period_key

  useEffect(() => {
    setLoading(true)
    api.rpp.diagnosisChecks(item.management_no, periodKey)
      .then((c) => setChecked(c ?? {}))
      .catch((e: unknown) => {
        console.error('[RppDiagnosisPanel] チェック状態取得エラー:', e)
        setChecked({})
      })
      .finally(() => setLoading(false))
  }, [item.management_no, periodKey])

  const toggleAction = async (actionKey: string) => {
    const next = !checked[actionKey]
    setChecked((prev) => ({ ...prev, [actionKey]: next }))
    try {
      await api.rpp.diagnosisToggle(item.management_no, periodKey, actionKey)
    } catch (e) {
      console.error('[RppDiagnosisPanel] チェック更新エラー:', e)
      // 楽観的更新を元に戻す
      setChecked((prev) => ({ ...prev, [actionKey]: !next }))
    }
  }

  const m = item.metrics
  const b = diagnosis.benchmarks
  const insufficient = item.status === 'insufficient_data'

  const has = (issue: string) => item.issues.some((i) => i.issue === issue)

  const cards = [
    {
      label: 'CTR',
      val: formatPercent(m.ctr, 2),
      note: b.avg_ctr != null ? `平均 ${formatPercent(b.avg_ctr, 2)}` : undefined,
      warn: has('ctr_low'),
    },
    {
      label: 'CVR(720h)',
      val: formatPercent(m.cvr_720, 2),
      note: b.avg_cvr != null ? `平均 ${formatPercent(b.avg_cvr, 2)}` : undefined,
      warn: has('cvr_low'),
    },
    {
      label: 'ROAS(720h)',
      val: formatPercent(m.roas_720, 1),
      note: `基準 ${formatPercent(b.roas_line ?? 100, 0)}`,
      warn: has('roas_low') || has('cpo_over'),
    },
    {
      label: 'CPC',
      val: formatCurrency(m.cpc),
      note: m.prev_cpc != null
        ? `前期 ${formatCurrency(m.prev_cpc)}${m.cpc_change_rate != null ? `（${m.cpc_change_rate > 0 ? '+' : ''}${m.cpc_change_rate}%）` : ''}`
        : '前期データなし',
      warn: has('cpc_spike'),
    },
  ]

  return (
    <div className="w-80 shrink-0 bg-white border-l border-gray-200 flex flex-col h-full overflow-hidden">
      {/* ヘッダー */}
      <div className="px-4 py-3 border-b flex items-start justify-between gap-2 bg-gray-50">
        <div className="min-w-0">
          <p className="text-xs text-gray-500">RPP診断</p>
          <p className="text-sm font-semibold text-gray-900 leading-tight">
            {item.product_name || item.management_no}
          </p>
          <p className="text-xs text-gray-400">{item.management_no}</p>
          {item.phase?.phase === 'new' && (
            <span
              className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-100 text-sky-700"
              title={`発売月 ${item.phase.launch_month ?? '不明'}。新商品は最初の3ヶ月を様子見期間とし、判定基準を緩めます（商品マスタで変更可）`}
            >
              {item.phase.label}
            </span>
          )}
        </div>
        <button onClick={onClose} className="p-1.5 hover:bg-gray-200 rounded-lg shrink-0">
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* KPIサマリ */}
        <div className="px-4 py-3 border-b">
          <div className="grid grid-cols-2 gap-2 text-xs">
            {cards.map(({ label, val, note, warn }) => (
              <div
                key={label}
                className={`rounded-lg p-2 text-center ${warn ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}
              >
                <p className="text-gray-500">{label}</p>
                <p className={`font-bold ${warn ? 'text-red-600' : 'text-gray-900'}`}>{val}</p>
                {note && (
                  <p className={warn ? 'text-red-400' : 'text-gray-400'} style={{ fontSize: 9 }}>
                    {note}
                  </p>
                )}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-gray-400">
            クリック数 {m.ct.toLocaleString()} ／ 広告費 {formatCurrency(m.ad_cost)} ／ 売上(720h) {formatCurrency(m.gross_720)}
          </p>
          {(b.baseline_ad_cvr || b.baseline_ctr) && (
            <p className="mt-1 text-[10px] text-gray-400 leading-snug">
              基準値の根拠:{' '}
              {b.baseline_ctr && `CTR ${formatPercent(b.baseline_ctr.value, 2)}（${b.baseline_ctr.source_label}）`}
              {b.baseline_ctr && b.baseline_ad_cvr && ' ／ '}
              {b.baseline_ad_cvr && `広告CVR ${formatPercent(b.baseline_ad_cvr.value, 2)}（${b.baseline_ad_cvr.source_label}）`}
            </p>
          )}
        </div>

        {/* ゲート判定（在庫・ページ品質）: 診断分類の対象外。ゲートの提案を表示する */}
        {item.status === 'gated' && item.gate && (
          <div className="px-4 py-4">
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 flex items-start gap-2">
              <PackageX size={14} className="text-orange-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-bold text-orange-700">{item.gate.label}</p>
                <p className="text-[11px] font-semibold text-gray-800 mt-1.5">
                  {item.gate.proposal.title}
                </p>
                <p className="text-[11px] text-gray-600 leading-snug mt-1">
                  {item.gate.proposal.reason}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* データ不足（判定スキップ・情報表示のみ。警告扱いにしない） */}
        {insufficient && (
          <div className="px-4 py-4">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 flex items-start gap-2">
              <Info size={14} className="text-gray-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-bold text-gray-700">データ不足</p>
                <p className="text-[11px] text-gray-500 leading-snug mt-1">
                  クリック数が{item.min_ct ?? diagnosis.min_ct}件未満のため判定をスキップしました。
                  {item.phase?.phase === 'new' && ' 新商品フェーズのため、基準を通常の10件から50件に引き上げています。'}
                  母数が少ない状態では各指標がぶれやすく、誤った対策につながるため、
                  まず露出とデータ蓄積を優先してください。
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 診断分類（8分類・第2段階）: 分類＋提案（試算＋セカンドベスト）を表示。
            良好型で提案が無い場合は従来の「良好」カードに任せる */}
        {item.classification && (item.classification.type !== 'good' || item.classification.proposals.length > 0) && (
          (() => {
            const cls = item.classification!
            const tone = {
              danger: { border: 'border-red-200', bg: 'bg-red-50', text: 'text-red-700' },
              warning: { border: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-700' },
              info: { border: 'border-sky-200', bg: 'bg-sky-50', text: 'text-sky-700' },
              success: { border: 'border-green-200', bg: 'bg-green-50', text: 'text-green-700' },
            }[cls.tone] ?? { border: 'border-gray-200', bg: 'bg-gray-50', text: 'text-gray-700' }
            const KIND_LABEL: Record<string, string> = {
              primary: '第一候補',
              second_best: '代替案',
              note: '補足',
            }
            return (
              <div className="px-4 pt-3">
                <div className={`rounded-xl border overflow-hidden ${tone.border}`}>
                  <div className={`px-3 py-2.5 ${tone.bg}`}>
                    <p className={`text-xs font-bold ${tone.text}`}>診断分類: {cls.label}</p>
                    <p className="text-[11px] text-gray-600 leading-snug mt-1">{cls.summary}</p>
                  </div>
                  {cls.proposals.map((p, i) => (
                    <div key={i} className={`px-3 py-2.5 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
                      <p className="text-xs text-gray-800">
                        <span className={`inline-block mr-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                          p.kind === 'primary' ? 'bg-gray-900 text-white'
                            : p.kind === 'second_best' ? 'bg-gray-200 text-gray-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}>
                          {KIND_LABEL[p.kind] ?? p.kind}
                        </span>
                        <span className="font-semibold">{p.title}</span>
                      </p>
                      <p className="text-[11px] text-gray-500 leading-snug mt-1">{p.detail}</p>
                      {p.estimate && (
                        <p className="text-[11px] font-medium text-gray-700 mt-1 bg-gray-50 rounded px-2 py-1">
                          試算: {p.estimate}
                        </p>
                      )}
                    </div>
                  ))}
                  {/* 影響の大きい提案（停止候補）は実行を強制しない原則の明示（2-C / 3-F） */}
                  {cls.type === 'bleeding' && (
                    <p className="px-3 py-2 text-[10px] text-gray-400 border-t border-gray-100 leading-snug">
                      どちらを実行するかは店舗責任者の判断に委ねられます。アプリが自動で配信を止めることはありません。
                    </p>
                  )}
                </div>
              </div>
            )
          })()
        )}

        {/* 意図確認（ゲート4・フラグ型）: 診断は数値どおり出した上で問いかけ/注記を添える */}
        {item.intent_check && (
          <div className="px-4 pt-3">
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 flex items-start gap-2">
              <HelpCircle size={14} className="text-sky-500 mt-0.5 shrink-0" />
              <p className="text-[11px] text-sky-800 leading-snug">
                {item.intent_check.ask ? item.intent_check.question : item.intent_check.note}
                {item.intent_check.ask && (
                  <span className="block mt-1 text-[10px] text-sky-600">
                    回答は商品マスタ設定の「投資として許容」から登録できます。
                  </span>
                )}
              </p>
            </div>
          </div>
        )}

        {/* 良好（分類が良好型以外の場合は分類カードに任せる） */}
        {item.status === 'good' && (!item.classification || item.classification.type === 'good') && (
          <div className="px-4 py-4">
            <div className="rounded-xl border border-green-200 bg-green-50 p-3 flex items-start gap-2">
              <CheckCircle2 size={14} className="text-green-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-bold text-green-700">良好</p>
                <p className="text-[11px] text-green-700/80 leading-snug mt-1">
                  現時点で明確な課題は検出されていません。この調子で運用を継続してください。
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 検出課題 */}
        {item.status === 'issues' && (
          loading ? (
            <div className="px-4 py-6 text-center text-sm text-gray-400">読み込み中...</div>
          ) : (
            <div className="px-4 py-3 space-y-3">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  検出された課題と改善アクション
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  <span className="inline-block px-1 rounded bg-red-100 text-red-700 font-medium">確定</span>
                  =データで原因まで特定済み ／{' '}
                  <span className="inline-block px-1 rounded bg-amber-100 text-amber-700 font-medium">要確認</span>
                  =原因の切り分けが必要
                </p>
              </div>

              {item.issues.map((issue) => {
                const badge = CONFIDENCE_BADGE[issue.confidence]
                const isChecked = issue.action ? !!checked[issue.action.key] : false
                return (
                  <div key={issue.issue} className="rounded-xl border overflow-hidden">
                    {/* 課題ヘッダー */}
                    <div
                      className={`flex items-center justify-between px-3 py-2.5 ${
                        issue.confidence === 'confirmed' ? 'bg-red-50' : 'bg-amber-50'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <AlertTriangle
                          size={13}
                          className={issue.confidence === 'confirmed' ? 'text-red-500' : 'text-amber-500'}
                        />
                        <p className="text-xs font-bold text-gray-800 truncate">{issue.label}</p>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>

                    {/* アクション */}
                    {issue.action && (
                      <button
                        onClick={() => toggleAction(issue.action!.key)}
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
                            {issue.action.text}
                          </p>
                          {issue.action.detail && !isChecked && (
                            <p className="text-[10px] text-gray-400 leading-snug mt-0.5">
                              {issue.action.detail}
                            </p>
                          )}
                          <span className={`inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded font-medium ${CATEGORY_COLOR[issue.action.category] ?? 'bg-gray-100 text-gray-600'}`}>
                            {issue.action.category}
                          </span>
                        </div>
                      </button>
                    )}
                  </div>
                )
              })}

              {/* CPO判定スキップの注記（ROAS/CPO系の課題があるときのみ表示） */}
              {!diagnosis.cpo_evaluable && item.issues.some((i) => i.issue === 'roas_low' || i.issue === 'cpo_over') && (
                <p className="text-[10px] text-gray-400 leading-snug bg-gray-50 rounded p-2">
                  ℹ️ {diagnosis.cpo_skip_reason}
                </p>
              )}
            </div>
          )
        )}
      </div>
    </div>
  )
}
