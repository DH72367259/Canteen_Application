'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signOut,
  signInWithEmailAndPassword,
  signInAnonymously,
} from 'firebase/auth';
import { getClientAuth } from './firebaseClient';

type UserRole = 'user' | 'canteen_admin' | 'vendor' | 'worker' | 'super_admin' | null;

interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  isAnonymous: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
  adminLogin: (email: string, password: string) => Promise<void>;
  userLogin: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auth = getClientAuth();
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Get user role from Firestore or custom claims
        let role: UserRole = 'user';
        const token = await firebaseUser.getIdTokenResult();
        
        if (token.claims.admin) {
          role = 'super_admin';
        } else if (token.claims.canteen_admin) {
          role = 'canteen_admin';
        } else if (token.claims.vendor) {
          role = 'vendor';
        } else if (token.claims.worker) {
          role = 'worker';
        }

        setUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          role,
          isAnonymous: firebaseUser.isAnonymous,
        });
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const logout = async () => {
    const auth = getClientAuth();
    await signOut(auth);
    setUser(null);
  };

  const adminLogin = async (email: string, password: string) => {
    const auth = getClientAuth();
    await signInWithEmailAndPassword(auth, email, password);
  };

  const userLogin = async () => {
    const auth = getClientAuth();
    await signInAnonymously(auth);
  };

  return (
    <AuthContext.Provider value={{ user, loading, logout, adminLogin, userLogin }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
