# ウレシル LP（ランディングページ）

`https://ureshiru.com`（Cloudflare Pages）として公開している静的サイトのソース。

## なぜここにあるか

**このLPは「Stripeにビジネスウェブサイトとして登録しているサイト」で、
Stripeの審査担当者が見るのもここ。** アプリ本体（`rakuten-kpi-app.onrender.com`）は
ログイン必須で事業内容が確認できないため、公開情報はすべてこちら側に置く。

### 経緯（2026-07-29 に判明）

もともとこのLPは**どこにもソースが保存されていなかった**。
過去のセッションで生成してVercelへ直接アップロードしただけで、
GitHubリポジトリもローカルフォルダも存在しない状態だった。
デプロイ済みのファイルだけが唯一の正、という危険な状態だったため、
ここに回収して git 管理下に置いた。

## 構成

自己完結した静的HTML。ビルド不要、外部依存なし。

```
lp/
├── index.html        トップ（CSSはインライン。トークンの単一の真実はここの :root）
├── about.html        私たちについて（style.css + C案トーンの上書き）
├── help.html         ヘルプ・使い方ガイド（同上）
├── tokushoho.html    特定商取引法に基づく表記
├── privacy.html      プライバシーポリシー
├── terms.html        利用規約
├── style.css         下層ページ用のスタイル（index.html は使わない）
├── shot-hero.jpg     トップのヒーローで使う実画面
└── shot-1〜5-*.jpg   工程画像。掲載は主役工程の 2.0・4.0 のみ（2026-08-20 の強弱決定）。1/3/5 はファイルのみ保持
```

`about.html` には**顔写真・実名・会社名を載せない**（匿名性を保つ・2026-08-09 オーナー決定）。
JSON-LD の `Person` も意図的に入れていない。
※ 実名そのものは特商法・プライバシーポリシー・`index.html` の JSON-LD で開示済み
（法令上の要請）。匿名なのは about.html の中だけ。

## 守ること

### 1. 法的文書の正はここ。アプリ側に作らない

特商法・プライバシーポリシー・利用規約は**このLPにだけ**置く。
アプリ側（`frontend/`）は `src/lib/links.ts` の `LEGAL_LINKS` から外部リンクで飛ばす。

一度アプリ内にも同じページを作ってしまい、価格改定で
**LP: ¥19,800 / アプリ: ¥22,000** と食い違う状態を招いた。
文書が2箇所にあると必ずズレるので、二度と複製しないこと。

### 2. 価格を変えるときはここも直す

価格の記載箇所（アプリとLPにまたがる）:

| 場所 | 何を直すか |
|---|---|
| `lp/index.html` | 料金セクション |
| `lp/tokushoho.html` | 販売価格 |
| `lp/terms.html` | 利用料金・解約条件 |
| `backend/billing.py` | `PLAN_AMOUNT_LABEL` / `PLAN_AMOUNT_JPY` / `PLAN_AMOUNT_EXCL_TAX_JPY` |
| Stripe | price の `unit_amount`、税率 |

**総額表示義務があるので税込金額を主表記から外さない。**
表記は「月額 ¥20,000（税抜） / ¥22,000（税込）」で全箇所統一する。

### 3. 返金・解約条件は特商法と利用規約の両方に同じ文言で載せる

片方だけ直すと食い違う。改定時は必ず2ファイルとも直す。

## デプロイ（2026-07-29 に Cloudflare Pages へ移行済み）

**`git push` するだけで自動デプロイされる。** 手動アップロードは不要。

- ホスティング: Cloudflare Pages（プロジェクト名 `ureshiru-lp`、Root Directory=`lp`、ビルドなし）
- 本番ドメイン: `https://ureshiru.com`（Cloudflare DNS・SSL自動）
- プレビュー: `https://ureshiru-lp.pages.dev`
- 拡張子なしURL（`/tokushoho` 等）はPagesが標準で解決する（vercel.json は不要になったため削除済み）
- Vercel の旧プロジェクト（ureshiru.vercel.app）は Stripe審査完了までは残す。
  審査完了後に Stripe の「ビジネスウェブサイト」を ureshiru.com へ変更し、Vercel側を削除する
