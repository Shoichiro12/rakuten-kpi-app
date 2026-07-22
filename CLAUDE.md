# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ セキュリティ最優先事項: 新しいテーブルには必ずRLSを（顧客データ漏洩の防止）

**このプロダクトは他社（EC事業者）の売上データを預かる。データ漏洩は一度でも起こしてはならない。**

### 実際に起きたこと（2026-07）

`models.Base.metadata.create_all()` で作成したテーブルは **RLSが無効のまま** `public` スキーマに置かれる。
Supabase は `public` スキーマを Data API (PostgREST) 経由で公開するため、
**フロントのJSに埋め込まれた anon キーだけで、誰でも全データを読み書きできる状態だった。**

実際に未ログイン・anonキーのみで商品名・売上・目標値の実データが取得できることを確認済み。
Supabase Security Advisor に `rls_disabled_in_public` の Critical が9テーブル分出ていた。

補足: **anonキーが漏れていたわけではない。** anonキーは公開が前提の値で、
本来の防御はRLSが担う。そのRLSが無効だったため防御がゼロだった。

### 現在の防御（3重）

1. **起動時に自動強制** … `migrations._enforce_rls_pg()` が `pg_tables` を走査し、
   RLS未適用のテーブルを自動で `ENABLE ROW LEVEL SECURITY` する。
   **新しいモデルを追加してもデプロイすれば自動で塞がる。** 冪等。
2. **可視化** … `GET /api/security-status` が `unprotected` を返す。
   ここが空でなければ即対応が必要。
3. **このドキュメント**

### 新しいモデルを追加するときの必須確認

- `UserScopedMixin` を継承する（ユーザー単位のデータ分離。`tenancy.py` 参照）
- デプロイ後に `GET /api/security-status` で `ok: true` / `unprotected: []` を確認する
- **RLSを無効化するコードを書かない。** どうしても必要なら理由をここに追記すること

### なぜアプリが壊れないか

バックエンド(FastAPI)は `DATABASE_URL` でテーブル所有者(`postgres`ロール)として直接接続しており、
**所有者はRLSをバイパスする**。そのためポリシーを1つも作らなくてもアプリの動作は変わらず、
Data API 経由の anon / authenticated アクセスだけが全拒否される。
（`FORCE ROW LEVEL SECURITY` は所有者にも適用されてしまうので使わないこと）

楽天（Rakuten）出店者向けのKPI管理アプリ。FastAPIバックエンド + React/Viteフロントエンドの2構成。楽天RMSからエクスポートしたCSVを取り込み、KGI→KPIのロジックツリー分解・GAP分析・RPP広告実績を可視化する。UI・コメント・エラーメッセージはすべて日本語。

## この製品が目指しているもの（必読）

**事業コンセプトは [`docs/VISION.md`](docs/VISION.md) を参照。実装や優先順位に迷ったらそこに立ち返る。**

要約すると、これは「楽天の分析ツール」ではなく **ECコンサルティングをAIで民主化する** ためのプロダクトで、
最終形は EC事業者の**意思決定OS**（AIストアマネージャー）。ダッシュボードを見せることが目的ではなく、
店舗が「次に何をすればいいか」を判断できる状態を作ることが目的。

そのため、コードを書くときは以下を判断基準にする（詳細は VISION.md 末尾）:

- **出力の最終地点は数値ではなく次のアクション。** 数値を並べただけの画面は未完成とみなす。
- **データが無いときこそ意思決定を止めない。** 「データがありません」で画面全体を隠さず、
  「今わかること」と「まだわからないこと」を切り分けて提示する。
  （実例: 商品分析データがあるのにRPP未取込というだけで月次が全面空白になる不具合があった）
- **将来のモール横展開（Amazon/Shopify等）に備え、モール固有の取込み層とKPI計算ロジック層を混ぜない。**

## Commands

開発（Windows）はリポジトリ直下の `start.bat` がバックエンドとフロントを別ウィンドウで同時起動する。個別に動かす場合:

```powershell
# バックエンド（cwd = backend/、ポート8000）
cd backend
py -3 -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
# → API: http://localhost:8000 / Swagger: http://localhost:8000/docs

# フロント（cwd = frontend/、ポート5173）
cd frontend
npm install      # 初回のみ
npm run dev      # 開発サーバー（/api を 127.0.0.1:8000 にプロキシ）
npm run build    # tsc 型チェック + vite build（CIの代わり。型エラー0必須）
```

依存導入: backend は `pip install -r backend/requirements.txt`。

**テストフレームワークは未導入**（pytest等なし）。検証は (1) `cd backend && py -3 -c "from main import app"` のimport確認、(2) `cd frontend && npm run build` の型チェック、(3) uvicorn起動して `curl` でエンドポイントを叩く、で行う。ロジック単体検証は対象関数をその場で `py -3 -c "..."` 呼び出しする。

## Windows固有の注意

- `vite.config.ts` のプロキシ先は `http://127.0.0.1:8000`（`localhost` 不可）。Windows+Node18+では `localhost` がIPv6 `::1` を先に引き、IPv4でbindするuvicornへのフォールバックが遅延して「Failed to fetch」になるため、IPv4直指定で固定している。**この設定を `localhost` に戻さないこと。**
- 「Failed to fetch」の典型原因は、**古い`uvicorn`プロセスがポート8000を掴んだまま旧コードを返している**ケース。新エンドポイントが404/挙動不一致なら、まず`:8000`を掴むプロセスを停止して再起動する。

## アーキテクチャ

### バックエンド（`backend/`）

- `main.py` がエントリ。起動時に `models.Base.metadata.create_all()` でSQLite（`rakuten_kpi.db`）にテーブルを自動生成する（マイグレーションツールなし＝モデル変更は手動でDB削除 or ALTER）。全例外は `global_exception_handler` が `{"detail": str(exc)}` のJSON 500に変換。CORSは `localhost:5173`/`3000` のみ許可。
- ルーターは `backend/routers/` 配下（dashboard / import_csv / targets / gap_analysis / products / actions / evaluation / export / account）。**規約: 全エンドポイントは常にJSONを返す（データ無しでも `{}`/`[]`）。** フロントはこれに依存している。
- **クエリパラメータの列挙値は `typing.Literal[...]` で型注釈する。** `Query(..., enum=[...])` はPydantic v2環境ではバリデーションされず不正値が素通りする既知の落とし穴があり、`period`/`level`/`period_type` 等はすべて `Literal` に統一済み。

### マルチテナント（ユーザー別データ分離）— `backend/tenancy.py`

- 全データテーブルは `UserScopedMixin` を継承し `user_id` 列（SupabaseユーザーUUID）を持つ。**新しいモデルを追加するときは必ず `UserScopedMixin` を継承すること**（継承しないと全ユーザー共有になる）。
- 絞り込みはSQLAlchemyイベントで自動適用: `do_orm_execute` が全 SELECT/UPDATE/DELETE に `user_id = 現在ユーザー` を付与（`with_loader_criteria`。集計クエリや `Query.delete()` にも効く）、`before_flush` がINSERT行に user_id をスタンプ。**ルーター側で user_id を意識する必要はない**が、生SQL（`text()`）には自動適用されないので手動で絞ること。
- 現在ユーザーは `auth.UserContextMiddleware`（ASGI）がContextVar `tenancy.current_user_id` にセットする。FastAPIの同期依存関係内でContextVarをセットしても伝播しない（スレッドプールのコンテキストコピー）ため、ミドルウェア方式。
- 認証無効（ローカル開発）時は `user_id IS NULL` の行のみ対象＝従来どおり単一ユーザーで動く。
- ユニーク制約は user_id 込み。既存DBは起動時の `migrations.run_migrations()` が user_id 列追加・Postgresの制約張り替えを冪等に実行。マルチテナント化以前のデータ（user_id NULL）は env `LEGACY_DATA_USER_ID` で特定ユーザーに割り当て可能。

### アカウント管理

- フロント: `/account`（`AccountSettings.tsx`）＝メール変更・パスワード変更（Supabase `updateUser`）・退会。`Login.tsx` にパスワードリセットメール送信、`ResetPassword.tsx` は `PASSWORD_RECOVERY` イベント時にApp.tsxが表示。
- バックエンド: `routers/account.py`。退会（`DELETE /api/account`）＝本人の全データ削除 + Supabase Admin APIでユーザー削除。**env `SUPABASE_SERVICE_ROLE_KEY` 必須**（未設定は501）。service_roleキーは絶対にフロントへ渡さない。

### KPI計算は `backend/calculations.py` が単一の真実

全KPIの計算式は `calc_kpis()` に集約。重複実装せずここを参照・修正する。定義上の注意:
- `roi = gp / ad_cost`（**粗利ベース＝ROASの粗利版**。財務的なROI=純利益/投資ではない）。アラート閾値 `roi < 100` は「広告費が粗利を超過＝赤字」の意味で正しい。
- `cvr = cv / ct`（クリック→注文）。一方 `MonthlyItemSales.cvr` はCSV由来の「アクセス→注文」転換率で**母数が異なる**。同一画面で両者を混在させない。
- `rev`（利益残）= `gp - (ad_cost + steady_cost)`、`steady_cost = gross * expense_rate`（`expense_rate` は `Target` 由来、既定0.15）。

### データモデル（`backend/models.py`）と取り込み2系統

CSVパースは `backend/routers/import_csv.py`。エンコーディング/スキップ行はRMSの書式に合わせて固定:

1. **RPP広告レポート（Shift-JIS, 先頭8行スキップ）** → 2テーブルに同時書き込み:
   - `RppWeekly` … 既存集計テーブル。dashboard / gap_analysis / products が**集計に使うのはこちらのみ**。
   - `RppSales` … 生データ保管。週次/月次両対応、720h/12hの2アトリビューション値（`gross_720`/`gross_12`等）を保持。`/api/import/rpp/{periods,sales,summary}` の新エンドポイント専用。
   - 計測期間文字列から週次/月次を自動判別（`2026年03月01日〜07日`=weekly / `2026年03月`=monthly）。
   - ⚠️ **二重計上注意**: 1インポートで両テーブルに書く設計のため、`RppSales` を使う新たな集計を足すと `RppWeekly` 由来の既存集計と二重計上になりうる。役割分離を守ること。
2. **月次商品分析（UTF-8 BOM, 先頭5行スキップ）** → `MonthlyItemSales`。ジャンルが大/中/小（`genre_u1/u2/u3`）に分割済み、アクセス・CVR等を保持。
   - `MonthlyAnalysis` は旧スキーマ（レガシー）。新規はなるべく `MonthlyItemSales` を使う。

### 週次/月次の期間ロジック（gap_analysis.py / dashboard.py）

- `weekly`: `RppWeekly.week_start`（日曜始まり）の完全一致でフィルタ。
- `monthly`: `func.strftime("%Y-%m", RppWeekly.week_start) == ym` で集計。⚠️ 月跨ぎの週は開始日の月に丸められるため、`MonthlyItemSales` の正確な月次値とは僅差が出る既知の制約。
- 前月（前期）は必ずリクエストの `year_month` から `_prev_month()` で導出する（`today` 依存にしない）。
- KGIツリー（`/api/gap/kpi-tree`）は `KGI = アクセス × CVR × 客単価` をすべて `RppWeekly` 由来で統一（access=クリック数ct）。`MonthlyAnalysis.access_count` は母数が異なるため使わない。
- ジャンルGAP（`/api/gap/genre`）は `RppWeekly.genre` の `/` 区切りを階層分解し、`level`(u1/u2/u3) と `parent` で絞り込む。既存レスポンスキーは維持し階層情報キーを追加する後方互換方針。

### フロントエンド（`frontend/`）

- `src/App.tsx` がルーティング（`/`=Dashboard, `/gap`=GapAnalysis, `/products`=ProductKPI, `/import`=DataImport, `/targets`=TargetSetting, `/rpp`=RppAnalysis）。
- **すべてのAPI呼び出しは `src/lib/api.ts` の `request()` / `parseJson()` ヘルパー経由にする。** `res.text()` → 空ならフォールバック → `JSON.parse` をtry/catch、`Failed to fetch` も捕捉して日本語メッセージ化し、空レスポンスやパース失敗でUIをクラッシュさせない。新しいfetchを直書きしない（FormDataアップロードも同パターンを踏襲）。
- 各ページ・グラフ（Recharts）は空配列/undefined時に「データなし」を表示するガードを入れる。
- 型は `src/types/index.ts` に集約。

### `.claude/agents/`（任意）

`backend-engineer` / `frontend-engineer` / `data-analyst`(読取専用) / `qa-debugger` の専門サブエージェント定義あり。担当領域は backend=`/backend`、frontend=`/frontend` に分け、同一ファイルの同時編集を避ける運用。

## 楽天RMS CSVフォーマット仕様（インポート処理の実装時は必ず参照）

### ① RPP広告レポート（週次）
- **文字コード:** Shift-JIS
- **skiprows:** 8（9行目がヘッダー、10行目からデータ）
- **期間の取得:** 5行目「集計期間: 全期間で集計 YYYY-MM-DD - YYYY-MM-DD」を正規表現でパース
  - パターン: `集計期間:.*?(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})`
  - ※「計測期間」という列名はデータ行に存在しない

- **主要列名（実際の列名）:**
  | 用途 | 列名 |
  |------|------|
  | 日付 | `日付`（形式: 2026年05月24日〜2026年05月30日）|
  | 商品管理番号 | `商品管理番号` |
  | クリック数 | `クリック数(合計)` |
  | 広告費 | `実績額(合計)` |
  | 売上金額 | `売上金額(合計720時間)` ★12時間版ではなく720時間を使う |
  | 売上件数 | `売上件数(合計720時間)` |
  | CVR | `CVR(合計720時間)(%)` |
  | ROAS | `ROAS(合計720時間)(%)` |

---

### ② 商品分析レポート（月次）
- **文字コード:** UTF-8 BOM付き（utf-8-sig）
- **skiprows:** 5（6行目がヘッダー、7行目からデータ）
- **期間の取得:** 3行目「表示期間,2026年05月から2026年05月」をパース
  - パターン: `表示期間,(\d{4})年(\d{2})月から`

- **主要列名（実際の列名）:**
  | 用途 | 列名 |
  |------|------|
  | 商品管理番号 | `商品管理番号`（RPPとの結合キー）|
  | 商品名 | `商品名` |
  | ジャンル | `ジャンル`（例: 靴 > 靴ケア用品 > 靴ひも）|
  | 売上 | `売上` |
  | 売上件数 | `売上件数` |
  | アクセス人数 | `アクセス人数` |
  | ユニークユーザー数 | `ユニークユーザー数` |
  | 転換率 | `転換率`（形式: "13.45%" → float変換時に%を除去）|
  | 客単価 | `客単価` |
  | 在庫数 | `在庫数` |
  | 在庫0日日数 | `在庫0日日数` |

---

### 両レポートの結合キー
- RPP `商品管理番号` ＝ 商品分析 `商品管理番号`（例: fs01, ns01）

### よくある間違い（禁止事項）
1. RPPの売上に `売上金額(合計12時間)` を使わない → 必ず `720時間`
2. RPPの期間を列から取得しない → 必ず5行目からパース
3. 商品分析をShift-JISで読まない → utf-8-sig
4. 商品分析の転換率をそのままfloat変換しない → %除去してから変換
5. skiprowsをRPP/商品分析で混同しない → RPP=8、商品分析=5
