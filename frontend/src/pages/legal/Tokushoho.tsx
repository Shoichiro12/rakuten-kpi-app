import { LegalLayout, Field, BUSINESS, REFUND_POLICY_TEXT } from '../../components/legal/LegalLayout'

/**
 * 特定商取引法に基づく表記（/legal/tokushoho）。
 *
 * 事業者情報・返金条件は `LegalLayout.tsx` の BUSINESS / REFUND_POLICY_TEXT から参照する。
 * 返金・解約条件は利用規約 第5条にも同じ内容が必要なので、2箇所に書き写さず定数を共有する。
 *
 * 所在地について:
 *   個人事業主のため「請求があれば遅滞なく開示する」方式を採用している
 *   （消費者庁の運用で認められる代替表記）。この方式を採る以上、開示請求が来たら
 *   遅滞なく応じる必要がある。メールを放置しないこと。
 *
 * 法的な妥当性については専門家の確認を前提とする。
 */
export default function Tokushoho() {
  return (
    <LegalLayout title="特定商取引法に基づく表記" updatedAt="2026年7月28日">
      <dl>
        <Field label="サービス名">ウレシル</Field>

        <Field label="販売事業者">{BUSINESS.name}</Field>

        <Field label="運営統括責任者">{BUSINESS.name}</Field>

        <Field label="所在地">{BUSINESS.address}</Field>

        <Field label="電話番号">{BUSINESS.phone}</Field>

        <Field label="メールアドレス">{BUSINESS.email}</Field>

        {/* 総額表示義務のため税込金額を必ず併記する。税抜のみの表記にしないこと。
            価格の記載箇所は backend/billing.py の PLAN_AMOUNT_LABEL・このページ・
            利用規約 第3条 の3箇所。改定時はStripeのpriceと合わせて全部直す。 */}
        <Field label="販売価格">月額 ¥20,000（税抜） / ¥22,000（税込）</Field>

        <Field label="商品代金以外に必要な料金">
          特になし（お支払いいただく総額は上記の税込金額です）
        </Field>

        <Field label="お支払い方法">クレジットカード決済（Stripe）</Field>

        <Field label="お支払い時期">
          初回登録時（14日間の無料トライアル終了後に課金開始）、以降毎月自動更新
        </Field>

        <Field label="サービス提供時期">決済完了後、即時ご利用いただけます</Field>

        {/* 利用規約 第5条と同じ文言。定数を共有しているのでズレない */}
        <Field label="返品・キャンセルについて">{REFUND_POLICY_TEXT}</Field>

        <Field label="動作環境">
          最新版のGoogle Chrome、Microsoft Edge、Safariでのご利用を推奨します。
        </Field>
      </dl>
    </LegalLayout>
  )
}
