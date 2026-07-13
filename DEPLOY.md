# デプロイ手順（Render + Supabase + ログイン認証）

レビュアーに **1つのURL＋アカウントログイン** で使ってもらうための手順です。

- フロント(React)とバック(FastAPI)を **Render の1サービス** にまとめてデプロイ（`Dockerfile` がフロントをビルドして同梱）。
- **DB は Supabase Postgres**（永続化）、**ログインは Supabase Auth（メール＋パスワード）**。
- 現状は「**ログインで保護＋データは全員共有**」。将来、各テーブルに `user_id` を足せばユーザー別データに拡張できる設計（認証基盤は導入済み）。

---

## 全体像

```
[ブラウザ] → ログイン(Supabase Auth) → [Render: FastAPI + ビルド済みReact]
                                              ├ DB:   Supabase Postgres
                                              └ 認証: JWTをバックエンドで検証
```

ローカル開発（`start.bat`）は `SUPABASE_*` を設定しなければ**認証無効・SQLite**のまま従来どおり動きます。

---

## ステップ1: Supabase プロジェクト作成

1. https://supabase.com で新規プロジェクトを作成（リージョンは Tokyo 推奨）。
2. **Project Settings → API** から以下を控える:
   - `Project URL`         → `VITE_SUPABASE_URL`
   - `anon public` キー    → `VITE_SUPABASE_ANON_KEY`
   - `JWT Secret`          → `SUPABASE_JWT_SECRET`
3. **Project Settings → Database → Connection string → URI** を控え、**psycopg形式に変換**:
   - 例: `postgresql://postgres.xxxx:PASS@aws-0-...pooler.supabase.com:5432/postgres`
   - → 先頭を `postgresql+psycopg://` に変え、末尾に `?sslmode=require` を付けて `DATABASE_URL` にする。
4. **Authentication → Providers → Email** を有効化（既定で有効）。レビュアー用アカウントは
   **Authentication → Users → Add user** で発行するか、ログイン画面の「アカウント作成」から登録してもらう。
   - すぐ使ってもらうなら **Email confirmations をオフ**にしておくと確認メール不要で即ログインできる。

> テーブルはバックエンド起動時に自動作成されます（`Base.metadata.create_all`）。Supabase側の事前作業は不要。

## ステップ2: GitHubへ上げる

```powershell
cd C:\Users\user\rakuten-kpi-app
git init
git add .
git commit -m "Deploy: Render + Supabase + auth"
git remote add origin https://github.com/<あなた>/<リポジトリ名>.git
git branch -M main
git push -u origin main
```
`.gitignore` で `node_modules` / `*.db` / `dist` / `.env` は除外済み。シークレットはコードに含めません。

## ステップ3: Render でデプロイ

1. https://render.com に登録 → GitHub連携。
2. **New → Blueprint** でこのリポジトリを選択（`render.yaml` が読まれる）。
3. 環境変数（`sync:false` のもの）をダッシュボードで設定:
   - `DATABASE_URL`           = ステップ1-3 の psycopg 接続文字列
   - `SUPABASE_JWT_SECRET`    = ステップ1-2 の JWT Secret
   - `VITE_SUPABASE_URL`      = ステップ1-2 の Project URL
   - `VITE_SUPABASE_ANON_KEY` = ステップ1-2 の anon public キー
   - `SUPABASE_SERVICE_ROLE_KEY` = Supabase: Settings → API → `service_role` キー
     （**アカウント削除（退会）機能に必要**。全権限キーなのでサーバー環境変数にのみ設定し、絶対にフロントへ渡さない）
   - `LEGACY_DATA_USER_ID`（任意・一度だけ）= マルチテナント化以前に登録した既存データを
     引き継ぐユーザーのUUID（Supabase: Authentication → Users で確認）。
     起動時に user_id が未設定の行をこのユーザーに割り当てる。移行が済んだら消してよい。
4. デプロイ完了後の `https://rakuten-kpi-app-xxxx.onrender.com` をレビュアーに渡す。

> `SUPABASE_JWT_SECRET` を設定すると全APIがログイン必須になります（未設定だと認証無効なので、本番では必ず設定）。
> `VITE_*` はフロントのビルド時に埋め込まれるため、**変更したら再デプロイ**が必要です。

## ステップ4: レビュアーに共有

- URL とログイン情報（メール＋パスワード）を伝える。
- **データはユーザーごとに分離**されている（マルチテナント）。レビュアーは自分のアカウントで
  サインアップし、自分でデータを取込む（他ユーザーのデータは見えない）。

---

## ローカルでDocker本番構成を試す（任意）

```powershell
cd C:\Users\user\rakuten-kpi-app
docker build -t rakuten-kpi `
  --build-arg VITE_SUPABASE_URL=<url> `
  --build-arg VITE_SUPABASE_ANON_KEY=<anon> .
docker run -p 8000:8000 `
  -e DATABASE_URL="postgresql+psycopg://..." `
  -e SUPABASE_JWT_SECRET="<jwt secret>" `
  rakuten-kpi
# → http://localhost:8000
```

## 変更点まとめ（この対応で追加した実装）

- `backend/auth.py`：Supabase JWT(HS256)を検証する `get_current_user`。`SUPABASE_JWT_SECRET` 未設定なら認証無効（ローカル開発）。
- `backend/main.py`：全 `/api` ルーターと主要エンドポイントをログイン必須に（`/api/health` は公開）。
- `backend/database.py`：`DATABASE_URL` で SQLite ⇄ Postgres を切替（psycopg 同梱）。
- フロント：`src/lib/supabase.ts`（クライアント）、`src/pages/Login.tsx`（ログイン画面）、`App.tsx` でセッションゲート、`api.ts` で全リクエストにアクセストークンを自動付与、サイドバーにログアウト。
- `Dockerfile`：`VITE_SUPABASE_*` をビルド時に埋め込み。
