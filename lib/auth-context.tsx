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
  walletBalance: number
  mustChangePassword?: boolean
  hasPassword?: boolean
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
  verifyEmailOtp: (email: string, token: string) => Promise<void>
  sendPhoneOtp: (phone: string) => Promise<{ channels: string[] }>
  verifyPhoneOtp: (phone: string, token: string) => Promise<void>
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
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Profile fetch timed out')), 8000)
    )
    const query = supabase.from('profiles').select('name, role, wallet_balance, phone').eq('id', userId).single()
    const { data } = await Promise.race([query, timeoutPromise])
    return {
      displayName: data?.name ?? null,
      role: (data?.role as UserRole) ?? 'user',
      walletBalance: data?.wallet_balance ?? 0,
      phone: data?.phone ?? null,
    }
  } catch {
    return { role: 'user', walletBalance: 0 }
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
    walletBalance: profile.walletBalance ?? 0,
    mustChangePassword: profile.mustChangePassword ?? false,
    hasPassword: profile.hasPassword ?? false,
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

    // Safety timeout: if Supabase is unreachable, stop the spinner after 6s.
    // 6 s gives Railway cold-starts and slow networks enough time to respond before
    // the fallback fires and falsely treats an authenticated user as unauthenticated.
    const fallback = setTimeout(() => setLoading(false), 6000)

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
          const profile = await fetchProfile(session.user.id)
          const meta = session.user.user_metadata ?? {}
          const hasPassword = meta.has_password === true
          const pwChangedAt: string | undefined = meta.password_changed_at
          // 30-day password expiry — hard sign out the user, force re-login with new password
          if (hasPassword && pwChangedAt &&
            Date.now() - new Date(pwChangedAt).getTime() > 30 * 24 * 60 * 60 * 1000) {
            // Sign out and redirect to login with an expiry message
            await supabase.auth.signOut()
            setUser(null)
            setSession(null)
            try { localStorage.setItem('canteen_pw_expired', '1') } catch { /* SSR */ }
            setLoading(false)
            return
          }
          const mustChangePassword = meta.must_change_password === true
          const builtUser = buildAuthUser(session.user.id, session.user.email, { ...profile, mustChangePassword, hasPassword })
          // Keep roleRef in sync so onAuthStateChange can use it as a fallback
          roleRef.current = builtUser.role
          setUser(builtUser)
          // Register session (non-blocking — don't block UI on this)
          registerSession(session.access_token).catch(() => {})
        }
        setLoading(false)
      })
      .catch(() => {
        clearTimeout(fallback)
        setLoading(false)
      })

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) recordActivity()
      setSession(session)
      if (session?.user) {
        // Snapshot existing role BEFORE the async profile fetch.
        // If fetchProfile times out or errors and returns the 'user' fallback, we use this
        // to restore the real role — prevents TOKEN_REFRESHED from silently demoting an admin.
        const existingRole = roleRef.current

        const profile = await fetchProfile(session.user.id)
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
        // Guard: if fetchProfile returned the error-fallback role ('user') but we previously
        // confirmed a privileged role for this same session, keep the privileged role.
        // This prevents a transient DB timeout from kicking an admin to the student dashboard.
        const safeRole: UserRole = (
          profile.role === 'user' &&
          existingRole !== null &&
          existingRole !== 'user'
        ) ? existingRole : (profile.role ?? 'user')
        const builtUser = buildAuthUser(session.user.id, session.user.email, { ...profile, role: safeRole, mustChangePassword, hasPassword })
        roleRef.current = builtUser.role
        setUser(builtUser)
        registerSession(session.access_token).catch(() => {})
      } else {
        setUser(null)
        roleRef.current = null
        activeSessionIdRef.current = null
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

  async function sendPhoneOtp(phone: string): Promise<{ channels: string[] }> {
    if (!isSupabaseConfigured()) return { channels: ['demo'] }  // demo mode

    const channels: string[] = []

    // 1. Try WhatsApp via our server route (only active once WhatsApp Business is connected)
    //    If WhatsApp is enabled, Twilio Verify creates the verification via WhatsApp first.
    //    When Supabase subsequently calls Twilio Verify for SMS, Twilio keeps the SAME OTP code
    //    and re-delivers it via SMS (resend same active verification = same code, different channel).
    try {
      const res = await fetch('/api/auth/phone/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.whatsapp) channels.push('whatsapp')
      }
    } catch { /* WhatsApp API unavailable — continue to SMS */ }

    // 2. Supabase sends SMS via Twilio Verify (creates or resends same verification code)
    const { error } = await withTimeout(supabase.auth.signInWithOtp({ phone }))
    if (error) throw error
    channels.push('sms')

    return { channels }
  }

  async function verifyPhoneOtp(phone: string, token: string) {
    if (!isSupabaseConfigured()) {
      // Phone OTP is the student flow
      setUser(buildAuthUser('demo-user', undefined, { role: 'user', displayName: 'Student (Demo)', phone, walletBalance: 100 }))
      return
    }
    const { error } = await withTimeout(
      supabase.auth.verifyOtp({ phone, token, type: 'sms' })
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

  /** Sign in with email, phone number, or any string identifier.
   *  Detects whether the identifier is a phone (digits/+) or email. */
  async function signInWithIdentifier(identifier: string, password: string) {
    if (!isSupabaseConfigured()) {
      const id = identifier.trim()
      const role = demoRoleFor(id.includes('@') ? id : null)
      const name = role === 'super_admin' ? 'Admin (Demo)' : role === 'canteen_admin' ? 'Canteen (Demo)' : 'Student (Demo)'
      setUser(buildAuthUser('demo-user', id.includes('@') ? id : undefined, { role, displayName: name, walletBalance: 100, hasPassword: true }))
      return
    }
    const id = identifier.trim()
    const isPhone = /^\+?[\d\s\-()+]{7,}$/.test(id) && !id.includes('@')
    if (isPhone) {
      const digits = id.replace(/\D/g, '')
      const e164 = digits.length === 10 ? `+91${digits}` :
                   digits.length === 12 && digits.startsWith('91') ? `+${digits}` : `+${digits}`
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ phone: e164, password })
      )
      if (error) throw error
    } else {
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ email: id, password })
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
        verifyEmailOtp,
        sendPhoneOtp,
        verifyPhoneOtp,
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
