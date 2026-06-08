import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// 本番では Render の環境変数（ビルド時に Vite が埋め込む）から供給する。
// ローカル開発で未設定なら supabase=null（=認証無効）となり、従来どおりログイン無しで動く。
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null

/** 認証が有効か（Supabase設定が存在するか）。false ならログイン画面を出さない。 */
export const authEnabled = supabase !== null

/** 現在のセッションのアクセストークン（JWT）。未ログイン/認証無効なら null。 */
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}
