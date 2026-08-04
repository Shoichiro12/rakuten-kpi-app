import { useEffect, useState, useCallback } from 'react'
import { CreditCard, Check, ExternalLink, Sparkles, AlertTriangle } from 'lucide-react'
import { LEGAL_LINKS, EXTERNAL_LINK_PROPS } from '../lib/links'
import Header from '../components/layout/Header'
import ConsultingInquiryForm from '../components/ConsultingInquiryForm'
import { requestOpenFeedback } from '../components/FeedbackModal'
import { api } from '../lib/api'
import { formatCount } from '../lib/format'
import type { BillingStatus, BillingPlan, BillingDiagnosis } from '../types'

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
  // Stripe鍵のモード（false=テストのときだけ「4242…で登録できます」を表示する。
  // true=本番 / null・undefined=未設定や取得前は出さない。本番でテスト用文言を
  // 見せると実カードを求められた顧客が混乱するため）
  const [livemode, setLivemode] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [showInquiry, setShowInquiry] = useState(false)
  const [diag, setDiag] = useState<BillingDiagnosis | null>(null)

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
      setLivemode(pl.livemode ?? null)
    } catch (e) {
      console.error('[Billing] 取得エラー:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Checkout完了で戻った直後（?session_id=…）は、まず契約状態を確定してから表示を更新する。
    const sid = new URLSearchParams(window.location.search).get('session_id')
    if (sid) {
      // 同期に失敗したまま黙ってプラン選択画面に戻ると「登録したのにサブスクに
      // なっていない」ように見えてしまう。失敗は必ず画面に出す。
      api.billing
        .confirm(sid)
        .catch((e) => {
          console.error('[Billing] confirmエラー:', e)
          setMsg(
            'Stripeでの登録は完了していますが、アプリ側への反映に失敗しました。'
            + '「最新の状態に更新」を押すか、時間をおいて再読み込みしてください。',
          )
        })
        .finally(() => load())
    } else {
      load()
    }
  }, [load])

  const subscribe = async () => {
    setBusy('checkout')
    setMsg(null)
    try {
      const res = await api.billing.checkout()
      if (res?.url) window.location.href = res.url
      else setMsg('Checkoutの作成に失敗しました。')
    } catch (e) {
      // Stripeが返す理由（Priceがアーカイブ済み・price IDが存在しない等）を隠さず出す。
      // 固定文言に潰すと「キーの問題」と誤誘導して原因究明が遅れる。
      console.error('[Billing] checkoutエラー:', e)
      const detail = e instanceof Error ? e.message : String(e)
      setMsg(`Checkoutの作成に失敗しました。${detail}`)
    } finally {
      setBusy(null)
    }
  }

  const runDiagnose = async () => {
    setBusy('diagnose')
    setMsg(null)
    try {
      setDiag(await api.billing.diagnose())
    } catch (e) {
      console.error('[Billing] diagnoseエラー:', e)
      setMsg('診断の実行に失敗しました。')
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
  // プランは単一。/billing/plans は price ID 設定済みのものだけ返すので実質0〜1件。
  const plan: BillingPlan | undefined = plans[0]

  return (
    <div className="flex flex-col h-full">
      <Header title="請求・プラン" subtitle={active ? '契約中' : 'ご利用プランのご案内'} />

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

          {/* 支払い失敗（past_due/unpaid）: 「未契約」と見せない。
              何が起きたか分からないままプラン選択カードが出るのが最悪のUXなので、
              専用の案内＋カスタマーポータルへの導線を最上部に出す。
              Stripeのスマートリトライが自動で再試行するため、利用者にやってもらうのは
              カード情報の確認・更新だけ。 */}
          {status && (status.status === 'past_due' || status.status === 'unpaid') && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={18} className="text-red-600" />
                <h3 className="text-sm font-semibold text-red-800">お支払いの確認が取れていません</h3>
              </div>
              <p className="text-sm text-red-700 mb-4">
                ご登録のカードでの決済に失敗しました。ご契約は解約されていません。
                お支払い方法をご確認・更新いただくと、自動的に再決済されます。
              </p>
              <button
                onClick={openPortal}
                disabled={busy === 'portal'}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <ExternalLink size={15} /> お支払い方法を確認・更新する
              </button>
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
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={openPortal}
                  disabled={busy === 'portal'}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <ExternalLink size={15} /> お支払い方法の変更
                </button>
                <button
                  onClick={async () => {
                    setBusy('refresh')
                    try { await api.billing.refresh(); await load(); setMsg(null) }
                    catch { setMsg('最新状態の取得に失敗しました。') }
                    finally { setBusy(null) }
                  }}
                  disabled={busy === 'refresh'}
                  className="flex items-center gap-1.5 px-3 py-2 border text-gray-600 hover:bg-gray-50 disabled:opacity-60 text-sm rounded-lg transition-colors"
                  title="Stripeの最新状態を取り直します"
                >
                  {busy === 'refresh' ? '更新中…' : '最新の状態に更新'}
                </button>
              </div>
              {/* ポータルの自己解約は意図的に無効化している（Stripeダッシュボード側の設定）。
                  解約は下の「解約をご希望の場合」セクション＝問い合わせ経由で受け付ける。
                  「解約ボタンがない」は不具合ではない（CLAUDE.md 申し送り参照）。 */}
              <p className="text-xs text-gray-400 mt-2">Stripeのカスタマーポータルでお支払い方法の変更・ご契約内容の確認ができます。</p>
            </div>
          )}

          {/* 解約の導線: ポータルではなく問い合わせ経由（受付後2〜3営業日以内に手続き完了）。
              特商法ページ・利用規約第5条の記載と文言を整合させること。 */}
          {active && status && (
            <div className="bg-white rounded-xl border shadow-sm p-6">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">解約をご希望の場合</h3>
              <p className="text-xs text-gray-500 mb-4">
                解約のお手続きは、下記フォームよりご連絡いただいてから2〜3営業日以内に完了します。
                手続き完了まで、現在の請求期間内は引き続きサービスをご利用いただけます。
              </p>
              <button
                onClick={() => requestOpenFeedback('cancel')}
                className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium rounded-lg transition-colors"
              >
                解約について問い合わせる
              </button>
            </div>
          )}

          {/* 未契約: プランカード（プランは1つだけ）。
              past_due/unpaid は「未契約」ではなく支払いトラブルなので、
              新規登録カードは出さない（上の専用案内だけにする） */}
          {!active && status?.enabled &&
            status.status !== 'past_due' && status.status !== 'unpaid' && (
            <div className="bg-white rounded-xl border shadow-sm p-6">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-base font-bold text-gray-900">{plan?.label ?? 'ウレシル 月額プラン'}</h3>
                <span className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-blue-100 text-blue-700">
                  {trialDays}日間無料
                </span>
              </div>
              {/* 総額表示義務のため、税込金額を主表記から外さない。
                  税抜・税込は同じ文字サイズ・同じ視認性で並列表示する。 */}
              <p className="text-xl sm:text-2xl font-bold text-gray-900 mb-1">
                月額 {plan?.price_label ?? '¥20,000（税抜） / ¥22,000（税込）'}
              </p>
              <p className="text-xs text-gray-500 mb-4">
                {trialDays}日間の無料トライアル付き。トライアル中に解約すれば料金はかかりません。
                機能制限はなく、すべての分析機能をご利用いただけます。
              </p>
              <button
                onClick={subscribe}
                disabled={busy === 'checkout'}
                className="flex items-center justify-center gap-2 w-full sm:w-auto px-5 py-2.5 bg-rakuten-red hover:opacity-90 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-opacity"
              >
                {busy === 'checkout' ? '準備中…' : `${trialDays}日間の無料トライアルを始める`}
              </button>
              {/* 購入手続きに入る前に、価格・支払条件・解約条件へ到達できるようにする
                  （特定商取引法の要請。Stripeの審査でも確認される）。
                  リンク先はLP側。アプリ内に法的ページは持たない（lib/links.ts 参照） */}
              <p className="text-xs text-gray-500 mt-3">
                お申し込みの前に{' '}
                <a href={LEGAL_LINKS.tokushoho} {...EXTERNAL_LINK_PROPS} className="text-blue-600 hover:underline">特定商取引法に基づく表記</a>
                {' '}と{' '}
                <a href={LEGAL_LINKS.terms} {...EXTERNAL_LINK_PROPS} className="text-blue-600 hover:underline">利用規約</a>
                {' '}をご確認ください。
              </p>
              <p className="text-xs text-gray-400 mt-2">
                決済は Stripe の安全な画面で行われます。
                {livemode === false && ' テストモードでは番号 4242 4242 4242 4242（有効期限は未来・任意のCVV）で登録できます。'}
              </p>
            </div>
          )}

          {/* コンサル: アプリの課金には乗せず、個別契約（問い合わせ→ヒアリング→見積り） */}
          {showInquiry ? (
            <ConsultingInquiryForm onClose={() => setShowInquiry(false)} />
          ) : (
            <div className="bg-white rounded-xl border shadow-sm p-5 flex flex-col sm:flex-row sm:items-center gap-3">
              <Sparkles size={18} className="text-amber-500 shrink-0" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-gray-800">運用まで一緒にやってほしい方へ</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  ECコンサルは個別契約です。店舗の規模・課題をお聞きしてお見積りをご提示します（¥150,000〜）。
                </p>
              </div>
              <button
                onClick={() => setShowInquiry(true)}
                className="px-4 py-2 border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
              >
                コンサルをご希望の方はこちら
              </button>
            </div>
          )}

          {/* 設定診断: Priceが月次か、トライアルが付いているか、DBとStripeが一致しているかを
              まとめて確認する。「サブスクになっていない気がする」の切り分け用。 */}
          {status?.enabled && (
            <div className="bg-white rounded-xl border shadow-sm p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">課金設定の診断</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Priceが月次か・トライアルが付いているか・Stripeとアプリの状態が一致しているかを確認します。
                  </p>
                </div>
                <button
                  onClick={runDiagnose}
                  disabled={busy === 'diagnose'}
                  className="px-3 py-2 border text-gray-600 hover:bg-gray-50 disabled:opacity-60 text-sm rounded-lg transition-colors whitespace-nowrap"
                >
                  {busy === 'diagnose' ? '診断中…' : '診断する'}
                </button>
              </div>

              {diag && (
                <div className="mt-4 space-y-3">
                  <ul className="space-y-1.5">
                    {diag.checks.map((c, i) => (
                      <li
                        key={i}
                        className={`text-xs rounded px-2.5 py-1.5 border ${
                          c.level === 'error'
                            ? 'bg-red-50 border-red-200 text-red-700'
                            : c.level === 'warn'
                              ? 'bg-amber-50 border-amber-200 text-amber-700'
                              : 'bg-green-50 border-green-200 text-green-700'
                        }`}
                      >
                        {c.message}
                      </li>
                    ))}
                  </ul>
                  <div className="grid sm:grid-cols-2 gap-2 text-xs">
                    <div className="bg-gray-50 rounded p-2.5">
                      <p className="text-gray-500 mb-1">設定</p>
                      <p className="text-gray-800">トライアル: {diag.config.trial_days}日</p>
                      <p className="text-gray-800 break-all">Price: {diag.config.price_id ?? '—'}</p>
                      <p className="text-gray-800">
                        モード: {diag.config.key_livemode == null ? '—' : diag.config.key_livemode ? '本番' : 'テスト'}
                      </p>
                    </div>
                    <div className="bg-gray-50 rounded p-2.5">
                      <p className="text-gray-500 mb-1">Stripe側のPrice</p>
                      <p className="text-gray-800">
                        種別: {diag.price?.recurring ? `継続（${diag.price.recurring.interval}）` : diag.price ? '一括（one_time）' : '—'}
                      </p>
                      <p className="text-gray-800">
                        {/* 円は zero-decimal currency なので unit_amount がそのまま円額。
                            外税(exclusive)なら unit_amount は税抜なので明示する。

                            桁区切りは format.ts の formatCount に寄せた（区切り5）。
                            **`¥` の前置と丸めなしは変えないこと。** この画面の主表記である月額は
                            バックエンドの `PLAN_AMOUNT_LABEL`（env で上書き可能）が
                            「¥20,000（税抜） / ¥22,000（税込）」の完成した文字列を返すため、
                            ここだけ `formatYen` の「円」後置や万・億の丸めにすると
                            同じ画面で金額の書き方が食い違う。契約金額は正確な値を出す場所でもある。 */}
                        金額: {diag.price?.unit_amount != null
                          ? diag.price.currency === 'jpy'
                            ? `¥${formatCount(diag.price.unit_amount)}${
                                diag.price.tax_behavior === 'exclusive' ? '（税抜・外税）'
                                : diag.price.tax_behavior === 'inclusive' ? '（税込・内税）'
                                : ''}`
                            : `${formatCount(diag.price.unit_amount)} ${diag.price.currency}`
                          : '—'}
                      </p>
                      <p className="text-gray-800">
                        消費税の内訳: {diag.tax_rate
                          ? `${diag.tax_rate.percentage}%${diag.tax_rate.inclusive ? '・内税' : '・外税'}`
                          : '税率未設定'}
                      </p>
                      <p className="text-gray-800">
                        自動税計算(Stripe Tax): {diag.subscription?.automatic_tax_enabled == null
                          ? '—'
                          : diag.subscription.automatic_tax_enabled ? '有効' : '無効'}
                      </p>
                      <p className="text-gray-800">契約: {diag.subscription?.status ?? '未契約'}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {loading && !status && <p className="text-sm text-gray-400">読み込み中…</p>}
        </div>
      </div>
    </div>
  )
}
