# ─── ステージ1: フロントエンド(React/Vite)をビルド ───────────────
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
# Supabase の公開設定はビルド時に Vite が埋め込む（VITE_ 接頭辞）。
# Render はサービスの環境変数を Docker ビルド引数として自動で渡す。
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build

# ─── ステージ2: バックエンド(FastAPI)実行イメージ ────────────────
FROM python:3.12-slim
WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
# ステージ1のビルド成果物を frontend/dist に配置（main.py が ../frontend/dist を配信）
COPY --from=frontend /app/frontend/dist ./frontend/dist

WORKDIR /app/backend

# ホスティング各社は $PORT を注入する（未設定時は8000）。shell形式で展開する。
ENV PORT=8000
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT}
