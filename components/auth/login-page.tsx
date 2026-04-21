'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function LoginPage() {
  const { adminLogin, sendPhoneOtp, verifyPhoneOtp } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await adminLogin(email, password);
      router.push('/app');
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUserLogin = async () => {
    setError('');
    setLoading(true);
    try {
      await sendPhoneOtp('0000000000', 'recaptcha-container');
      await verifyPhoneOtp('123456');
      router.push('/app');
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={styles.container}>
      <div style={styles.wrapper}>
        <div style={styles.header}>
          <h1>NoQx Canteen</h1>
          <p>Smart Institutional Dining Management</p>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.loginSection}>
          <h2>User Login</h2>
          <button
            onClick={handleUserLogin}
            disabled={loading}
            style={styles.primaryButton}
          >
            {loading ? 'Signing in...' : 'Continue as User'}
          </button>
        </div>

        <div style={styles.divider}>OR</div>

        <div style={styles.loginSection}>
          <h2>Admin Login</h2>
          <form onSubmit={handleAdminLogin}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={styles.input}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
              required
            />
            <button
              type="submit"
              disabled={loading}
              style={styles.primaryButton}
            >
              {loading ? 'Signing in...' : 'Login'}
            </button>
          </form>
        </div>

        <div style={styles.footer}>
          <p>© 2026 NoQx. All rights reserved.</p>
        </div>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
    padding: '20px',
  },
  wrapper: {
    backgroundColor: 'white',
    padding: '40px',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    width: '100%',
    maxWidth: '400px',
  },
  header: {
    textAlign: 'center',
    marginBottom: '40px',
  },
  loginSection: {
    marginBottom: '30px',
  },
  error: {
    padding: '12px',
    marginBottom: '20px',
    backgroundColor: '#fee',
    color: '#c33',
    borderRadius: '6px',
    fontSize: '14px',
  },
  input: {
    width: '100%',
    padding: '12px',
    marginBottom: '12px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    fontSize: '14px',
    boxSizing: 'border-box',
  },
  primaryButton: {
    width: '100%',
    padding: '12px',
    backgroundColor: '#2563eb',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.3s',
  },
  divider: {
    textAlign: 'center',
    margin: '30px 0',
    color: '#999',
    fontSize: '14px',
  },
  footer: {
    textAlign: 'center',
    marginTop: '40px',
    fontSize: '12px',
    color: '#999',
  },
};
