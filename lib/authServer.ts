import { createAdminClient } from './supabase-server'
import type { UserRole } from '@/types/canteen'

export interface RequestContext {
  uid: string
  role: UserRole
  canteenId?: string
  email?: string
}

export async function getRequestContext(
  request: Request
): Promise<RequestContext | null> {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)
  const supabase = createAdminClient()

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token)

  if (error || !user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, canteen_id')
    .eq('id', user.id)
    .single()

  return {
    uid:        user.id,
    role:       (profile?.role ?? 'user') as UserRole,
    canteenId:  profile?.canteen_id,
    email:      user.email,
  }
}
