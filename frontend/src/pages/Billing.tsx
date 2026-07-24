import { useEffect, useState, useCallback } from 'react'
import { CreditCard, Check, ExternalLink, Sparkles, AlertTriangle } from 'lucide-react'
import Header from '../components/layout/Header'
import { api } from '../lib/api'
import type { BillingStatus, BillingPlan } from '../types'

const STATUS_LABEL: Record<string, string> = {
  trialing: 'トライアル中',
  active: '有効',
  past_due: '支払い遅延',
  canceled: '解約済み',
  incomplete: '手続き未完了',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}

export default function Billing() {
  const [status, setStatus] = useState<BillingStatus | null>(null)
  const [plans, setPlans] = useState<BillingPlan[]>([])
  const [trialDays, setTrialDays] = useState(14)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  // ?checkout=success / cancel の戻り表示
  const params = new URLSearchParams(window.location.search)
  const checkoutResult = params.get('checkout')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [st, pl] = await Promise.all([api.billing.status(), api.billing.plans()])
      setStatus(st)
      setPlans(pl.plans)
      setTrialDays(pl.trial_days)
    } catch (e) {
      console.error('[Billing] 取得エラー:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const subscribe = async (plan: string) => {
    setBusy(plan)
    setMsg(null)
    try {
      const res = await api.billing.checkout(plan as 'standard' | 'consult')
      if (res?.url) window.location.href = res.url
      else setMsg('Checkoutの作成に失敗しました。')
    } catch (e) {
      console.error('[Billing] checkoutエラー:', e)
      setMsg('Checkoutの作成に失敗しました。Stripeキーの設定を確認してください。')
    } finally {
      setBusy(null)
    }
  }

  const openPortal = async () => {
    setBusy('portal')
    try {
      const res = await api.billing.portal()
      if (res?.url) window.location.href = res.url
    } catch (e) {
      console.error('[Billing] portalエラー:', e)
      setMsg('カスタマーポータルを開けませんでした。')
    } finally {
      setBusy(null)
    }
  }

  const active = status?.is_active

  return (
    <div className="flex flex-col h-full">
      <Header title="請求・プラン" subtitle={active ? '契約中' : 'プランを選んでください'} />

      <div className="flex-1 overflow-auto p-6 bg-gray-50">
        <div className="max-w-3xl mx-auto space-y-5">
          {checkoutResult === 'success' && (
            <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg px-4 py-3 flex items-center gap-2">
              <Check size={16} /> 登録手続きが完了しました。反映まで数秒かかる場合があります。
            </div>
          )}
          {checkoutResult === 'cancel' && (
            <div className="bg-gray-50 border text-gray-600 text-sm rounded-lg px-4 py-3">
              登録はキャンセルされました。
            </div>
          )}
          {msg && (
            <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg px-4 py-3">{msg}</div>
          )}

          {status && !status.enabled && (
            <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg px-4 py-3 flex items-start gap-2">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>Stripeがまだ設定されていません。テスト用の各キーを <code className="bg-white/60 px-1 rounded">backend/.env</code> に設定してバックエンドを再起動してください。</span>
            </div>
          )}

          {/* 契約中: 現在の状態＋ポータル */}
          {active && status && (
            <div className="bg-white rounded-xl border shadow-sm p-6">
              <div className="flex items-center gap-2 mb-3">
                <CreditCard size={18} className="text-blue-600" />
                <h3 className="text-sm font-semibold text-gray-800">現在のご契約</h3>
                <span className="ml-1 text-[11px] px-1.5 py-0.5 rounded font-medium bg-green-100 text-green-700">
                  {STATUS_LABEL[status.status ?? ''] ?? status.status}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <div className="bg-gray-50 rounded p-3">
                  <p className="text-xs text-gray-500">プラン</p>
                  <p className="font-semibold text-gray-900">{status.plan_label ?? status.plan ?? '—'}</p>
                </div>
                <div className="bg-gray-50 rounded p-3">
                  <p className="text-xs text-gray-500">{status.status === 'trialing' ? 'トライアル終了' : '次回更新'}</p>
                  <p className="font-semibold text-gray-900">
                    {fmtDate(status.status === 'trialing' ? status.trial_end : status.current_period_end)}
                  </p>
                </div>
              </div>
              <button
                onClick={openPortal}
                disabled={busy === 'portal'}
                className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <ExternalLink size={15} /> プラン・支払い方法を管理する
              </button>
              <p className="text-xs text-gray-400 mt-2">Stripeのカスタマーポータルで支払い方法の変更・プラン変更・解約ができます。</p>
            </div>
          )}

          {/* 未契約: プランカード */}
          {!active && status?.enabled && (
            <>
              <p className="text-sm text-gray-500">
                すべてのプランに<span className="font-semibold text-gray-700">{trialDays}日間の無料トライアル</span>が付きます。トライアル中の解約で料金はかかりません。
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                {plans.map((p) => (
                  <div key={p.plan} className="bg-white rounded-xl border shadow-sm p-5 flex flex-col">
                    <div className="flex items-center gap-2 mb-1">
                      {p.plan === 'consult' && <Sparkles size={16} className="text-amber-500" />}
                      <h3 className="text-base font-bold text-gray-900">{p.label}</h3>
                    </div>
                    <span className="inline-flex w-fit items-center text-[11px] px-1.5 py-0.5 rounded font-medium bg-blue-100 text-blue-700 mb-3">
                      {trialDays}日間無料
                    </span>
                    <p className="text-xs text-gray-500 mb-4 flex-1">
                      料金・詳細は次の決済画面（Stripe）で確認できます。
                    </p>
                    <button
                      onClick={() => subscribe(p.plan)}
                      disabled={busy === p.plan}
                      className="flex items-center justify-center gap-2 px-4 py-2 bg-rakuten-red hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-opacity"
                    >
                      {busy === p.plan ? '準備中…' : 'このプランで始める'}
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-400">
                決済は Stripe の安全な画面で行われます。テストモードでは番号 4242 4242 4242 4242（有効期限は未来・任意のCVV）で登録できます。
              </p>
            </>
          )}

          {loading && !status && <p className="text-sm text-gray-400">読み込み中…</p>}
        </div>
      </div>
    </div>
  )
}
