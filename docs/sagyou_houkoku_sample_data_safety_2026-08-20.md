# 作業報告: サンプルデータの分離・アイテム別目標の削除・商品マスタ高速化 2026-08-20

オーナー報告3件（同日・口頭）への対応。
1. サンプルデータの全削除で実データまで消える。サンプル削除時はアイテム別目標のサンプル分も
   消してほしい（残ると重複する）
2. アイテム別目標を削除できるようにしてほしい
3. 商品マスタの自動提案の表示が遅い（開いてから1分待ち）。アイテム数が増えると縦スクロールが長すぎる

## 調査で判明した根本原因

- **`generate_sample_data()` が冒頭で全テーブルを無条件 delete していた。**
  「サンプル生成」ボタン自体が実データを消す作りで、全削除ボタン（/api/reset-data）は逆に
  ItemTarget・Product・Target を消さないため、サンプルのアイテム別目標・商品マスタが残骸として
  残り重複の原因になっていた（報告1の両症状はこの2つの合わせ技）。
- アイテム別目標の DELETE API（/api/item-targets/{mno}）と api.ts のメソッドは**実装済みだったが、
  UIに削除ボタンが無かった**（報告2）。
- `masters.get_review_queue()` が**商品1件ごとに suggest_category / suggest_cost_rate（各2〜3クエリ）を
  呼ぶN+1**で、SKUが数千件あると数千クエリ＝Postgresへのネットワーク往復で約1分。さらにフロントが
  提案を含む Promise.all で画面全体をブロックしていたため、商品一覧まで1分表示されなかった（報告3）。

## 実装

### 1. サンプルデータの分離（is_sample フラグ）
- `models.py`: データ系10テーブル（rpp_weekly / rpp_sales / monthly_analysis / monthly_item_sales /
  targets / products / product_categories / product_costs / item_targets / genre_benchmarks）に
  `is_sample = Column(Boolean, default=False)` を追加。`migrations.py` の `_EXTRA_COLUMNS` で
  既存DBにも冪等に追加（`BOOLEAN DEFAULT FALSE`＝既存行は実データ扱い）。
- `sample_data.py`:
  - 生成冒頭の全削除をやめ、`delete_sample_data()`（is_sample=True のみ削除）で入れ替え。
    **無条件の全削除に戻さないこと**（コード内コメントにも明記）。
  - 生成する全行に is_sample=True を付与。カテゴリは**新規作成分だけ**マーク
    （既存＝実データ由来のカテゴリを消さない）。
  - 実データと管理番号が衝突する商品は生成をスキップ（実データ優先・skipped_mnos で通知）。
  - 実データの Target / ItemTarget / GenreBenchmark が既にあるキーはスキップ（unique制約と設定保護）。
  - 副次修正: セッションが autoflush=False のため、NEW-001 を add 直後に db.query で引き直すと
    None になり launch_month / is_sample が設定されない潜在バグがあった（upsert_product の戻り値を
    直接使う形に修正）。
- `main.py`:
  - `DELETE /api/sample-data` 新設（サンプルのみ削除。実データ・設定は保持）。
  - `POST /api/reset-data`（全削除）はサンプル残骸（目標・アイテム別目標・マスタ）も一掃。
    実データの目標・マスタは従来どおり保持。
  - `/api/data-status` に `has_sample` を追加（ボタンの表示制御用）。
- `DataImport.tsx`: 「サンプルだけ削除」ボタン追加（has_sample のときのみ表示）、
  全削除は「実績データを全削除」に改名し confirm 文で実データも消えることを明示。

### 2. アイテム別目標の削除（UI接続）
- `TargetSetting.tsx`: アイテム別目標一覧に「操作」列を追加し、設定済みの行に削除ボタン
  （confirm → 既存 `DELETE /api/item-targets/{mno}` → 再読込）。

### 3. 商品マスタの高速化・一覧改善
- `masters.get_review_queue()`: 固定6クエリのプリフェッチ方式に書き換え
  （商品・原価・カテゴリ・月次ジャンル・RPPジャンル・店舗）。
  **性能規約: 商品ループの中で db.query を呼ばないこと**（docstringに明記）。
  単品版 suggest_category / suggest_cost_rate は承認エンドポイント用に残置。
- `MasterSettings.tsx`:
  - 提案の取得を商品一覧の Promise.all から分離して並行取得。取得中は
    「自動提案を計算しています…（一覧は先に操作できます）」のプレースホルダを即時表示
    （機能の存在に遅れて気付く問題への対応）。
  - 一覧に検索（管理番号/商品名/ジャンル）と50件/ページのページングを追加。

## 検証（すべてローカル実測）

- `npm run build` 型エラー0 / `from main import app` OK / 主要画面コンソールエラー0
- **ロジック単体（SQLite）**: 実データ（REAL-001の実績・当月Target・ItemTarget）を仕込んだ状態で
  生成→再生成→サンプル削除を実行し、(a) 実データ・実データTargetが常に保持される
  (b) 再生成で行数が増えない（入れ替え） (c) サンプル削除で is_sample 行が0になり
  実データ4種が残る (d) RUN-001 を実データとして仕込むと skipped_mnos=["RUN-001"] で
  その商品だけ生成スキップ、をすべてアサーションで確認
- **API通し**: 生成→ has_sample:true → DELETE /api/sample-data（416行削除・実データ保持の
  メッセージ）→ has_sample:false → 再生成→ reset-data 後の item-targets が0件
- **実画面（ヘッドレスChromium）**: データ取込みに2ボタン表示／目標設定の削除ボタン2件→
  実クリックで1件に減る（削除がAPIまで通る）／商品マスタの検索「ソックス」で11件→2件
  （ACC-001/ACC-004）／提案パネル表示
- **性能**: 3000商品・提案キュー2000件で新実装107ms。旧実装相当（単品関数ループ）は
  4.6秒（ローカルSQLite・x43）で、**提案内容は全2000件で新旧完全一致**。
  本番（Postgres・ネットワーク越し）では旧実装のクエリ数（1万超）が約1分の正体なので、
  改善幅はさらに大きい

## 申し送り

- 既存DBの is_sample 列は起動時マイグレーションで自動追加。**過去に生成したサンプルは
  フラグが無い（=実データ扱い）**ため、この変更のデプロイ前に入っていたサンプルは
  「サンプルだけ削除」では消えない。本番のdemoアカウント等は一度「実績データを全削除」→
  「サンプルを生成」で置き直すときれいになる
- 商品マスタのページングは50件/ページ固定（MASTER_PAGE_SIZE）。件数切替が欲しくなったら別チケット
