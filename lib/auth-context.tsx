'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabaseClient, isSupabaseConfigured } from './supabase-client'

// Stable singleton — safe outside the component tree
const supabase = getSupabaseClient()

// 20-day inactivity threshold (ms)
const INACTIVITY_LIMIT_MS = 20 * 24 * 60 * 60 * 1000
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
  | null

export interface AuthUser {
  uid: string
  email: string | null
  displayName: string | null
  role: UserRole
  phone?: string | null
  walletBalance: number
}

interface AuthContextValue {
  user: AuthUser | null
  session: Session | null
  loading: boolean
  logout: () => Promise<void>
  sendEmailOtp: (email: string) => Promise<void>
  verifyEmailOtp: (email: string, token: string) => Promise<void>
  sendPhoneOtp: (phone: string) => Promise<{ channels: string[] }>
  verifyPhoneOtp: (phone: string, token: string) => Promise<void>
  linkEmail: (email: string) => Promise<void>
  verifyEmailLink: (email: string, token: string) => Promise<void>
  signInWithPassword: (email: string, password: string) => Promise<void>
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
  const { data } = await supabase
    .from('profiles')
    .select('name, role, wallet_balance, phone')
    .eq('id', userId)
    .single()

  return {
    displayName: data?.name ?? null,
    role: (data?.role as UserRole) ?? 'user',
    walletBalance: data?.wallet_balance ?? 0,
    phone: data?.phone ?? null,
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
  }
}

// ============================================================
// Provider
// ============================================================
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // If Supabase env vars are placeholders (not real credentials), skip the
    // getSession() call entirely — it would hang indefinitely on an invalid host
    // and freeze the login page spinner.
    if (!isSupabaseConfigured()) {
      setLoading(false)
      return
    }

    // Safety timeout: if Supabase is unreachable, stop the spinner after 3s.
    const fallback = setTimeout(() => setLoading(false), 3000)

    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        clearTimeout(fallback)

        // 20-day inactivity check — if the user hasn't been active, sign them out
        if (session?.user && isInactive()) {
          await supabase.auth.signOut()
          setLoading(false)
          return
        }

        if (session?.user) recordActivity()

        setSession(session)
        if (session?.user) {
          const profile = await fetchProfile(session.user.id)
          setUser(buildAuthUser(session.user.id, session.user.email, profile))
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
        const profile = await fetchProfile(session.user.id)
        setUser(buildAuthUser(session.user.id, session.user.email, profile))
      } else {
        setUser(null)
      }
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  // ---- Auth methods ----

  async function logout() {
    try { localStorage.removeItem(LAST_ACTIVITY_KEY) } catch { /* SSR safe */ }
    await supabase.auth.signOut()
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
    const { error } = await supabase.auth.signInWithOtp({ email })
    if (error) throw error
  }

  async function verifyEmailOtp(email: string, token: string) {
    if (!isSupabaseConfigured()) {
      const role = demoRoleFor(email)
      const name = role === 'super_admin' ? 'Admin (Demo)' : role === 'canteen_admin' ? 'Canteen (Demo)' : 'Student (Demo)'
      setUser(buildAuthUser('demo-user', email, { role, displayName: name, walletBalance: 100 }))
      return
    }
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    })
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
    const { error } = await supabase.auth.signInWithOtp({ phone })
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
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
    })
    if (error) throw error
  }

  async function linkEmail(email: string) {
    const { error } = await supabase.auth.updateUser({ email })
    if (error) throw error
  }

  async function verifyEmailLink(email: string, token: string) {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email_change',
    })
    if (error) throw error
  }

  async function signInWithPassword(email: string, password: string) {
    if (!isSupabaseConfigured()) {
      const role = demoRoleFor(email)
      const name = role === 'super_admin' ? 'Admin (Demo)' : role === 'canteen_admin' ? 'Canteen (Demo)' : role === 'vendor' ? 'Vendor (Demo)' : 'Student (Demo)'
      setUser(buildAuthUser('demo-user', email, { role, displayName: name, walletBalance: 100 }))
      return
    }
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
  }

  async function signUp(
    email: string,
    password: string,
    metadata?: Record<string, unknown>
  ) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: metadata },
    })
    if (error) throw error
  }

  async function resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/reset-password`,
    })
    if (error) throw error
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        logout,
        sendEmailOtp,
        verifyEmailOtp,
        sendPhoneOtp,
        verifyPhoneOtp,
        linkEmail,
        verifyEmailLink,
        signInWithPassword,
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
