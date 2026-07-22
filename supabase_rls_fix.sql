-- ============================================================
-- Supabase セキュリティ修正: RLS（行レベルセキュリティ）を有効化
-- 対象プロジェクト: sellerhub (yxkylmoqibmcsqtgdxkf)
-- ============================================================
--
-- 【何が起きているか】
-- SQLAlchemy の Base.metadata.create_all() で作成したテーブルは
-- RLS が無効のまま public スキーマに置かれる。Supabase は public スキーマを
-- Data API (PostgREST) 経由で公開するため、フロントに埋め込まれた anon キー
-- （公開が前提の値）だけで、誰でも全データを読み書きできる状態だった。
--
-- 【なぜこれで直るか】
-- RLS を有効にすると、ポリシーが1つも無いテーブルへの anon / authenticated
-- ロールからのアクセスは全て拒否される。
-- 一方このアプリのバックエンド(FastAPI)は DATABASE_URL でテーブル所有者
-- （postgres ロール）として直接接続しており、所有者は RLS をバイパスするため
-- 影響を受けない。つまり「Data API だけ塞ぎ、アプリはそのまま動く」。
--
-- 【実行方法】
-- Supabase ダッシュボード → SQL Editor に貼り付けて Run。
-- 実行後、アプリのログインとダッシュボード表示が正常なことを必ず確認する。
--
-- 【元に戻す場合】
-- ALTER TABLE public.<テーブル名> DISABLE ROW LEVEL SECURITY;
-- ============================================================

-- 業務データ（売上・広告実績・目標など）
ALTER TABLE public.rpp_weekly          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rpp_sales           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_item_sales  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_analysis    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.targets             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_status    ENABLE ROW LEVEL SECURITY;

-- アクション・提案の記録
ALTER TABLE public.action_checks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rpp_action_checks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_logs         ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 確認用: RLS が有効になったかを一覧する
-- 全テーブルの rls_enabled が true になっていれば完了
-- ============================================================
SELECT tablename,
       rowsecurity AS rls_enabled
FROM   pg_tables
WHERE  schemaname = 'public'
ORDER  BY tablename;
