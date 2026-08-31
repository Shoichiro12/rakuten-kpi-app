# 実装計画: LPリニューアル（デザイン案2a確定版の実装）2026-08-31

対象: `lp/index.html`（＋共通chrome分は `lp/style.css`）
位置づけ: コードを書く前のすり合わせ用。オーナー決定を先に記録し、承認後に実装へ進む（CLAUDE.md ルール4）。
デザイン仕様: Claude Design 出力 `LP Variations.dc.html` の **2a（静置ヒーロー 1b′）**。1a・1b・1c および v1〜v4 は廃案。

---

## 0. オーナー決定（この計画の前提）

| # | 決定 | 日付 |
|---|---|---|
| 1 | リニューアルは**レイアウトと見せ方のみ**。新規制作物なし（資料PDF・デモ格上げ・ミニ試算ツール・事例の追加取材はすべて無し） | 08-30 |
| 2 | 現行LP（ureshiru.com）の**構成・コピー・価格文言・事例・「開発者から」・FAQは1文字も変えない** | 08-31 |
| 3 | **深掘りシミュレーション（ヒーロー内KGIカード）は現行のHTML/JSをそのまま移植**。触るのは外側の枠・余白のみ | 08-31 |
| 4 | 背景は白。ヘッダー・フッターは墨色（#2e2d29）で塗りつぶし | 08-31 |
| 5 | フォントはSTOCKCREW実測に合わせる: `Figtree, "Noto Sans JP", sans-serif`／`palt`／見出し700。ワードマーク「ウレシル。」のみ Zen Maru Gothic 700 維持（08-20決定の継承） | 08-31 |
| 6 | 3案のうち**1bを採用**。セクションの通し番号（01〜06）は外し、事例末尾に軽い再CTAを追加した2aを確定版とする | 08-31 |
| 7 | 実績数値の捏造禁止は継続。事実バッジは「初期費用0円／14日間無料トライアル／API連携不要・CSVを放り込むだけ」の3つのみ | 08-30 |
| 8 | 下層ページ（about / help / 法的3ページ）のヘッダー・フッターもトップと同じ墨色chromeに揃える（`lp/style.css` を修正） | 08-31 |
| 9 | 料金セクション末尾のCTAはボタンのまま（テキストリンクに軽くしない） | 08-31 |
| 10 | `lp/README.md` の「外部依存なし」を「外部依存は Google Fonts のみ」に更新する。フォントのセルフホストは今回やらない | 08-31 |

## 1. 変更内容（セクション別）

| セクション | 現行 | 2aでの変更 |
|---|---|---|
| ヘッダー | 白背景・ワードマーク＋CTA | 墨色塗りつぶし。ワードマーク白、CTAは白地に墨文字で反転。sticky維持。構成（リンクなし・CTA1つ）は現行のまま |
| ヒーロー | h1＋シミュレーション（単カラム） | 単カラム維持。h1直下に**罫区切りテキスト型の事実バッジ3つ**を追加。シミュレーションは**薄面（#fafaf9）のフルブリード帯**に静置。h1は44px/700/字間-0.03em/行送り1.5（デザインファイル2aの値が正。v4の1.4は破棄） |
| シミュレーション本体 | 現行 | **無変更**（DOM・class・id・JS・数値・文言すべて据え置き。外側のラッパーのみ差し替え） |
| 3クリックの説明文 | 段落3つ | 1段落目を大きく（23px/700）、以降は通常。文末に再CTA（ボタン＋無料デモのテキストリンク） |
| Record／Setup | h2＋p 縦積み | 英字ラベル＋左寄せh2の2層。2カラム（1fr 1fr）横並び。薄面帯 |
| Case（導入事例） | 見出し＋事実列 | 4:7の2カラム。右にカード（ROAS 200%台→300%以上を主役）＋注記。**末尾に再CTAテキストリンク**（2aで追加） |
| Pricing | 価格＋説明＋ボタン | 5:6の2カラム。左に価格「¥22,000（税込）/ 月」＋「プランはこれだけ」、右に「1日あたり¥733」の引用面＋CTAボタン。文言据え置き |
| From the developer | h2＋文＋署名 | 英字ラベル追加、blockquote化。文面据え置き |
| CTA | 見出し＋ボタン | 墨色帯（現行踏襲）。「来週の月曜から、どうぞ。」＋ボタン＋無料デモ注記 |
| FAQ | 5件 | 4:7の2カラム、アコーディオン（details/summary）。文言据え置き |
| フッター | 墨色・タグライン＋リンク | 塗りつぶし維持。タグライン行＋リンク1行＋©。4カラム化しない |

### 1-1. デザイントークン（`lp/index.html` の `:root` を置換）

```
--paper #ffffff / --bg-alt #fafaf9 / --line #e6e4df
--ink #383731 / --ink-strong #2e2d29 / --sub #504b42 / --muted #6b6559
--sage #78927b（装飾のみ）/ --sage-soft #eef2ec / --sage-deep #4c6850
--alert #c2382f / --alert-soft #fbeeec / --up #17714d
--font-body / --font-display / --font-num: "Figtree", "Noto Sans JP", sans-serif
--font-wordmark: "Zen Maru Gothic", sans-serif
body { font-feature-settings: "palt" }
```

生成り（#fdfcf9 / #f4f1ea / #e5dfd4）は廃止。既存のインラインstyle・生hexは `var()` 参照へ寄せる（07-30監査major「トークン規律」の解消を兼ねる）。

### 1-2. フォント読み込み

Google Fonts: `Figtree:wght@400;500;600;700` ＋ `Noto+Sans+JP:wght@400;500;700` ＋ `Zen+Maru+Gothic:wght@700`、`display=swap`、`preconnect` 2本。
現行の Zen Kaku Gothic New の読み込みは削除。

### 1-3. 触らないもの（差分ゼロを保証する箇所）

- 価格表記・特商法／利用規約／プライバシーの3ページ・JSON-LD・canonical/OGP
- シミュレーションのHTML/JS本体、`shot-hero.jpg`（OGP画像として継続使用）
- CTAリンク先（`app.ureshiru.com/billing?signup=1`）・mailto（Cloudflareのemail-protection経由のまま）
- `lp/README.md` の運用ルール

## 2. 実装手順

1. 作業ブランチ `lp/renewal-2a` を切る（mainはCloudflare Pages自動デプロイのため**直接pushしない**）
2. `lp/index.html` の `<style>` をトークン置換 → セクション骨格を2aの順で組み替え → シミュレーションのブロックはコピーせず**移動**（差分で本体無変更を証明できるようにする）
3. 事実バッジ・事例末尾の再CTA・英字ラベルを追加
4. `lp/style.css`（下層ページ用）のヘッダー・フッターを同じ墨色chromeに揃え、about / help / tokushoho / privacy / terms の5ページで表示確認
4-2. `lp/README.md` の「外部依存なし」を「外部依存は Google Fonts のみ（Figtree / Noto Sans JP / Zen Maru Gothic）」に更新
5. Cloudflare Pages の**ブランチプレビュー**（`lp-renewal-2a.ureshiru-lp.pages.dev` 相当）で検証
6. オーナー確認 → mainへマージ → 本番反映を目視
7. 本番で崩れていたら**PRをrevert**（Cloudflare Pages はダッシュボードから前回デプロイに即ロールバックもできる）。直すのは戻してから

## 3. 検証（完了条件）

| 項目 | 方法 | 合格基準 |
|---|---|---|
| シミュレーションの全状態 | プレビューで「詳しく見る」→アクセス→ジャンル→商品→打ち手→「最初から見る」を手動で一巡 | 現行と同じ遷移・同じ数値・同じ文言。薄面帯の中で崩れない（幅 375 / 768 / 1280） |
| コピーの差分ゼロ | 現行と新版の可視テキストを抽出して diff | 追加は事実バッジ3つ・英字ラベル・再CTA文言のみ。削除・変更ゼロ |
| 価格・法的文言 | `grep "¥22,000"`・tokushoho/terms の diff | 差分ゼロ |
| レスポンシブ | 375 / 768 / 1280 / 1440 のスクリーンショット | h1の語中改行なし、2カラムが縦積みに落ちる、CTAが横にはみ出さない |
| コントラスト | 墨色上の白系文字、sage-deep on white、alert on white | 本文サイズは 4.5:1 以上 |
| フォント | DevTools Computed | 英数字が Figtree、和文が Noto Sans JP、ワードマークのみ Zen Maru Gothic |
| リンク | 全 `href` をクリック | 404なし。mailto の email-protection が生きている |
| 下層ページ | about / help / 法的3ページを 375 / 1280 で目視 | ヘッダー・フッターがトップと同じ墨色chrome。本文の可読性が落ちていない |
| 監査再チェック | 07-30 hallmark 監査の critical 3件 | 3等分グリッドなし・同一リズムなし（見出し左寄せ2層＋不等分）・ナビは現行どおり |
| パフォーマンス | Lighthouse（モバイル） | フォント追加で LCP が現行比 +0.5s を超えないこと。超えるなら subset 化を検討 |

## 4. 実装前の確認事項（08-31 回答済み → 決定8〜10に反映）

1. 下層ページのchrome統一 → **揃える**
2. 料金末尾のCTA → **ボタン維持**
3. README の外部依存記述 → **「Google Fonts のみ」に更新**（セルフホストは見送り）

未回答の確認事項はなし。承認後、即着手できる。

## 5. スコープ外

資料PDF・デモ導線の格上げ・ミニ試算ツール・事例の追加・マルチページ化・インサイト系コンテンツ・アプリ側UI・`backend/billing.py`。シミュレーションの機能改修も含まない（バグを見つけた場合は別チケットで報告）。

## 6. 作業の受け渡し

- 実装先: Claude Code（リポジトリ直接）または Cowork＋パッチ運用。どちらでもこの計画書を先に渡す
- 完了時に `docs/sagyou_houkoku_lp_renewal_2026-XX-XX.md` を作成（sagyou-houkoku スキル）
- 確定デザイン `LP Variations.dc.html`（2a）は `docs/design/` 配下に保存して参照先を固定する
- zipの他の中身は保存しない: `uploads/lp_renewal_design_v4.html`（廃案）と `support.js`（Claude Design の表示用ランタイム、69KB）はリポジトリに入れない。廃案が残ると次のセッションが参照して混乱する
