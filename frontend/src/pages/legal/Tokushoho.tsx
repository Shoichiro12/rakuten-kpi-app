import { LegalLayout, Field, PH } from '../../components/legal/LegalLayout'

/**
 * 特定商取引法に基づく表記（/legal/tokushoho）。
 *
 * ⚠️ これは雛形です。公開前に PH（黄色ハイライト）をすべて実データに置き換えること。
 * 「返品・キャンセルについて」は方針未確定のため空欄のまま残しています。
 * 法的な妥当性については必ずご自身または専門家の確認を挟んでください。
 *
 * 住所・電話番号について:
 *   個人事業主の場合、「請求があったら遅滞なく開示する」体制があれば
 *   常時掲載を省略できる場合があります（消費者庁の通達による運用）。
 *   ただし省略するなら、問い合わせを受けてすぐ開示できる状態が前提です。
 *   Stripe の審査では所在地・連絡先の確認を求められることがあるため、
 *   掲載する方が手続きは通りやすい傾向があります。
 */
export default function Tokushoho() {
  return (
    <LegalLayout title="特定商取引法に基づく表記" updatedAt="2026年7月27日">
      <dl>
        <Field label="サービス名">ウレシル</Field>

        <Field label="販売事業者">
          <PH>事業者の氏名（個人事業主のため、代表者名＝ご自身の本名を記載）</PH>
        </Field>

        <Field label="運営統括責任者">
          <PH>氏名</PH>
        </Field>

        <Field label="所在地">
          <PH>住所を記載</PH>
          <p className="text-xs text-gray-500 mt-1.5">
            個人事業主の場合、購入前の請求に遅滞なく応じられる体制があれば
            「ご請求いただいた場合には遅滞なく開示いたします」との表記で代替できる場合があります。
            省略する場合は、問い合わせフォーム等ですぐに開示できる体制を整えてください。
          </p>
        </Field>

        <Field label="電話番号">
          <PH>電話番号</PH>
          <p className="text-xs text-gray-500 mt-1.5">
            上記と同様の理由で開示請求方式にする場合はその旨を記載。
          </p>
        </Field>

        <Field label="メールアドレス">
          <PH>問い合わせ用メールアドレス</PH>
        </Field>

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

        <Field label="返品・キャンセルについて">
          <PH>返金・解約条件を記載（方針決定後に追記が必要）</PH>
          <p className="text-xs text-gray-500 mt-1.5">
            デジタルサービスのため、解約の受付方法（カスタマーポータルからいつでも解約可能か）、
            解約後の利用可能期間（当月末まで利用可能か即時停止か）、日割り返金の有無を明記する必要があります。
          </p>
        </Field>

        <Field label="動作環境">
          <PH>対応ブラウザ等</PH>
        </Field>
      </dl>
    </LegalLayout>
  )
}
