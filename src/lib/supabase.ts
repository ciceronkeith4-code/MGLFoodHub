import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && key)

export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-anon-key', {
  // Only admins ever sign in; customers stay anonymous.
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'mgl_admin_auth' },
})

/** Turns a Supabase/PostgREST error into a friendly message. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!err) return fallback
  const msg = typeof err === 'string' ? err : (err as { message?: string }).message
  if (!msg) return fallback
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'No internet connection. Please check your signal and try again.'
  if (/JWT|permission denied|not authorized/i.test(msg)) return 'You are not allowed to do that.'
  return msg
}
