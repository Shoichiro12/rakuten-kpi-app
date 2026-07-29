import { LegalLayout, Section, Bullets, BUSINESS } from '../../components/legal/LegalLayout'

/**
 * プライバシーポリシー（/legal/privacy）。
 *
 * 事業者情報は `LegalLayout.tsx` の BUSINESS から参照する。
 * 新しく個人情報を扱う機能を追加したときは「2. 取得する情報」の更新が必要。
 * 「5. データの保存期間・退会時の取り扱い」で問い合わせ記録を退会後も保持すると
 * 明記しており、退会処理（routers/account.py の _ALL_MODELS）で
 * ConsultingInquiry を削除対象にしていないのはこの記載に合わせている。
 */
export default function Privacy() {
  return (
    <LegalLayout title="プライバシーポリシー" updatedAt="2026年7月28日">
      <p className="text-sm text-gray-700 leading-relaxed">
        ウレシル（以下「本サービス」）における個人情報およびお客様データの取り扱いについて、
        以下のとおり定めます。
      </p>

      <Section title="1. 事業者情報">
        <p>
          {BUSINESS.name}（連絡先: {BUSINESS.email}）
        </p>
      </Section>

      <Section title="2. 取得する情報">
        <Bullets
          items={[
            'アカウント情報（メールアドレス等）',
            '決済情報（Stripeを通じて処理します。カード番号自体を当方で保持することはありません）',
            'お客様が取込む売上・アクセスデータ（RPP広告レポート・月次商品分析等）',
            'コンサルティングサービスへのお問い合わせ内容（お名前・会社名・連絡先・ご相談内容）',
          ]}
        />
      </Section>

      <Section title="3. 利用目的">
        <Bullets
          items={[
            '本サービスの提供・維持・改善',
            'お問い合わせ・コンサルティングサービスに関するご連絡',
            '利用規約または法令に違反する行為への対応',
          ]}
        />
      </Section>

      <Section title="4. 第三者提供">
        <p>
          決済処理のため Stripe、データ保存のため Supabase 等の外部サービスを利用しており、
          必要な範囲でこれらの事業者に情報を提供します。
        </p>
        <p>
          上記のほか、法令に基づく開示請求があった場合を除き、
          お客様の同意なく第三者へ個人情報を提供することはありません。
        </p>
      </Section>

      <Section title="5. データの保存期間・退会時の取り扱い">
        <p>
          退会時、アカウントに紐づく分析データ等は削除します。
          ただし、以下は退会後も保持する場合があります。
        </p>
        <Bullets
          items={[
            '決済・契約に関する記録（会計・税務上の記録として）',
            'コンサルティングサービスへのお問い合わせ記録（営業記録として）',
          ]}
        />
      </Section>

      <Section title="6. セキュリティ">
        <p>
          お客様のデータはユーザー単位で分離して保存し、他のお客様から参照できないよう
          アクセス制御を行っています。通信はすべて暗号化（HTTPS）しています。
        </p>
      </Section>

      <Section title="7. お問い合わせ窓口">
        <p>
          本ポリシーおよび個人情報の取り扱いに関するお問い合わせ先: {BUSINESS.email}
        </p>
      </Section>

      <Section title="8. 本ポリシーの変更">
        <p>
          法令の変更やサービス内容の変更に応じて本ポリシーを改定する場合があります。
          重要な変更を行う場合は、本サービス上でお知らせします。
        </p>
      </Section>
    </LegalLayout>
  )
}
