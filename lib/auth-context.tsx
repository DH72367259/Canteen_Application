'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabaseClient } from './supabase-client'

// Stable singleton — safe outside the component tree
const supabase = getSupabaseClient()

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
  sendPhoneOtp: (phone: string) => Promise<void>
  verifyPhoneOtp: (phone: string, token: string) => Promise<void>
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
    // Load initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session)
      if (session?.user) {
        const profile = await fetchProfile(session.user.id)
        setUser(buildAuthUser(session.user.id, session.user.email, profile))
      }
      setLoading(false)
    })

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
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
    await supabase.auth.signOut()
  }

  async function sendEmailOtp(email: string) {
    const { error } = await supabase.auth.signInWithOtp({ email })
    if (error) throw error
  }

  async function verifyEmailOtp(email: string, token: string) {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    })
    if (error) throw error
  }

  async function sendPhoneOtp(phone: string) {
    const { error } = await supabase.auth.signInWithOtp({ phone })
    if (error) throw error
  }

  async function verifyPhoneOtp(phone: string, token: string) {
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token,
      type: 'sms',
    })
    if (error) throw error
  }

  async function signInWithPassword(email: string, password: string) {
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
