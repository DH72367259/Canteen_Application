import { createAdminClient } from './supabase-server'
import type { UserRole } from '@/types/canteen'

export interface RequestContext {
  uid: string
  role: UserRole
  canteenId?: string
  email?: string
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

  return {
    uid:       user.id,
    role:      (profileData?.role ?? 'user') as UserRole,
    canteenId: profileData?.canteen_id,
    email:     user.email,
  }
}
