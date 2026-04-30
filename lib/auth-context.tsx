'use client'

import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabaseClient, isSupabaseConfigured } from './supabase-client'

// Stable singleton — safe outside the component tree
const supabase = getSupabaseClient()

// 30-day inactivity threshold (ms)
const INACTIVITY_LIMIT_MS = 30 * 24 * 60 * 60 * 1000

/** Races a promise against a timeout. Throws if the timeout fires first. */
function withTimeout<T>(p: Promise<T>, ms = 15000, msg = 'Request timed out — please check your connection and try again.'): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
  ])
}
const LAST_ACTIVITY_KEY = 'canteen_last_activity'

function recordActivity() {
  try { localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now())) } catch { /* SSR safe */ }
}

function isInactive(): boolean {
  try {
    const raw = localStorage.getItem(LAST_ACTIVITY_KEY)
    if (!raw) return false // first visit — not inactive
    return Date.now() - Number(raw) > INACTIVITY_LIMIT_MS
  } catch { return false }
}

// ============================================================
// Profile cache — stale-while-revalidate, sessionStorage, 5-min TTL
// Eliminates the DB round-trip on every page navigation for returning users.
// ============================================================
const PROFILE_CACHE_KEY = 'canteen_profile_v1'

function getCachedProfile(userId: string): Partial<AuthUser> | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY)
    if (!raw) return null
    const { uid, data, ts } = JSON.parse(raw)
    if (uid !== userId) return null
    // 24h TTL — role/canteen rarely change. Keeps refreshes instant and avoids
    // the role-flicker bug where a slow fetchProfile returned the 'user' fallback,
    // downgrading admins/vendors to students for ~1s after refresh.
    if (Date.now() - ts > 24 * 60 * 60 * 1000) return null
    return data as Partial<AuthUser>
  } catch { return null }
}

function setCachedProfile(userId: string, data: Partial<AuthUser>) {
  try {
    // Strip the internal _resolved flag before persisting — it is only meaningful
    // in-memory while the auth provider decides whether to trust a fetchProfile result.
    const { _resolved, ...persist } = data as Partial<AuthUser> & { _resolved?: boolean }
    void _resolved
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ uid: userId, data: persist, ts: Date.now() }))
  } catch { /* SSR safe */ }
}

function clearProfileCache() {
  try { localStorage.removeItem(PROFILE_CACHE_KEY) } catch { /* SSR safe */ }
}

// ============================================================
// Types
// ============================================================
export type UserRole =
  | 'user'
  | 'canteen_admin'
  | 'vendor'
  | 'worker'
  | 'super_admin'
  | 'co_admin'
  | null

export interface AuthUser {
  uid: string
  email: string | null
  displayName: string | null
  role: UserRole
  phone?: string | null
  username?: string | null
  walletBalance: number
  mustChangePassword?: boolean
  hasPassword?: boolean
  /** Set for vendor / canteen_admin / worker; null for students. Without this,
   * the vendor dashboard treats the user as "demo" and skips every PATCH/POST,
   * which manifests as "can't toggle / can't add menu items / can't view bins". */
  canteenId?: string | null
}

interface AuthContextValue {
  user: AuthUser | null
  session: Session | null
  loading: boolean
  // Concurrent-session state — set when another session is detected on login
  concurrentSession: { existingDevice: string; sessionId: string } | null
  clearConcurrentSession: () => void
  forceLogoutAllSessions: () => Promise<void>
  logout: () => Promise<void>
  sendEmailOtp: (email: string) => Promise<void>
  sendPasswordResetOtp: (email: string) => Promise<void>
  verifyEmailOtp: (email: string, token: string) => Promise<void>
  linkEmail: (email: string) => Promise<void>
  verifyEmailLink: (email: string, token: string) => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<void>
  signInWithIdentifier: (identifier: string, password: string) => Promise<void>
  signUp: (
    email: string,
    password: string,
    metadata?: Record<string, unknown>
  ) => Promise<void>
  resetPassword: (email: string) => Promise<void>
}

// ============================================================
// Context
// ============================================================
const AuthContext = createContext<AuthContextValue | null>(null)

// ============================================================
// Helpers
// ============================================================
async function fetchProfile(userId: string): Promise<Partial<AuthUser>> {
  try {
    // 10s timeout (was 3s) — slow Supabase regions + cellular cold-start
    // were hitting the 3s ceiling and returning the role='user' fallback,
    // which downgraded vendors/admins to the student dashboard on refresh.
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Profile fetch timed out')), 10000)
    )
    const query = supabase.from('profiles').select('name, role, wallet_balance, phone, username, canteen_id').eq('id', userId).single()
    const { data } = await Promise.race([query, timeoutPromise])
    let canteenId: string | null = data?.canteen_id ?? null
    const role = (data?.role as UserRole) ?? 'user'
    // Mirror the server-side self-heal in lib/authServer.ts: vendor / canteen_admin /
    // worker accounts created without a canteen assignment would otherwise leave the
    // client with canteenId=null forever, breaking views (e.g. Bin Management) that
    // gate on it. Resolve the first available canteen and backfill the profile.
    if (!canteenId && (role === 'vendor' || role === 'canteen_admin' || role === 'worker')) {
      try {
        const { data: firstCanteen } = await supabase
          .from('canteens')
          .select('id')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        if (firstCanteen?.id) {
          canteenId = firstCanteen.id
          await supabase.from('profiles').update({ canteen_id: canteenId }).eq('id', userId)
            .then(() => undefined, () => undefined)
        }
      } catch { /* best-effort */ }
    }
    return {
      displayName: data?.name ?? null,
      role,
      walletBalance: data?.wallet_balance ?? 0,
      phone: data?.phone ?? null,
      username: data?.username ?? null,
      canteenId,
      // Mark this profile as authoritative so callers can distinguish a real
      // student profile from the error-fallback below.
      _resolved: true,
    } as Partial<AuthUser> & { _resolved?: boolean }
  } catch {
    // _resolved=false signals to the auth provider: do NOT trust this role.
    // It will be merged with whatever role we've already confirmed (roleRef)
    // or with the JWT user_metadata.role as a last-resort fallback.
    return { walletBalance: 0, _resolved: false } as Partial<AuthUser> & { _resolved?: boolean }
  }
}

function buildAuthUser(
  id: string,
  email: string | undefined,
  profile: Partial<AuthUser>
): AuthUser {
  return {
    uid: id,
    email: email ?? null,
    displayName: profile.displayName ?? null,
    role: profile.role ?? 'user',
    phone: profile.phone ?? null,
    username: profile.username ?? null,
    walletBalance: profile.walletBalance ?? 0,
    mustChangePassword: profile.mustChangePassword ?? false,
    hasPassword: profile.hasPassword ?? false,
    canteenId: profile.canteenId ?? null,
  }
}

// ============================================================
// Provider
// ============================================================
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [concurrentSession, setConcurrentSession] = useState<{ existingDevice: string; sessionId: string } | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  // Tracks the last successfully resolved role so TOKEN_REFRESHED can't downgrade a
  // privileged user when fetchProfile fails or times out during a background token renewal.
  const roleRef = useRef<UserRole>(null)

  // Declared before useEffect to satisfy React Compiler linting (hoisted at runtime)
  async function registerSession(token: string) {
    if (!isSupabaseConfigured()) return
    try {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (data.alreadyActive) {
        setConcurrentSession({ existingDevice: data.existingDevice, sessionId: data.sessionId })
      } else {
        activeSessionIdRef.current = data.sessionId ?? null
        setConcurrentSession(null)
      }
    } catch { /* network — ignore, don't block login */ }
  }

  useEffect(() => {
    // If Supabase env vars are placeholders (not real credentials), skip the
    // getSession() call entirely — it would hang indefinitely on an invalid host
    // and freeze the login page spinner.
    if (!isSupabaseConfigured()) {
      setLoading(false)
      return
    }

    // Safety timeout: if Supabase is unreachable, stop the spinner after 5s.
    // We avoid a tighter timeout because on slow mobile networks (cellular cold-start,
    // bridge tunnels, etc.) the legitimate getSession() round-trip can take ~2-3s, and a
    // shorter cutoff caused student sessions to be misread as "logged out" on navigation.
    const fallback = setTimeout(() => setLoading(false), 5000)

    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        clearTimeout(fallback)

        // 30-day inactivity check — hard sign out, user must re-authenticate
        if (session?.user && isInactive()) {
          await supabase.auth.signOut()
          setUser(null)
          setSession(null)
          setLoading(false)
          return
        }

        if (session?.user) recordActivity()

        setSession(session)
        if (session?.user) {
          const meta = session.user.user_metadata ?? {}
          const hasPassword = meta.has_password === true
          const pwChangedAt: string | undefined = meta.password_changed_at
          // 30-day password expiry — checked from JWT metadata (zero extra DB calls)
          if (hasPassword && pwChangedAt &&
            Date.now() - new Date(pwChangedAt).getTime() > 30 * 24 * 60 * 60 * 1000) {
            await supabase.auth.signOut()
            setUser(null)
            setSession(null)
            try { localStorage.setItem('canteen_pw_expired', '1') } catch { /* SSR */ }
            setLoading(false)
            return
          }
          const mustChangePassword = meta.must_change_password === true
          // Stale-while-revalidate: serve cached profile instantly, refresh DB in background.
          // Eliminates the 0.5-2s DB round-trip on every page load for returning users.
          const cached = getCachedProfile(session.user.id)
          if (cached) {
            const builtUser = buildAuthUser(session.user.id, session.user.email, { ...cached, mustChangePassword, hasPassword })
            roleRef.current = builtUser.role
            setUser(builtUser)
            setLoading(false)
            // Silently refresh profile in background so stale data doesn't persist.
            // Guard: a transient fetchProfile error returns _resolved=false; never downgrade an
            // already-resolved privileged role here — it would bounce admins/vendors to /login
            // and trigger a redirect-loop flicker between dashboards.
            fetchProfile(session.user.id).then(fresh => {
              const f = fresh as Partial<AuthUser> & { _resolved?: boolean }
              if (f._resolved === false) return // network blip — keep cached profile
              const prevRole = roleRef.current
              const safeRole: UserRole = (
                f.role === 'user' && prevRole !== null && prevRole !== 'user'
              ) ? prevRole : (f.role ?? 'user')
              const safeFresh = { ...f, role: safeRole }
              setCachedProfile(session.user.id, safeFresh)
              const updated = buildAuthUser(session.user.id, session.user.email, { ...safeFresh, mustChangePassword, hasPassword })
              if (updated.role === prevRole && updated.canteenId === roleRef.current) return
              roleRef.current = updated.role
              setUser(updated)
            }).catch(() => {})
          } else {
            const profile = await fetchProfile(session.user.id) as Partial<AuthUser> & { _resolved?: boolean }
            // If profile fetch failed (timeout / network), do NOT downgrade to 'user'.
            // Use the role embedded in the Supabase JWT user_metadata as a fallback,
            // since super_admin / canteen_admin / vendor accounts are seeded with metadata.role.
            // This is what fixes the "refresh → student login flicker → vendor dashboard" bug.
            let resolvedProfile = profile
            if (profile._resolved === false) {
              const metaRole = (session.user.user_metadata?.role as UserRole) ?? null
              resolvedProfile = { ...profile, role: metaRole ?? 'user' }
            }
            // Only persist authoritative profiles — unresolved fallbacks would poison the cache.
            if (profile._resolved !== false) setCachedProfile(session.user.id, resolvedProfile)
            const builtUser = buildAuthUser(session.user.id, session.user.email, { ...resolvedProfile, mustChangePassword, hasPassword })
            roleRef.current = builtUser.role
            setUser(builtUser)
            setLoading(false)
            // Background retry: if we used the JWT-metadata fallback above, schedule a single
            // retry to upgrade canteenId / displayName once the network is healthy.
            if (profile._resolved === false) {
              setTimeout(() => {
                fetchProfile(session.user.id).then(retry => {
                  const r = retry as Partial<AuthUser> & { _resolved?: boolean }
                  if (r._resolved === false) return
                  setCachedProfile(session.user.id, r)
                  const updated = buildAuthUser(session.user.id, session.user.email, { ...r, mustChangePassword, hasPassword })
                  roleRef.current = updated.role
                  setUser(updated)
                }).catch(() => {})
              }, 2000)
            }
          }
          registerSession(session.access_token).catch(() => {})
        } else {
          setLoading(false)
        }
      })
      .catch(() => {
        clearTimeout(fallback)
        setLoading(false)
      })

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) recordActivity()
      setSession(session)
      // Dedupe: INITIAL_SESSION fires after getSession() already populated the user.
      // Re-fetching the profile here can race with the bg refresh above and briefly
      // downgrade roles, causing a redirect-loop flicker between dashboards.
      if (event === 'INITIAL_SESSION' && session?.user && roleRef.current !== null) {
        setLoading(false)
        return
      }
      if (session?.user) {
        // Snapshot existing role BEFORE the async profile fetch.
        // If fetchProfile times out or errors and returns the 'user' fallback, we use this
        // to restore the real role — prevents TOKEN_REFRESHED from silently demoting an admin.
        const existingRole = roleRef.current
        const meta = session.user.user_metadata ?? {}
        const hasPassword = meta.has_password === true
        const pwChangedAt: string | undefined = meta.password_changed_at
        // 30-day password expiry — hard sign out
        if (hasPassword && pwChangedAt &&
          Date.now() - new Date(pwChangedAt).getTime() > 30 * 24 * 60 * 60 * 1000) {
          await supabase.auth.signOut()
          setUser(null)
          roleRef.current = null
          setSession(null)
          try { localStorage.setItem('canteen_pw_expired', '1') } catch { /* SSR */ }
          setLoading(false)
          return
        }
        const mustChangePassword = meta.must_change_password === true
        // TOKEN_REFRESHED fires every ~55 min — profile hasn't changed, use cache to skip DB.
        const cached = event === 'TOKEN_REFRESHED' ? getCachedProfile(session.user.id) : null
        if (cached) {
          const safeRole: UserRole = (
            cached.role === 'user' && existingRole !== null && existingRole !== 'user'
          ) ? existingRole : (cached.role ?? 'user')
          const builtUser = buildAuthUser(session.user.id, session.user.email, { ...cached, role: safeRole, mustChangePassword, hasPassword })
          roleRef.current = builtUser.role
          setUser(builtUser)
          setLoading(false)
          return
        }
        const profile = await fetchProfile(session.user.id) as Partial<AuthUser> & { _resolved?: boolean }
        // Same defence as the cold-start path: if profile fetch failed, prefer the
        // previously-confirmed roleRef, then the JWT user_metadata.role, never silently 'user'.
        let resolvedProfile = profile
        if (profile._resolved === false) {
          const metaRole = (session.user.user_metadata?.role as UserRole) ?? null
          const fallbackRole = existingRole ?? metaRole ?? 'user'
          resolvedProfile = { ...profile, role: fallbackRole }
        }
        if (profile._resolved !== false) setCachedProfile(session.user.id, resolvedProfile)
        // Guard: if fetchProfile returned the error-fallback role ('user') but we previously
        // confirmed a privileged role for this same session, keep the privileged role.
        // This prevents a transient DB timeout from kicking an admin to the student dashboard.
        const safeRole: UserRole = (
          resolvedProfile.role === 'user' &&
          existingRole !== null &&
          existingRole !== 'user'
        ) ? existingRole : (resolvedProfile.role ?? 'user')
        const builtUser = buildAuthUser(session.user.id, session.user.email, { ...resolvedProfile, role: safeRole, mustChangePassword, hasPassword })
        roleRef.current = builtUser.role
        setUser(builtUser)
        // Only register a new active_sessions row on actual new logins, not background token refreshes.
        if (event === 'SIGNED_IN') {
          registerSession(session.access_token).catch(() => {})
        }
      } else {
        setUser(null)
        roleRef.current = null
        activeSessionIdRef.current = null
        clearProfileCache()
      }
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Session heartbeat — keep active_sessions table up to date every 5 minutes
  useEffect(() => {
    if (!session?.access_token || !activeSessionIdRef.current) return
    const interval = setInterval(() => {
      fetch('/api/auth/session', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSessionIdRef.current }),
      }).catch(() => {})
    }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [session?.access_token])

  // ---- Session helpers ----

  function clearConcurrentSession() {
    setConcurrentSession(null)
  }

  async function forceLogoutAllSessions() {
    if (!session?.access_token) return
    try {
      const res = await fetch('/api/auth/session', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const data = await res.json()
      activeSessionIdRef.current = data.sessionId ?? null
      setConcurrentSession(null)
    } catch { /* ignore */ }
  }

  // ---- Auth methods ----

  async function logout() {
    try { localStorage.removeItem(LAST_ACTIVITY_KEY) } catch { /* SSR safe */ }
    clearProfileCache()
    // Mark session as inactive before signing out (fire-and-forget)
    if (session?.access_token && activeSessionIdRef.current) {
      fetch('/api/auth/session', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSessionIdRef.current, markInactive: true }),
      }).catch(() => {})
    }
    activeSessionIdRef.current = null
    // Clear UI state immediately — callers can navigate without waiting for the SIGNED_OUT event
    setUser(null)
    roleRef.current = null
    setSession(null)
    // Step 1: ALWAYS clear the local Supabase session from browser storage.
    // This is synchronous-safe (just localStorage.removeItem) and must succeed even when
    // the network is unreachable. Without this, a failed global signOut leaves the JWT
    // token in localStorage and the session is silently restored on the next page load.
    try { await supabase.auth.signOut({ scope: 'local' }) } catch { /* ignore */ }
    // Step 2: Best-effort global revocation — invalidates the token server-side.
    // Fire-and-forget: network errors must never block the caller from navigating away.
    supabase.auth.signOut().catch(() => {})
  }

  /** Maps well-known demo emails to a role; all others → 'user'. */
  function demoRoleFor(email: string | null): UserRole {
    if (email === 'admin@canteen.app')   return 'super_admin'
    if (email === 'canteen@canteen.app') return 'canteen_admin'
    if (email === 'vendor@canteen.app')  return 'vendor'
    return 'user'
  }

  async function sendEmailOtp(email: string) {
    if (!isSupabaseConfigured()) return  // demo mode — pretend OTP sent
    const { error } = await withTimeout(
      supabase.auth.signInWithOtp({
        email,
        options: {
          // No redirect — user enters the 6-digit OTP only.
          // This avoids magic-link expiry issues on different devices.
          shouldCreateUser: true,
        },
      })
    )
    if (error) throw error
  }

  /** Forgot-password OTP — sends 6-digit code ONLY to existing accounts.
   *  Used by all roles (super_admin, co_admin, canteen_admin, vendor, worker, user)
   *  so they can reset their own password without contacting the super admin. */
  async function sendPasswordResetOtp(email: string) {
    if (!isSupabaseConfigured()) return
    const { error } = await withTimeout(
      supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      })
    )
    if (error) {
      const raw = (error.message ?? '').toLowerCase()
      if (raw.includes('signups not allowed') || raw.includes('user not found') || raw.includes('not found')) {
        throw new Error('No account found with that email. Please check the address or contact your super admin.')
      }
      throw error
    }
  }

  async function verifyEmailOtp(email: string, token: string) {
    if (!isSupabaseConfigured()) {
      const role = demoRoleFor(email)
      const name = role === 'super_admin' ? 'Admin (Demo)' : role === 'canteen_admin' ? 'Canteen (Demo)' : 'Student (Demo)'
      setUser(buildAuthUser('demo-user', email, { role, displayName: name, walletBalance: 100 }))
      return
    }
    const { error } = await withTimeout(
      supabase.auth.verifyOtp({ email, token, type: 'email' })
    )
    if (error) throw error
  }

  async function linkEmail(email: string) {
    const { error } = await withTimeout(
      supabase.auth.updateUser({ email })
    )
    if (error) throw error
  }

  async function verifyEmailLink(email: string, token: string) {
    const { error } = await withTimeout(
      supabase.auth.verifyOtp({ email, token, type: 'email_change' })
    )
    if (error) throw error
  }

  async function signInWithPassword(email: string, password: string) {
    if (!isSupabaseConfigured()) {
      const role = demoRoleFor(email)
      const name = role === 'super_admin' ? 'Admin (Demo)' : role === 'canteen_admin' ? 'Canteen (Demo)' : role === 'vendor' ? 'Vendor (Demo)' : 'Student (Demo)'
      setUser(buildAuthUser('demo-user', email, { role, displayName: name, walletBalance: 100, hasPassword: true }))
      return
    }
    const { error } = await withTimeout(
      supabase.auth.signInWithPassword({ email, password })
    )
    if (error) throw error
  }

  /** Sign in with phone number, email, or @username + password.
   *  - Phone  → Supabase phone+password directly
   *  - Email  → Supabase email+password directly
   *  - Username → POST /api/auth/resolve-username → get email → Supabase email+password */
  async function signInWithIdentifier(identifier: string, password: string) {
    if (!isSupabaseConfigured()) {
      const id = identifier.trim()
      const role = demoRoleFor(id.includes('@') ? id : null)
      const name = role === 'super_admin' ? 'Admin (Demo)' : role === 'canteen_admin' ? 'Canteen (Demo)' : 'Student (Demo)'
      setUser(buildAuthUser('demo-user', id.includes('@') ? id : undefined, { role, displayName: name, walletBalance: 100, hasPassword: true }))
      return
    }
    // Strip leading @ if user typed @username
    const id = identifier.trim().replace(/^@/, '')
    const isPhone = /^\+?[\d\s\-()]{7,}$/.test(id) && !id.includes('@')
    const isEmail = id.includes('@')

    if (isPhone) {
      const digits = id.replace(/\D/g, '')
      const e164 = digits.length === 10 ? `+91${digits}` :
                   digits.length === 12 && digits.startsWith('91') ? `+${digits}` : `+${digits}`
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ phone: e164, password })
      )
      if (error) throw error
    } else if (isEmail) {
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ email: id, password })
      )
      if (error) throw error
    } else {
      // Username login — resolve to email via server-side lookup
      const res = await withTimeout(
        fetch('/api/auth/resolve-username', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: id.toLowerCase() }),
        }),
        10000,
        'Username lookup timed out. Check your connection and try again.'
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'No account found with that username.')
      }
      const { email } = await res.json()
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password })
      )
      if (error) throw error
    }
  }

  async function signUp(
    email: string,
    password: string,
    metadata?: Record<string, unknown>
  ) {
    const redirectTo = typeof window !== 'undefined'
      ? `${window.location.origin}/auth/confirm`
      : undefined
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: metadata, emailRedirectTo: redirectTo },
    })
    if (error) throw error
  }

  async function resetPassword(email: string) {
    const origin = typeof window !== 'undefined'
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_APP_URL ?? '')
    const { error } = await withTimeout(
      supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin}/auth/reset-password`,
      })
    )
    if (error) throw error
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        concurrentSession,
        clearConcurrentSession,
        forceLogoutAllSessions,
        logout,
        sendEmailOtp,
        sendPasswordResetOtp,
        verifyEmailOtp,
        linkEmail,
        verifyEmailLink,
        signInWithPassword,
        signInWithIdentifier,
        signUp,
        resetPassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// ============================================================
// Hook
// ============================================================
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
