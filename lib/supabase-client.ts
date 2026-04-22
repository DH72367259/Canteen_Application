import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL    ?? 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key'
  )
}

// Singleton for use in client components
let client: ReturnType<typeof createClient> | null = null

export function getSupabaseClient() {
  if (!client) client = createClient()
  return client
}
