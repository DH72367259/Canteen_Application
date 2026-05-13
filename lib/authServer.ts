import { createAdminClient } from './supabase-server'
import type { UserRole } from '@/types/canteen'

export interface RequestContext {
  uid: string
  role: UserRole
  canteenId?: string
  email?: string
}

// ── Server-side auth cache ─────────────────────────────────────────────────
// Caches the result of supabase.auth.getUser(token) + profile lookup so
// repeated calls from the same browser session (stats polling, tab switches)
// don't hammer Supabase's remote auth API.  TTL is 4 minutes — well within
// the 1-hour Supabase JWT expiry.  Cache is keyed by the raw token so
// a new token (after refresh) always does a fresh verification.
interface CachedCtx { ctx: RequestContext; expiresAt: number }
const CTX_CACHE = new Map<string, CachedCtx>()
const CTX_TTL_MS = 4 * 60 * 1000

// Prune stale entries once per minute (prevents unbounded growth).
if (typeof global !== 'undefined' && !(global as Record<string, unknown>)['__authCachePruner']) {
  (global as Record<string, unknown>)['__authCachePruner'] = setInterval(() => {
    const now = Date.now()
    for (const [k, v] of CTX_CACHE) if (v.expiresAt < now) CTX_CACHE.delete(k)
  }, 60_000)
}

/** Decode JWT payload without verification to extract the `sub` claim.
 *  Used only to speculatively start a parallel DB query — the token is still
 *  verified by `supabase.auth.getUser()` before the context is trusted. */
function extractSubFromToken(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch { return null }
}

export async function getRequestContext(
  request: Request
): Promise<RequestContext | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)

  // Fast path: return cached context if it hasn't expired yet.
  const hit = CTX_CACHE.get(token)
  if (hit && hit.expiresAt > Date.now()) return hit.ctx

  const supabase = createAdminClient()

  // Speculatively decode the userId from the JWT so we can fire both calls in parallel.
  // The token is still cryptographically verified by getUser() — the decoded sub is only
  // used to start the profile query early. If the IDs don't match, we re-fetch.
  const specUserId = extractSubFromToken(token)

  const [userResult, profileResult] = await Promise.all([
    supabase.auth.getUser(token),
    specUserId
      ? supabase.from('profiles').select('role, canteen_id').eq('id', specUserId).single()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (userResult.error || !userResult.data.user) return null
  const user = userResult.data.user

  // Guard: if the verified user ID differs from specUserId (should never happen with a
  // valid JWT), re-fetch the profile to ensure we return the correct role.
  let profileData = profileResult.data
  if (specUserId !== user.id) {
    const { data } = await supabase
      .from('profiles')
      .select('role, canteen_id')
      .eq('id', user.id)
      .single()
    profileData = data
  }

  const role = (profileData?.role ?? 'user') as UserRole
  let canteenId: string | undefined = profileData?.canteen_id ?? undefined

  // Fallback: vendor / canteen_admin / worker without an assigned canteen would otherwise
  // hit a 400 "canteenId required" on every canteen-scoped endpoint. Resolve the first
  // available canteen and backfill the profile so subsequent calls hit the fast path.
  // We deliberately limit this to canteen-scoped roles — never elevate a normal student.
  if (!canteenId && (role === 'vendor' || role === 'canteen_admin' || role === 'worker')) {
    const { data: firstCanteen } = await supabase
      .from('canteens')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (firstCanteen?.id) {
      canteenId = firstCanteen.id
      // Backfill profile (best-effort; failure must not block the request).
      await supabase
        .from('profiles')
        .update({ canteen_id: canteenId })
        .eq('id', user.id)
        .then(() => undefined, () => undefined)
    }
  }

  const ctx: RequestContext = { uid: user.id, role, canteenId, email: user.email }

  // Cache for subsequent calls within the same session.
  CTX_CACHE.set(token, { ctx, expiresAt: Date.now() + CTX_TTL_MS })

  return ctx
}

/** Invalidate the cache entry for a token.
 *  Call after any mutation that changes the user's role or canteen assignment
 *  so the next request re-reads the profile from the DB. */
export function invalidateAuthCache(token: string): void {
  CTX_CACHE.delete(token)
}
