/**
 * GAP分析の4P改善アクション・ライブラリ（単一の真実）。
 *
 * 元は `ActionPanel.tsx` に直書きされていたものを、KPI選択に連動する
 * `KpiActionHint.tsx` からも引けるようにここへ切り出した（2026-08-04）。
 * **同じ打ち手の文言をコンポーネント側に書き足さないこと。** 追加はこのファイルに集約する。
 *
 * 既存の `key`（action_key）は保存済みチェック状態（`ActionLog`）との互換のため変更しない。
 *
 * ※ バックエンドの `matrix_actions.py`（`ACTION_LIBRARY`）とは役割が別。
 *   あちらは「店舗・期間の総合評価に対する要約アクション」、こちらは「4Pの具体タクティクス」。
 */

/** 課題の種類。KPIノードの `access` / `cvr` / `av` はそのまま同じキーを使う */
export type IssueType = 'access' | 'cvr' | 'av' | 'inventory'

export interface ActionDef {
  key: string
  category: 'Promotion' | 'Price' | 'Product' | 'Place' | '仕入れ'
  issue: IssueType[]
  text: string
  /** 具体的なタクティクスの補足（4P分析の実務例をもとに自社文言で作成）。 */
  detail?: string
}

// 4P改善アクション（要件No.10: 4P分析のタクティクスをカテゴリ別に網羅）。
export const ACTIONS: ActionDef[] = [
  // ── アクセス課題（Promotion） ─────────────────────────────
  { key: 'rpp_bid', category: 'Promotion', issue: ['access'], text: 'RPP広告のCPC・入札単価を見直す', detail: 'ROAS目標を下回る入札は下げ、伸びるキーワードへ予算を寄せる' },
  { key: 'seo_keyword', category: 'Promotion', issue: ['access'], text: '商品名・キャッチコピーにキーワードを追加（SEO対策）', detail: '検索需要の高い語・型番・用途語をタイトル前方に配置' },
  { key: 'search_rank', category: 'Promotion', issue: ['access'], text: '検索順位・流入キーワードを分析して対策', detail: '主要キーワードの表示順位を確認し、上位化の余地を探す' },
  { key: 'thumbnail', category: 'Promotion', issue: ['access'], text: 'CTRが低い場合：サムネイル・バナーを改善', detail: '1枚目画像の訴求・価格・特典表示で検索一覧のクリック率を上げる' },
  { key: 'coupon', category: 'Promotion', issue: ['access'], text: 'キャンペーン・クーポンでアクセスを増やす', detail: '目玉クーポンで集客し、回遊・併売につなげる' },
  { key: 'sale_event', category: 'Promotion', issue: ['access'], text: '楽天スーパーSALE・お買い物マラソンにエントリー', detail: 'イベント時の割引・買い回り需要でアクセスを集中的に獲得' },
  { key: 'rmp', category: 'Promotion', issue: ['access'], text: '楽天市場内の広告枠（RMP）を活用', detail: 'ディスプレイ広告・クーポンアドバンス等で露出を拡大' },
  { key: 'sns_external', category: 'Promotion', issue: ['access'], text: 'SNS・外部流入（Instagram/LINE等）を強化', detail: '楽天外からの送客でUUの母数自体を増やす' },

  // ── 転換率(CVR)課題（Price / Product / Place） ────────────
  { key: 'price_review', category: 'Price', issue: ['cvr'], text: '販売価格・クーポンを見直す', detail: '競合と並んだときに選ばれる実質価格になっているか確認' },
  { key: 'competitor_price', category: 'Price', issue: ['cvr'], text: '競合の価格・送料・ポイントを調査して対抗', detail: '実質価格（本体＋送料−ポイント）で比較し差を埋める' },
  { key: 'point_rate', category: 'Price', issue: ['cvr'], text: 'ポイント還元率（SPU・倍率）を上げる', detail: '期間限定ポイントで実質値引き感を出す' },
  { key: 'time_sale', category: 'Price', issue: ['cvr'], text: 'タイムセール・期間限定値引きで背中を押す', detail: '「今買う理由」を作り、離脱・カゴ落ちを減らす' },
  { key: 'lp_review', category: 'Product', issue: ['cvr'], text: '商品ページLP（ファーストビュー）を改善する', detail: 'ベネフィット・比較・購入ボタンを上部に集約し離脱を防ぐ' },
  { key: 'image_improve', category: 'Product', issue: ['cvr'], text: '商品説明・画像（サイズ/素材/使用シーン）を充実させる', detail: '不安要素を先回りで解消し、返品懸念を減らす' },
  { key: 'review_promo', category: 'Product', issue: ['cvr'], text: 'レビュー投稿を促進する（サンキューメール・特典）', detail: 'レビュー件数・評点は転換率と検索順位の両方に効く' },
  { key: 'faq', category: 'Product', issue: ['cvr'], text: 'よくある質問・不安要素の解消コンテンツを追加', detail: 'サイズ選び・使い方・保証などの疑問をページ内で解決' },
  { key: 'shipping', category: 'Place', issue: ['cvr'], text: '出荷リードタイム・送料を見直す', detail: '「あす楽」対応や送料無料化で購入ハードルを下げる' },
  { key: 'delivery_info', category: 'Place', issue: ['cvr'], text: '在庫表示・配送日時の表示を分かりやすくする', detail: '「いつ届くか」を明示し、離脱を防ぐ' },
  { key: 'payment', category: 'Place', issue: ['cvr'], text: '決済手段（後払い・分割等）を拡充する', detail: '希望する支払い方法が無いことによる離脱を防ぐ' },

  // ── 客単価(Av)課題（Product / Price） ─────────────────────
  { key: 'bundle', category: 'Product', issue: ['av'], text: 'セット販売・まとめ買いプランを作成', detail: '単品より1注文あたりの購入点数を増やす' },
  { key: 'cross_sell', category: 'Product', issue: ['av'], text: '関連商品のクロスセル導線を設定', detail: '併用品・消耗品をページ内・同梱提案で回遊させる' },
  { key: 'upsell', category: 'Product', issue: ['av'], text: '上位グレード・大容量へのアップセル導線', detail: '「少し上の商品」を並べて単価の底上げを狙う' },
  { key: 'subscription', category: 'Product', issue: ['av'], text: '定期購入・頒布会を設定する', detail: '継続購入でLTVと1回あたり単価を安定させる' },
  { key: 'bundle_price', category: 'Price', issue: ['av'], text: 'バンドル価格・セット割を見直す', detail: 'まとめ買いのお得感を明確にして点数増を促す' },
  { key: 'qty_discount', category: 'Price', issue: ['av'], text: 'まとめ買い割引（2個以上で〇%オフ）を設定', detail: '数量に応じた割引で1注文の金額を引き上げる' },
  { key: 'free_shipping', category: 'Price', issue: ['av'], text: '送料無料ラインを調整する', detail: '「あと〇円で送料無料」で客単価アップを誘導' },

  // ── 大前提：在庫なし（仕入れ・最優先） ───────────────────
  { key: 'restock', category: '仕入れ', issue: ['inventory'], text: '入荷スケジュールを見直す', detail: '売れ筋の欠品期間を最小化する' },
  { key: 'qty_adjust', category: '仕入れ', issue: ['inventory'], text: '仕入れ数量を調整する', detail: '販売ペースに対して発注量・タイミングを最適化' },
  { key: 'preorder', category: '仕入れ', issue: ['inventory'], text: '予約販売・入荷待ち登録で機会損失を防ぐ', detail: '在庫切れ中も需要を取りこぼさない' },
  { key: 'alt_product', category: '仕入れ', issue: ['inventory'], text: '代替商品への切り替え・誘導を検討', detail: '欠品品の受け皿となる類似商品を用意' },
  { key: 'pause_ads', category: '仕入れ', issue: ['inventory'], text: '在庫切れ商品の広告を一時停止する', detail: '買えない商品への広告費（無駄打ち）を止める' },
]

export const CATEGORY_COLOR: Record<string, string> = {
  Promotion: 'bg-blue-100 text-blue-700',
  Price: 'bg-green-100 text-green-700',
  Product: 'bg-purple-100 text-purple-700',
  Place: 'bg-orange-100 text-orange-700',
  '仕入れ': 'bg-red-100 text-red-700',
}

export const ISSUE_LABEL: Record<IssueType, string> = {
  access: 'アクセス不足',
  cvr: '転換率低下',
  av: '客単価低下',
  inventory: '在庫なし',
}

/** 該当課題の打ち手を取り出す（表示順＝配列順） */
export function actionsForIssue(issue: IssueType): ActionDef[] {
  return ACTIONS.filter((a) => a.issue.includes(issue))
}
