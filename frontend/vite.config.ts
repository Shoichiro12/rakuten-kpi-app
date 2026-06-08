import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Windows では Node が "localhost" を IPv6(::1) に先に解決するため、Vite が
    // ::1 だけにbindしてしまうと、ブラウザの IPv4(127.0.0.1) アクセスが接続拒否になり
    // 「localhost:5173 が開けない」状態になる。IPv4 に明示bindして決定的にする。
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        // Use 127.0.0.1 (not "localhost"): on Windows + Node 18+, "localhost"
        // resolves to IPv6 ::1 first, but uvicorn binds IPv4 127.0.0.1 — the
        // proxy then relies on a slow IPv6→IPv4 fallback that can surface as
        // "Failed to fetch". Pinning to IPv4 makes the connection deterministic.
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
