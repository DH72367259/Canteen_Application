"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

/* ─── Google icon SVG ───────────────────────────────────────────────────── */
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

/* ─── OTP digit boxes ───────────────────────────────────────────────────── */
function OtpInput({ value, onChange, length = 6 }: { value: string; onChange: (v: string) => void; length?: number }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  function handleChange(i: number, char: string) {
    const digit = char.replace(/\D/g, "").slice(-1);
    const arr = value.padEnd(length, " ").split("");
    arr[i] = digit || " ";
    const next = arr.join("").replace(/ /g, "");
    onChange(next);
    if (digit && i < length - 1) refs.current[i + 1]?.focus();
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !value[i] && i > 0) refs.current[i - 1]?.focus();
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (text) { onChange(text); if (text.length < length) refs.current[text.length]?.focus(); }
    e.preventDefault();
  }

  return (
    <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el; }}
          className="otp-digit"
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] || ""}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKeyDown(i, e)}
          onPaste={handlePaste}
          style={{ flex: 1, maxWidth: 44, height: 48, textAlign: "center", fontSize: "1.2rem", fontWeight: 700 }}
        />
      ))}
    </div>
  );
}

/* ─── Divider ────────────────────────────────────────────────────────────── */
function Divider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.25rem 0" }}>
      <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
      <span style={{ fontSize: "0.75rem", color: "var(--ink-3)", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

/* ─── Main login content ─────────────────────────────────────────────────── */
function LoginContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, adminLogin, signInWithGoogle, sendPhoneOtp, verifyPhoneOtp, cancelOtp, otpPending, isFirebaseMode } = useAuth();

  const roleParam = params.get("role") || "user";
  const [tab, setTab] = useState<"user" | "staff">(roleParam === "user" ? "user" : "staff");

  // Phone OTP state
  const [phone, setPhone] = useState("");
  const [otp, setOtp]     = useState("");

  // Staff state
  const [email, setEmail]       = useState(
    roleParam === "vendor"        ? "vendor@canteen.app"  :
    roleParam === "super-admin"   ? "admin@canteen.app"   :
    roleParam === "canteen-admin" ? "canteen@canteen.app" : ""
  );
  const [password, setPassword] = useState(
    roleParam === "vendor"        ? "vendor123"  :
    roleParam === "super-admin"   ? "admin123"   :
    roleParam === "canteen-admin" ? "canteen123" : ""
  );

  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info,  setInfo]  = useState<string | null>(null);

  // Redirect once authenticated
  useEffect(() => {
    if (!user) return;
    const role = user.role;
    if (role === "vendor" || role === "canteen_admin") router.push("/vendor/dashboard");
    else if (role === "super_admin")                   router.push("/admin/dashboard");
    else if (role === "worker")                        router.push("/worker/dashboard");
    else                                               router.push("/dashboard");
  }, [user, router]);

  // ── Google Sign-In ─────────────────────────────────────────────────────
  async function handleGoogle() {
    setBusy(true); setError(null); setInfo(null);
    try {
      await signInWithGoogle();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  // ── Phone: Send OTP ────────────────────────────────────────────────────
  async function handleSendOtp() {
    if (phone.length < 10) { setError("Enter a valid 10-digit mobile number."); return; }
    setBusy(true); setError(null); setInfo(null);
    try {
      await sendPhoneOtp(phone, "recaptcha-container");
      setInfo(`OTP sent to +91 ${phone}.${!isFirebaseMode ? " (Demo OTP: 123456)" : ""}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send OTP.");
    } finally {
      setBusy(false);
    }
  }

  // ── Phone: Verify OTP ─────────────────────────────────────────────────
  async function handleVerifyOtp() {
    const expectedLength = isFirebaseMode ? 6 : 6;
    if (otp.length < expectedLength) { setError(`Enter the ${expectedLength}-digit OTP.`); return; }
    setBusy(true); setError(null);
    try {
      await verifyPhoneOtp(otp);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Invalid OTP.");
      setBusy(false);
    }
  }

  // ── Staff: Email/Password ──────────────────────────────────────────────
  async function handleStaffLogin() {
    if (!email || !password) { setError("Enter email and password."); return; }
    setBusy(true); setError(null);
    try {
      await adminLogin(email, password);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Login failed.");
      setBusy(false);
    }
  }

  function switchTab(t: "user" | "staff") {
    setTab(t);
    setError(null);
    setInfo(null);
    if (otpPending) cancelOtp();
    setOtp("");
    setPhone("");
  }

  return (
    <div className="login-page">
      {/* invisible reCAPTCHA mount point (Firebase Phone Auth) */}
      <div id="recaptcha-container" />

      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <span style={{ width: 48, height: 48, background: "var(--orange)", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", margin: "0 auto 0.5rem" }}>🍽️</span>
          <h1>Canteen</h1>
          <p>Smart Institutional Dining</p>
        </div>

        {/* Tab switcher */}
        <div style={{ display: "flex", border: "1.5px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
          <button onClick={() => switchTab("user")}  style={{ flex: 1, padding: "0.6rem", fontSize: "0.85rem", fontWeight: 600, border: "none", cursor: "pointer", background: tab === "user"  ? "var(--orange)" : "transparent", color: tab === "user"  ? "#fff" : "var(--ink-3)", transition: "all 0.15s" }}>Student / User</button>
          <button onClick={() => switchTab("staff")} style={{ flex: 1, padding: "0.6rem", fontSize: "0.85rem", fontWeight: 600, border: "none", cursor: "pointer", background: tab === "staff" ? "var(--orange)" : "transparent", color: tab === "staff" ? "#fff" : "var(--ink-3)", transition: "all 0.15s" }}>Staff / Vendor</button>
        </div>

        {/* ── Student / User tab ─────────────────────────────────────── */}
        {tab === "user" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>

            {/* Google sign-in */}
            <button
              className="btn btn-outline btn-full"
              disabled={busy}
              onClick={handleGoogle}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.6rem", padding: "0.75rem", fontWeight: 600, fontSize: "0.88rem" }}
            >
              <GoogleIcon />
              Continue with Google
            </button>

            <Divider label="or sign in with phone" />

            {/* Phone OTP */}
            {!otpPending ? (
              <>
                <div className="form-group">
                  <label className="form-label">Mobile Number</label>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <span className="form-input" style={{ width: 56, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#f3f4f6", color: "var(--ink-3)", fontSize: "0.88rem", fontWeight: 600 }}>+91</span>
                    <input
                      className="form-input"
                      type="tel"
                      inputMode="numeric"
                      maxLength={10}
                      placeholder="98765 43210"
                      value={phone}
                      onChange={e => setPhone(e.target.value.replace(/\D/g, ""))}
                      onKeyDown={e => e.key === "Enter" && handleSendOtp()}
                    />
                  </div>
                </div>
                {error && <p className="error-msg">{error}</p>}
                <button className="btn btn-primary btn-full" disabled={busy || phone.length < 10} onClick={handleSendOtp} style={{ padding: "0.8rem" }}>
                  {busy ? "Sending…" : "Send OTP →"}
                </button>
              </>
            ) : (
              <>
                {info && <p style={{ fontSize: "0.82rem", color: "var(--green)", textAlign: "center", background: "var(--green-light)", borderRadius: 10, padding: "0.5rem 0.75rem" }}>{info}</p>}
                <OtpInput value={otp} onChange={setOtp} length={6} />
                {error && <p className="error-msg">{error}</p>}
                <button className="btn btn-primary btn-full" disabled={busy || otp.length < 6} onClick={handleVerifyOtp} style={{ padding: "0.8rem" }}>
                  {busy ? "Verifying…" : "Verify OTP →"}
                </button>
                <button className="btn btn-ghost btn-full" onClick={() => { cancelOtp(); setOtp(""); setError(null); setInfo(null); }} style={{ fontSize: "0.82rem" }}>
                  ← Change number
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Staff / Vendor tab ─────────────────────────────────────── */}
        {tab === "staff" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {!isFirebaseMode && (
              <div style={{ background: "var(--orange-light)", border: "1px solid #fed7aa", borderRadius: 12, padding: "0.65rem 0.85rem", fontSize: "0.78rem", color: "var(--orange-dark)" }}>
                <strong>Demo mode</strong> — Firebase not configured.<br />
                vendor@canteen.app / vendor123 &nbsp;·&nbsp; admin@canteen.app / admin123
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" placeholder="vendor@canteen.app" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="form-input" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleStaffLogin()} />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy} onClick={handleStaffLogin} style={{ padding: "0.8rem" }}>
              {busy ? "Signing in…" : "Sign In →"}
            </button>
          </div>
        )}

        <p style={{ textAlign: "center", fontSize: "0.73rem", color: "var(--ink-3)", marginTop: "0.25rem" }}>
          By continuing you agree to our Terms &amp; Privacy Policy
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="loading-screen"><div className="spinner" /></div>}>
      <LoginContent />
    </Suspense>
  );
}

