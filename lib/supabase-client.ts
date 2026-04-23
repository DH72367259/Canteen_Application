import { createBrowserClient } from '@supabase/ssr'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

/** Returns true only when both env vars look like real Supabase credentials. */
export function isSupabaseConfigured(): boolean {
  return (
    SUPABASE_URL.startsWith('https://') &&
    !SUPABASE_URL.includes('your-project') &&
    !SUPABASE_URL.includes('placeholder') &&
    SUPABASE_ANON_KEY.length > 20 &&
    SUPABASE_ANON_KEY !== 'your-anon-key' &&
    !SUPABASE_ANON_KEY.includes('placeholder')
  )
}

export function createClient() {
  return createBrowserClient(
    SUPABASE_URL || 'https://placeholder.supabase.co',
    SUPABASE_ANON_KEY || 'placeholder-anon-key'
  )
}

// Singleton for use in client components
let client: ReturnType<typeof createClient> | null = null

export function getSupabaseClient() {
  if (!client) client = createClient()
  return client
}
