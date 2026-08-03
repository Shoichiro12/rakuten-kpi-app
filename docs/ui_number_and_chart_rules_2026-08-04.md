# 数字とグラフの見せ方・強弱のつけ方 2026-08-04

「必要なデータは揃っているのに、数字と文字の羅列で見づらい」への回答。
ディープリサーチの結果を、ウレシルにそのまま当てられる規則の形にまとめた。

調査元は末尾。実務系の一次情報（Stephen Few の設計仕様書、Cleveland & McGill の知覚実験、
Nielsen Norman Group、W3C WCAG、Shopify Polaris、Plausible のソースコード、Grafana / Datadog /
Stripe / Mixpanel / ChartMogul の公開仕様）で、Dribbble 的なビジュアル集は使っていない。

Before / After のモック（単体HTML `ureshiru_dashboard_before_after.html`）は Cowork のチャットで別途受け渡し。
リポジトリに置きたい場合は `docs/` に追加すること。

---

## 0. 先に結論（これだけで7割）

1. **金額は「万・億」で丸める。** `¥12.3M` は日本の商習慣では読めない。`1,234.5万円` が正しい
2. **大きい数字は1画面に1つ。** 多くて2つ。今は同じ強さのカードが並んでいるので、どこを見ればいいか分からない
3. **CVR・CTR・ROAS・ROI・GPR の前期比は「%」ではなく「ポイント」。** ここは実装バグとして直す価値がある
4. **CPC・CPO・広告費は「下がったら緑」。** 指標ごとに良い方向のフラグを持たせる
5. **目標に対する進捗は棒でも％でもなく「弾丸グラフ」。** 実績・目標・ペース・良し悪しの4つを1本で出せる
6. **強調は「大きくする」より「他を消す」。** まずは全部グレーで描いて、伝えたい1つだけに色を付ける
7. **表は縞々にしない。** 1pxの薄い区切り線＋ホバー＋固定ヘッダー。背景色は警告専用に空けておく

---

## 1. 数字の見せ方

### 1-1. 日本語の単位（最重要）

EUのデータ可視化ガイドが明記している。**桁区切りは3桁だが、中国と日本は1万単位で数える。**
K/M/B の略記をそのまま日本語UIに持ち込むと、頭の中で変換が必要になる。

ウレシルの丸め規則（提案）:

| 金額の範囲 | 表示 | 例 |
|---|---|---|
| 1万円未満 | そのまま（3桁区切り） | `8,400円` |
| 1万円〜1億円未満 | `万円`（小数1桁） | `1,234.5万円` |
| 1億円以上 | `億円`（小数2桁） | `1.23億円` |

- グラフの軸ラベルとKPIカードは**丸める**。表・ツールチップ・CSV出力は**丸めない**
- Stephen Few のルール: 「ダッシュボードは必要以上に詳細・高精度な情報を出してはいけない」
- **CSV出力の書式は表示の書式を使い回さない。** 出力側は桁区切りも単位もなしの生の数値にする

### 1-2. 桁区切り・小数・単位の置き場所

- 数値は**右寄せ**、テキストは**左寄せ**、見出しは中身の寄せに合わせる。**中央寄せは使わない**
- `tabular-nums`（等幅の数字）を表とKPIカードに効かせる。ただし**巨大なヒーロー数値には付けない**（間延びする）
- 小数は**原則1桁まで**。同じ列・同じ並びの中では小数桁を揃える
- 0〜1の数値は `0.354` のように**先頭に0を付ける**
- **単位は列見出しに1回だけ置き、セルからは外す**（`売上（円）` とし、各セルの `¥` は消す）。右寄せの邪魔になるため
- 1000〜9999 は桁区切りを省いてもよい（`4500`）

### 1-3. 前期比（デルタ）の出し方

Plausible のソースコード、Grafana、Datadog、Streamlit を突き合わせた結果、全部同じ形だった。

- 並びは **ラベル → 数値 → デルタ** の順。デルタは数値の右か真下、いちばん小さい文字。**数値の上には置かない**
- **マイナス記号は使わず、絶対値＋矢印で符号を表す。** Plausible は `${Math.abs(change)}%` と書いている
- 矢印は色と必ずセット（WCAG 1.4.1「色だけで情報を伝えない」の要件。好みの問題ではない）
- **比較の基準を必ず添える。** `前週比` `前年同月比` のラベルなしの `-10%` は意味がない
- 変化率だけだと規模が消えるので、**絶対差はツールチップか括弧で補う**

### 1-4. 「%」と「ポイント」の区別（実装バグとして直す）

英国ONSのスタイルガイド: 「パーセントポイントはパーセント同士の差。10%が1ポイント下がると9%。
一方10%の1%減は9.9%」。

**ウレシルで割合の指標は CVR・CTR・ROAS・ROI・GPR・達成率。この6つの前期比は「ポイント」表記にする。**
CVR が 3.2% から 2.8% に落ちたときは `-0.4pt`（または `-0.4ポイント`）であって `-0.4%` ではない。
マーケティング系ダッシュボードで最も多い数値の間違い、と名指しされている。

### 1-5. 母数が小さいときは出さない

注文が1件から3件に増えたときの `+200%` を、400件から1200件と同じ強さで出してはいけない。

- 医療統計の小標本ガイドラインが実務的な下限の考え方を与えている。相対標準誤差25%以上は「要注意」、
  50%以上は「不安定なので非表示」
- ウレシルでは**指標ごとに最低母数を決める**。案: クリック30未満の期間は CVR とその前期比を出さない
  （数値の代わりに実数の件数を出す）、注文5件未満は CPO・Limit CPO を出さない
- 既に `access_definitions.py` に低母数除外（`is_reliable`）の仕組みがあるので、**表示側にも同じ考えを通す**

### 1-6. 比較できないときは空欄にしない

GitLab が同じ問題に出した結論。空セルは「壊れている」と読まれる。

| 状況 | 表示 |
|---|---|
| 前期のデータが無い | `前週データなし` |
| 前期と同じ | `変化なし`（`0%` に矢印を付けない） |
| 前期が0（変化率が定義できない） | 絶対差で出す。例 `+12件（前週0）` |
| 母数不足（1-5） | `判定不可（クリック18）` |

Plausible・Grafana・Datadog はいずれも「デルタが無いときは何も描かない」実装になっている。

### 1-7. 指標ごとに「良い方向」を持たせる

`up = 緑` を全指標に当てると、CPCの上昇が緑になる。

- Plausible はソースに `const invert = metric === 'bounce_rate'` と直接書いている
- Grafana は「標準 / 反転 / 値と同じ」、Datadog は「増加が良い / 減少が良い / **中立**」の3択
- **中立が要る。** クリック数・注文件数・アクセス数は単体では良し悪しが決まらない。色を付けないほうが正しい

ウレシルの割り当て（提案）:

| 方向 | 指標 |
|---|---|
| 上がったら良い | 売上・Gross・GP・GPR・Rev・ROI・ROAS・CVR・CTR・客単価・達成率 |
| **下がったら良い** | **CPC・CPO・広告費（AdCost）** |
| 中立（色を付けない） | クリック数・注文件数・アクセス数（UU）・売上原価・店舗運営経費 |

売上原価と店舗運営経費を中立にしたのは、**売上に比例して増えるので単体では良し悪しが決まらない**ため。
効率が悪化しているかどうかは GPR と Rev が見る。

※ ダッシュボードの詳細指標表では CPO・CPC の色反転を既に実装済み。同じ規則をカードとグラフにも通す。

---

## 2. 強弱のつけ方

### 2-1. 大きい数字は1つ、多くて2つ

- NN/g: 「サイズは3種類まで（小・中・大）」「大きい要素は最大2つまで」「複雑なデザインではコントラストの
  段階は3つまで」
- Stephen Few: 「**すべてが目立つとき、何も目立たない**」
- Few（知覚の論文）: 短期記憶は3〜7チャンク。「**別々の意味を持つ要素は最大7つ、安全側は5つまで**」

ウレシルの現状はKGIヒーローがある点は良い。ただし2層・3層のカードとパネルが同じ強さで続くので、
1画面に「意味を持つ要素」が7つを大きく超えている。

### 2-2. 文字サイズは3段階、しかも大きく跳ばす

- 「1〜2ポイントの差では階層が伝わらない」。段は**1.5倍程度跳ばす**
- 提案する3段階: **ヒーロー数値 30〜36px / カード数値 20〜24px / 本文・ラベル 12〜14px**
- 現状は10種類（うち3つは `text-[9px]` のような直値）。ここを整理するだけで見え方が変わる

### 2-3. 目立たせるより「他を消す」

- NN/g: 「重要な情報を目立たせるのは、強調を足すことだけを意味しない。**不要な要素を消すほうが同等以上に効く**」
- NN/g のチャート指針: 「**まずグレーで描く**」。全部グレースケールで組んでから、伝えたい1点にだけ色を足す
- Few: 「**色は伝えたい目的があるときだけ使う**」「**意味の違いに対応するときだけ色を変える**」
  「**通常の情報は落ち着いた色、注意を引きたいものだけ明るい色**」

### 2-4. グループは余白で作る（枠線で囲わない）

- Few（ゲシュタルト）: 「**余白だけで、たいていグループは分けられる**」
- 実務的には: グループ**間**の余白を広げ、グループ**内**の余白を詰める。カードの境界は1pxの極薄で十分

### 2-5. 1行に並べるカードは6枚まで

- 1280×720 では「6枚を超えるとカードが細くなりすぎる」
- 見る頻度別の目安: 経営層向け3〜5個 / 週次の管理向け5〜7個 / 日次の運用向け7〜9個。9個を超えたら別ページへ

---

## 3. グラフの選び方と作り

### 3-1. 人間が正確に読める順番（Cleveland & McGill）

正確な順に: **共通の基準線上の位置 → ずれた軸上の位置 → 長さ・向き・角度 → 面積 → 体積・曲率 → 濃淡・彩度**。

Heer & Bostock の追試での誤差（log₂の絶対誤差）: 位置 約1.0〜1.2 / 長さ 約1.5〜1.7 / **角度 約2.0〜2.2** /
面積 約2.4〜2.6。**角度から値を読むのは位置から読むより約2倍間違える。**

したがって:

- 量を比べさせるものは**共通の基準線を持つ棒か点**にする。円グラフ・ドーナツ・ゲージ・ツリーマップは使わない
- 時系列は折れ線（2次元の位置）
- **量を色の濃さで表さない。** 色は分類か、離散的な警告状態だけ
- NN/g: 「**積み上げ棒はエラー率が最も高いグラフのひとつ**」。売上 = アクセス × CVR × 客単価 の分解に
  積み上げ棒は使わず、小さい図の繰り返し（スモールマルチプル）かウォーターフォールにする
- 日本語の長いラベル（商品名・ジャンル名）は**横棒**にする。縦棒だとラベルが斜めになる

### 3-2. ゲージを使わない理由

Few: ゲージやメーターは「情報量が少なすぎ、場所を取りすぎ、無意味な装飾で散らかっている」。
NN/g も「場所を食ううえに角度に頼るので量の伝達が下手」。

### 3-3. 目標に対する進捗は「弾丸グラフ」

Few の設計仕様書に寸法まで書いてある。1本で**実績・目標・前期・良し悪しの帯**を同時に出せる。

- **実績**: 太い黒の棒。太さは容器の約1/3。中央に置く
- **比較対象**（目標・前期）: 進行方向に直交する短い縦線。1〜2本まで。2本目は75%グレー
- **良し悪しの帯**: 背景の帯。**最大5段、理想は3段**。色相を変えず**1色の濃淡**で（40% / 25% / 10% の黒）。
  色覚特性があっても読める
- 目盛りは**0から始める**
- **CPC・CPO・広告費のように「低いほうが良い」指標は帯の順序を反転する**（濃い＝高い＝悪い）

進捗バー（プログレスバー）との違い: 進捗バーは上限が100%。ROASのように目標を超える指標は表現できない。
**超えうる指標は必ず弾丸グラフ**。

### 3-4. 「順調か遅れか」の出し方（着地見込み）

- ペーサー（あるべき進捗）の基本式: `目標 × 経過日数 ÷ その月の日数`
- **ただしECは日次が一様ではない。** 楽天スーパーSALE・お買い物マラソン・週末・給料日で山が来る。
  線形のペーサーだと、後半に売上が寄る月はほぼ全期間「遅れ」と出てしまう
- **ウレシルは既に季節指数を持っている**（`revenue_plan.py`）。月内の配分に応用できるなら、
  季節性で重み付けしたペーサーのほうが正しい。**どちらの基準で出しているかを画面に明示する**
- Few の別解: 実績の棒を「実績部分」と「着地見込み部分」に分けて1本で描く

ウレシルのKGIヒーローの構成（提案）:

1. 実績の棒（濃い）
2. その続きに薄い棒で着地見込み
3. 縦線1（濃い）= 月次売上目標
4. 縦線2（75%グレー）= ペーサー。実績がこれを超えていれば順調、届いていなければ遅れ
5. 背景に3段の帯
6. テキストで達成率と、ひとことの判定（`順調` / `遅れ`）

### 3-5. グラフの装飾を削る

- **グリッド線はほぼチャートジャンク**（Few）。使うなら「役目を果たすぎりぎりの薄さ」。
  **今のウレシルは3箇所すべて破線（`strokeDasharray="3 3"`）。破線は「しきい値」「予測」に読まれるので実線の極薄に変える**
- グリッド線を引くなら**8px以上の間隔**（Heer & Bostock）
- **グラフの高さは最低50px、80pxで頭打ち**（同）。それ以上高くしても読み取り精度は上がらない
- 凡例は系列が2本以上のときだけ。**1本ならタイトルが名前を兼ねる**（今の単系列 `LineChart` の `<Legend />` は不要）
- 同時に描く系列は**2本を基本、多くて4本**（Shopify Polaris）。5本を超えるならスモールマルチプルにする
- 軸線は「データがある範囲にだけ」引く。容器の端まで伸ばさない
- 3D・グラデーション・影は使わない

### 3-6. 未確定の期間は線を変える

調査した全プロダクト（Plausible・ChartMogul・Datadog・Shopify）が同じことをしていた。
**進行中・未確定の期間は点線か縞模様にする。** ウレシルの週次トレンドの最新週、月次の当月がこれに当たる。

### 3-7. スパークライン

- Tufte の定義: 「**小さく、濃く、単純な、語と同じ大きさの図**」。軸も目盛りも凡例も持たない
- **正常範囲をグレーの帯で背景に敷く**。帯から外れたところが目を引く。
  ウレシルなら CTR 1%・ROI 100% のしきい値を帯にすれば、警告列を別に立てなくてよい
- 端点に色を付け、その横に現在値を同じ色で書く
- **縦のスケールの取り方を必ず明記する**（Few）。商品ごとに独立スケールのスパークラインを並べると、
  形は比べられるが大きさは比べられない。大きさを比べさせたいなら共通スケールにする

---

## 4. 表の作り

- **行の高さは 40px（詰め）/ 48px（標準）/ 56px（ゆったり）** の3段階。切替を出してもよい
- **縞々（ゼブラ）は使わない。** 244人の実験では正確さにも速さにも有意差が出ていない（好みでは46%が縞を選好）。
  それより、ウレシルは Limit CPO 超過の**行ハイライトが必要**なので、背景色は警告に空けておくべき。
  縞＋ホバー＋選択＋警告で灰色の意味が4〜5段になると読めなくなる
- 代わりに: **1pxの薄い区切り線＋強めのホバー＋固定ヘッダー**
- 横スクロールするときは**左端の識別列（商品名）を固定**する
- **1列目は人間が読める識別子にする**（商品管理番号ではなく商品名）
- **列の並び順が重要度を表す。** 判断に使う列（ROI、CPO対Limit CPO の状態）を識別列の直後に置く
- セル内に量を出すなら**背景の塗り分けより横棒（インセルバー）**。棒は「長さ」＝知覚順位3位、
  背景の濃淡は「彩度」＝最下位
- **条件付き書式はしきい値を跨いだセルだけ。** 全セルを連続的に塗らない。塗ると何も目立たなくなる
- しきい値の判定は**表示用に丸めた文字列ではなく生の数値で行う**（Datadog が明記している実装上の罠）

---

## 5. ウレシルへの当てはめ（優先順位）

| 優先 | やること | 効果 |
|---|---|---|
| **1** | 金額表示を「万・億」に統一（カードと軸のみ。表・ツールチップ・CSVは生値） | 読む速度が一番変わる |
| **1** | 割合指標の前期比を「ポイント」表記に修正 | 数値の正しさの問題 |
| **1** | 指標ごとに「良い方向」（上/下/中立）を定義し、色と矢印をそこから引く | CPCの上昇が緑になる事故を止める |
| **2** | KGIヒーローを弾丸グラフ化（実績・着地見込み・目標・ペーサー・3段の帯） | 「順調か遅れか」が1本で分かる |
| **2** | 文字サイズを3段階に、大きい数字を1つに絞る | 視線の起点ができる |
| **2** | グラフの破線グリッドを実線の極薄に、単系列の凡例を外す | 静かになる |
| **3** | 比較不可・変化なし・母数不足の4状態を作る | 空欄が減る |
| **3** | 表を「1px区切り＋ホバー＋固定ヘッダー＋左端固定」に。背景色は警告専用 | 迷子にならない |
| **4** | 商品別KPIの各行にスパークライン（正常範囲をグレー帯で） | 一覧で異常が見つかる |
| **4** | 未確定期間を点線にする | 誤読を防ぐ |

---

## 6. 調査元

**原則・研究**

- Stephen Few, Bullet Graph Design Specification — https://www.perceptualedge.com/articles/misc/Bullet_Graph_Design_Spec.pdf
- Stephen Few, Common Pitfalls in Dashboard Design — https://www.perceptualedge.com/articles/Whitepapers/Common_Pitfalls.pdf
- Stephen Few, Practical Rules for Using Color in Charts — https://www.perceptualedge.com/articles/visual_business_intelligence/rules_for_using_color.pdf
- Stephen Few, Grid Lines in Graphs Are Rarely Useful — https://www.perceptualedge.com/articles/dmreview/grid_lines.pdf
- Stephen Few, Best Practices for Scaling Sparklines — https://www.perceptualedge.com/articles/visual_business_intelligence/best_practices_for_scaling_sparklines.pdf
- Heer & Bostock, Crowdsourcing Graphical Perception (CHI 2010) — https://idl.cs.washington.edu/files/2010-MTurk-CHI.pdf
- Edward Tufte, Sparkline theory and practice — https://www.edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/
- NN/g, Dashboards: Making Charts and Graphs Easier to Understand — https://www.nngroup.com/articles/dashboards-preattentive/
- NN/g, The 3Cs of Charts: Contrast — https://www.nngroup.com/articles/contrast-charts/
- NN/g, Data Tables: Four Major User Tasks — https://www.nngroup.com/articles/data-tables/
- NN/g, Choosing Chart Types — https://www.nngroup.com/articles/choosing-chart-types/
- NN/g, Visual Hierarchy in UX — https://www.nngroup.com/articles/visual-hierarchy-ux-definition/
- NN/g, 8 Design Guidelines for Complex Applications — https://www.nngroup.com/articles/complex-application-design/
- W3C, Understanding SC 1.4.1 Use of Color — https://www.w3.org/WAI/WCAG21/Understanding/use-of-color.html
- ONS Content Style Guide, Percentages — https://service-manual.ons.gov.uk/content/numbers/percentages
- EU Data Visualisation Guide, Number formatting — https://data.europa.eu/apps/data-visualisation-guide/number-formatting
- A List Apart, Designing Tables to be Read, Not Looked At — https://alistapart.com/article/web-typography-tables/
- A List Apart, Zebra Striping: Does it Really Help? — https://alistapart.com/article/zebrastripingdoesithelp/
- Pencil & Paper, Data Table UX Patterns — https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables
- Atlassian Analytics, Create a pacing chart — https://support.atlassian.com/atlassian-analytics/kb/create-a-pacing-chart/

**実プロダクトの仕様**

- Shopify Polaris, Data visualizations — https://polaris-react.shopify.com/design/data-visualizations
- Plausible（ソースコード。デルタの実装） — https://github.com/plausible/analytics
- Grafana, Stat panel — https://grafana.com/docs/grafana/latest/panels-visualizations/visualizations/stat/
- Datadog, Query Value widget — https://docs.datadoghq.com/dashboards/widgets/query_value/
- Stripe, Sparkline component — https://docs.stripe.com/stripe-apps/components/sparkline
- Mixpanel, How we designed Metric Trees — https://mixpanel.com/blog/designing-metric-trees/
- ChartMogul, Getting started with charts — https://help.chartmogul.com/article/282-getting-started-with-charts-in-chartmogul
- Linear, Dashboards best practices — https://linear.app/now/dashboards-best-practices
- Streamlit, st.metric — https://docs.streamlit.io/develop/api-reference/data/st.metric

**補足: 逆の主張もある**

Tufte の「データインク比を最大化せよ」に対して、Bateman ら（CHI 2010）は装飾のあるグラフのほうが
2〜3週間後の記憶が有意に良いという結果を出している。ただしこれは**一度きりの説得用のグラフ**の話で、
毎日開いて値を正確に読む道具には当てはまらない。ウレシルは後者なので、Tufte 側を採る。
