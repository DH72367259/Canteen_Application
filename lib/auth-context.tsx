'use client';

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { isFirebaseClientConfigured } from './firebaseClient';

export type UserRole = 'user' | 'canteen_admin' | 'vendor' | 'worker' | 'super_admin' | null;

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  isAnonymous: boolean;
  phone?: string | null;
  photoURL?: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  isFirebaseMode: boolean;
  otpPending: boolean;
  logout: () => Promise<void>;
  adminLogin: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  sendPhoneOtp: (phone: string, recaptchaContainerId: string) => Promise<void>;
  verifyPhoneOtp: (code: string) => Promise<void>;
  cancelOtp: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Demo credentials (used when Firebase env vars are not set)
const DEMO_ACCOUNTS = [
  { email: 'admin@canteen.app',   password: 'admin123',   role: 'super_admin'   as UserRole, displayName: 'Super Admin'     },
  { email: 'vendor@canteen.app',  password: 'vendor123',  role: 'vendor'        as UserRole, displayName: 'Central Canteen' },
  { email: 'canteen@canteen.app', password: 'canteen123', role: 'canteen_admin' as UserRole, displayName: 'Canteen Admin'   },
  { email: 'worker@canteen.app',  password: 'worker123',  role: 'worker'        as UserRole, displayName: 'Kitchen Worker'  },
];

// Map staff emails → roles (used in Firebase mode to assign roles post-login)
const STAFF_EMAIL_ROLES: Record<string, UserRole> = {
  'admin@canteen.app':   'super_admin',
  'vendor@canteen.app':  'vendor',
  'canteen@canteen.app': 'canteen_admin',
  'worker@canteen.app':  'worker',
};

const FIREBASE_ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-phone-number':   'Invalid phone number. Include country code or use 10-digit format.',
  'auth/too-many-requests':      'Too many requests. Please wait a few minutes and try again.',
  'auth/quota-exceeded':         'SMS quota exceeded. Please try again later.',
  'auth/invalid-verification-code': 'Wrong OTP code. Please check and try again.',
  'auth/code-expired':           'OTP has expired. Please request a new one.',
  'auth/popup-closed-by-user':   'Sign-in popup was closed. Please try again.',
  'auth/cancelled-popup-request':'Only one popup window allowed at a time.',
  'auth/popup-blocked':          'Popup blocked by browser. Allow popups for this site.',
  'auth/unauthorized-domain':    'This domain is not authorized in Firebase. Add it to Firebase Console → Authentication → Settings → Authorized domains.',
  'auth/wrong-password':         'Incorrect password.',
  'auth/user-not-found':         'No account found with this email.',
  'auth/invalid-credential':     'Invalid email or password.',
};

function friendlyError(e: unknown): string {
  if (e instanceof Error) {
    const code = (e as { code?: string }).code;
    if (code && FIREBASE_ERROR_MESSAGES[code]) return FIREBASE_ERROR_MESSAGES[code];
    return e.message;
  }
  return 'Something went wrong. Please try again.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]           = useState<AuthUser | null>(null);
  const [loading, setLoading]     = useState(true);
  const [otpPending, setOtpPending] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const confirmationRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recaptchaRef    = useRef<any>(null);

  const firebaseMode = isFirebaseClientConfigured();

  // ── Resolve role from email or Firestore ─────────────────────────────────
  async function resolveRole(uid: string, email: string | null): Promise<UserRole> {
    if (email && STAFF_EMAIL_ROLES[email]) return STAFF_EMAIL_ROLES[email];
    try {
      const { getFirestore, doc, getDoc } = await import('firebase/firestore');
      const { getClientAuth } = await import('./firebaseClient');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = getFirestore((getClientAuth() as any).app);
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) return (snap.data().role as UserRole) || 'user';
    } catch { /* Firestore not reachable or no doc */ }
    return 'user';
  }

  // ── Auth state listener ───────────────────────────────────────────────────
  useEffect(() => {
    if (!firebaseMode) {
      // Demo mode – restore from localStorage
      try {
        const saved = localStorage.getItem('canteen_session');
        if (saved) setUser(JSON.parse(saved));
      } catch { /* ignore */ }
      setLoading(false);
      return;
    }

    let unsub: () => void;
    (async () => {
      const { onAuthStateChanged } = await import('firebase/auth');
      const { getClientAuth } = await import('./firebaseClient');
      unsub = onAuthStateChanged(getClientAuth(), async (fbUser) => {
        if (fbUser) {
          const role = await resolveRole(fbUser.uid, fbUser.email);
          setUser({
            uid:         fbUser.uid,
            email:       fbUser.email,
            displayName: fbUser.displayName,
            role,
            isAnonymous: fbUser.isAnonymous,
            phone:       fbUser.phoneNumber,
            photoURL:    fbUser.photoURL,
          });
        } else {
          setUser(null);
        }
        setLoading(false);
      });
    })();

    return () => unsub?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseMode]);

  // ── Google Sign-In ────────────────────────────────────────────────────────
  const signInWithGoogle = async () => {
    if (!firebaseMode) throw new Error('Firebase is not configured. Add your Firebase env vars to enable Google login.');
    try {
      const { signInWithPopup, GoogleAuthProvider } = await import('firebase/auth');
      const { getClientAuth } = await import('./firebaseClient');
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(getClientAuth(), provider);
      // onAuthStateChanged handles setUser
    } catch (e) {
      throw new Error(friendlyError(e));
    }
  };

  // ── Phone OTP – Step 1: send ──────────────────────────────────────────────
  const sendPhoneOtp = async (phone: string, recaptchaContainerId: string) => {
    if (!firebaseMode) {
      // Demo mode: just set pending, OTP is "123456"
      setOtpPending(true);
      return;
    }
    try {
      const { signInWithPhoneNumber, RecaptchaVerifier } = await import('firebase/auth');
      const { getClientAuth } = await import('./firebaseClient');
      const auth = getClientAuth();

      // Clear any previous recaptcha
      if (recaptchaRef.current) {
        recaptchaRef.current.clear();
        recaptchaRef.current = null;
      }

      const verifier = new RecaptchaVerifier(auth, recaptchaContainerId, {
        size: 'invisible',
        callback: () => {},
        'expired-callback': () => { recaptchaRef.current = null; },
      });
      recaptchaRef.current = verifier;

      const e164 = phone.startsWith('+') ? phone : `+91${phone}`;
      const confirmation = await signInWithPhoneNumber(auth, e164, verifier);
      confirmationRef.current = confirmation;
      setOtpPending(true);
    } catch (e) {
      throw new Error(friendlyError(e));
    }
  };

  // ── Phone OTP – Step 2: verify ────────────────────────────────────────────
  const verifyPhoneOtp = async (code: string) => {
    if (!firebaseMode) {
      if (code !== '123456') throw new Error('Wrong OTP. Use 123456 for demo.');
      const u: AuthUser = {
        uid: `uid_user_${Date.now()}`,
        email: null,
        displayName: 'Guest User',
        role: 'user',
        isAnonymous: false,
      };
      localStorage.setItem('canteen_session', JSON.stringify(u));
      setUser(u);
      setOtpPending(false);
      return;
    }
    if (!confirmationRef.current) throw new Error('No pending OTP. Please request a new one.');
    try {
      await confirmationRef.current.confirm(code);
      setOtpPending(false);
      confirmationRef.current = null;
      // onAuthStateChanged handles setUser
    } catch (e) {
      throw new Error(friendlyError(e));
    }
  };

  const cancelOtp = () => {
    setOtpPending(false);
    confirmationRef.current = null;
    if (recaptchaRef.current) { recaptchaRef.current.clear(); recaptchaRef.current = null; }
  };

  // ── Staff Email / Password Login ──────────────────────────────────────────
  const adminLogin = async (email: string, password: string) => {
    if (!firebaseMode) {
      const account = DEMO_ACCOUNTS.find(a => a.email === email && a.password === password);
      if (!account) throw new Error('Invalid credentials. Try demo accounts listed above.');
      const u: AuthUser = { uid: `uid_${account.role}`, email: account.email, displayName: account.displayName, role: account.role, isAnonymous: false };
      localStorage.setItem('canteen_session', JSON.stringify(u));
      setUser(u);
      return;
    }
    try {
      const { signInWithEmailAndPassword } = await import('firebase/auth');
      const { getClientAuth } = await import('./firebaseClient');
      await signInWithEmailAndPassword(getClientAuth(), email, password);
      // onAuthStateChanged handles setUser
    } catch (e) {
      throw new Error(friendlyError(e));
    }
  };

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = async () => {
    if (firebaseMode) {
      const { signOut } = await import('firebase/auth');
      const { getClientAuth } = await import('./firebaseClient');
      await signOut(getClientAuth());
    } else {
      localStorage.removeItem('canteen_session');
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, isFirebaseMode: firebaseMode, otpPending, logout, adminLogin, signInWithGoogle, sendPhoneOtp, verifyPhoneOtp, cancelOtp }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
