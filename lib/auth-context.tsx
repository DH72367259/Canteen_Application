'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type UserRole = 'user' | 'canteen_admin' | 'vendor' | 'worker' | 'super_admin' | null;

interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  isAnonymous: boolean;
  phone?: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
  adminLogin: (email: string, password: string) => Promise<void>;
  userLogin: (phone?: string, name?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEMO_ACCOUNTS = [
  { email: 'admin@noqx.in', password: 'admin123', role: 'super_admin' as UserRole, displayName: 'Super Admin' },
  { email: 'vendor@noqx.in', password: 'vendor123', role: 'vendor' as UserRole, displayName: 'Central Canteen' },
  { email: 'canteen@noqx.in', password: 'canteen123', role: 'canteen_admin' as UserRole, displayName: 'Canteen Admin' },
  { email: 'worker@noqx.in', password: 'worker123', role: 'worker' as UserRole, displayName: 'Kitchen Worker' },
];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('noqx_session');
      if (saved) setUser(JSON.parse(saved));
    } catch {/* ignore */}
    setLoading(false);
  }, []);

  const logout = async () => {
    localStorage.removeItem('noqx_session');
    setUser(null);
  };

  const adminLogin = async (email: string, password: string) => {
    const account = DEMO_ACCOUNTS.find(a => a.email === email && a.password === password);
    if (!account) throw new Error('Invalid credentials. Check demo accounts.');
    const u: AuthUser = { uid: `uid_${account.role}`, email: account.email, displayName: account.displayName, role: account.role, isAnonymous: false };
    localStorage.setItem('noqx_session', JSON.stringify(u));
    setUser(u);
  };

  const userLogin = async (phone?: string, name?: string) => {
    const u: AuthUser = { uid: `uid_user_${Date.now()}`, email: null, displayName: name || 'Guest User', role: 'user', isAnonymous: !phone, phone: phone || null };
    localStorage.setItem('noqx_session', JSON.stringify(u));
    setUser(u);
  };

  return (
    <AuthContext.Provider value={{ user, loading, logout, adminLogin, userLogin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
