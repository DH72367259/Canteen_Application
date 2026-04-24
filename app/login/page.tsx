"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

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
  const { user, sendEmailOtp, verifyEmailOtp, sendPhoneOtp, verifyPhoneOtp, linkEmail, verifyEmailLink, signInWithPassword, resetPassword } = useAuth();

  type Tab = "phone" | "email" | "password" | "forgot";
  const roleParam = params.get("role") || "user";
  const [tab, setTab] = useState<Tab>(roleParam === "user" ? "phone" : "password");

  const [phone, setPhone]   = useState("");
  const [email, setEmail]   = useState(
    roleParam === "vendor"        ? "vendor@canteen.app"  :
    roleParam === "super_admin"   ? "admin@canteen.app"   :
    roleParam === "canteen_admin" ? "canteen@canteen.app" : ""
  );
  const [password, setPassword] = useState(
    roleParam === "vendor"        ? "vendor123"  :
    roleParam === "super_admin"   ? "admin123"   :
    roleParam === "canteen_admin" ? "canteen123" : ""
  );
  const [otp,           setOtp]           = useState("");
  const [otpSentTo,     setOtpSentTo]     = useState<string | null>(null);
  const [otpTarget,     setOtpTarget]     = useState<"phone" | "email">("phone");
  const [busy,          setBusy]          = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [info,          setInfo]          = useState<string | null>(null);
  const [dualVerifyStep, setDualVerifyStep] = useState<"idle" | "email_verify" | "done">("idle");
  const [dualEmail,     setDualEmail]     = useState("");

  useEffect(() => {
    if (!user) return;

    // Phone login without email: first-time users must verify email too
    if (tab === "phone" && !user.email && dualVerifyStep === "idle") {
      setDualVerifyStep("email_verify");
      setOtpSentTo(null);
      setOtp("");
      setError(null);
      setInfo(null);
      return;
    }

    // Don't redirect while email verification is still in progress
    if (dualVerifyStep === "email_verify") return;

    const next = params.get("next");
    if (next) { router.replace(next); return; }
    const role = user.role;
    if (role === "vendor" || role === "canteen_admin") router.replace("/vendor/dashboard");
    else if (role === "super_admin")                   router.replace("/admin/dashboard");
    else if (role === "worker")                        router.replace("/worker/dashboard");
    else                                               router.replace("/dashboard");
  }, [user, router, params, tab, dualVerifyStep]);

  function clearState() { setError(null); setInfo(null); setOtp(""); setOtpSentTo(null); }
  function switchTab(t: Tab) { clearState(); setTab(t); }

  // Phone OTP
  async function handleSendPhoneOtp() {
    if (phone.length < 10) { setError("Enter a valid 10-digit mobile number."); return; }
    setBusy(true); clearState();
    try {
      const fullPhone = phone.startsWith("+") ? phone : `+91${phone}`;
      const result = await sendPhoneOtp(fullPhone);
      setOtpTarget("phone");
      setOtpSentTo(fullPhone);
      const via = result.channels.includes("whatsapp") && result.channels.includes("sms")
        ? "WhatsApp & SMS"
        : result.channels.includes("whatsapp") ? "WhatsApp" : "SMS";
      setInfo(`OTP sent to ${fullPhone} via ${via}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to send OTP.";
      const isDeliveryFailure = msg.toLowerCase().includes("unverified") || msg.toLowerCase().includes("trial") || msg.toLowerCase().includes("not a valid destination") || msg.toLowerCase().includes("sms");
      setError(
        isDeliveryFailure
          ? "SMS could not be delivered to this number right now. Please use Email OTP login instead (✉️ Email OTP tab above)."
          : msg
      );
    } finally { setBusy(false); }
  }

  async function handleVerifyPhoneOtp() {
    if (otp.length < 6) { setError("Enter the 6-digit OTP."); return; }
    if (!otpSentTo) return;
    setBusy(true); setError(null);
    try {
      await verifyPhoneOtp(otpSentTo, otp);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Invalid OTP.");
      setBusy(false);
    }
  }

  // Dual email verification (for first-time phone users)
  async function handleLinkEmail() {
    if (!dualEmail) { setError("Enter your email address."); return; }
    setBusy(true); clearState();
    try {
      await linkEmail(dualEmail);
      setOtpTarget("email");
      setOtpSentTo(dualEmail);
      setInfo(`Verification code sent to ${dualEmail}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send verification code.");
    } finally { setBusy(false); }
  }

  async function handleVerifyEmailLink() {
    if (otp.length < 6) { setError("Enter the 6-digit code from your email."); return; }
    if (!otpSentTo) return;
    setBusy(true); setError(null);
    try {
      await verifyEmailLink(otpSentTo, otp);
      setDualVerifyStep("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Invalid verification code.");
      setBusy(false);
    }
  }

  // Email OTP
  async function handleSendEmailOtp() {
    if (!email) { setError("Enter your email address."); return; }
    setBusy(true); clearState();
    try {
      await sendEmailOtp(email);
      setOtpTarget("email");
      setOtpSentTo(email);
      setInfo(`Magic link / OTP sent to ${email}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send OTP.");
    } finally { setBusy(false); }
  }

  async function handleVerifyEmailOtp() {
    if (otp.length < 6) { setError("Enter the 6-digit OTP from your email."); return; }
    if (!otpSentTo) return;
    setBusy(true); setError(null);
    try {
      await verifyEmailOtp(otpSentTo, otp);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Invalid OTP.");
      setBusy(false);
    }
  }

  // Password login
  async function handlePasswordLogin() {
    if (!email || !password) { setError("Enter email and password."); return; }
    setBusy(true); setError(null);
    try {
      await signInWithPassword(email, password);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Login failed.");
      setBusy(false);
    }
  }

  // Forgot password
  async function handleForgotPassword() {
    if (!email) { setError("Enter your email address."); return; }
    setBusy(true); setError(null);
    try {
      await resetPassword(email);
      setInfo(`Password reset link sent to ${email}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send reset link.");
    } finally { setBusy(false); }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <span style={{ width: 48, height: 48, background: "var(--orange)", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", margin: "0 auto 0.5rem" }}>🍽️</span>
          <h1>Canteen-Application</h1>
          <p>Smart Institutional Dining</p>
        </div>

        {/* Tab switcher — hidden during email verification step */}
        {dualVerifyStep !== "email_verify" && (
        <div style={{ display: "flex", border: "1.5px solid var(--border)", borderRadius: 14, overflow: "hidden", fontSize: "0.78rem" }}>
          {(["phone", "email", "password"] as Tab[]).map(t => (
            <button key={t} onClick={() => switchTab(t)} style={{ flex: 1, padding: "0.55rem 0.25rem", fontWeight: 600, border: "none", cursor: "pointer", background: tab === t ? "var(--orange)" : "transparent", color: tab === t ? "#fff" : "var(--ink-3)", transition: "all 0.15s" }}>
              {t === "phone" ? "📱 Phone" : t === "email" ? "✉️ Email OTP" : "🔑 Password"}
            </button>
          ))}
        </div>
        )}

        {/* ── Phone OTP ──────────────── */}
        {tab === "phone" && !otpSentTo && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div className="form-group">
              <label className="form-label">Mobile Number</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <span className="form-input" style={{ width: 56, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#f3f4f6", color: "var(--ink-3)", fontSize: "0.88rem", fontWeight: 600 }}>+91</span>
                <input className="form-input" type="tel" inputMode="numeric" maxLength={10} placeholder="7019986046" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ""))} onKeyDown={e => e.key === "Enter" && handleSendPhoneOtp()} />
              </div>
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy || phone.length < 10} onClick={handleSendPhoneOtp} style={{ padding: "0.8rem" }}>
              {busy ? "Sending…" : "Send OTP →"}
            </button>
          </div>
        )}

        {tab === "phone" && otpSentTo && otpTarget === "phone" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {info && <p style={{ fontSize: "0.82rem", color: "var(--green)", textAlign: "center", background: "var(--green-light)", borderRadius: 10, padding: "0.5rem 0.75rem" }}>{info}</p>}
            <OtpInput value={otp} onChange={setOtp} length={6} />
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy || otp.length < 6} onClick={handleVerifyPhoneOtp} style={{ padding: "0.8rem" }}>
              {busy ? "Verifying…" : "Verify OTP →"}
            </button>
            <button className="btn btn-ghost btn-full" onClick={() => { setOtpSentTo(null); setOtp(""); setError(null); setInfo(null); }} style={{ fontSize: "0.82rem" }}>
              ← Change number
            </button>
          </div>
        )}

        {/* ── Dual Email Verification (first-time phone users) ────── */}
        {tab === "phone" && dualVerifyStep === "email_verify" && !otpSentTo && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ textAlign: "center", padding: "0.5rem 0" }}>
              <p style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--ink-1)" }}>✅ Phone verified!</p>
              <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", marginTop: 4 }}>Enter your email to complete registration</p>
            </div>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input className="form-input" type="email" placeholder="you@example.com"
                value={dualEmail} onChange={e => setDualEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleLinkEmail()} />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy || !dualEmail}
              onClick={handleLinkEmail} style={{ padding: "0.8rem" }}>
              {busy ? "Sending…" : "Send Email OTP →"}
            </button>
          </div>
        )}

        {tab === "phone" && dualVerifyStep === "email_verify" && otpSentTo && otpTarget === "email" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {info && <p style={{ fontSize: "0.82rem", color: "var(--green)", textAlign: "center", background: "var(--green-light)", borderRadius: 10, padding: "0.5rem 0.75rem" }}>{info}</p>}
            <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", textAlign: "center" }}>Enter the 6-digit code sent to {otpSentTo}</p>
            <OtpInput value={otp} onChange={setOtp} length={6} />
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy || otp.length < 6}
              onClick={handleVerifyEmailLink} style={{ padding: "0.8rem" }}>
              {busy ? "Verifying…" : "Complete Registration →"}
            </button>
            <button className="btn btn-ghost btn-full"
              onClick={() => { setOtpSentTo(null); setOtp(""); setError(null); setInfo(null); }}
              style={{ fontSize: "0.82rem" }}>
              ← Change email
            </button>
          </div>
        )}

        {/* ── Email OTP ──────────────── */}
        {tab === "email" && !otpSentTo && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input className="form-input" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSendEmailOtp()} />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy || !email} onClick={handleSendEmailOtp} style={{ padding: "0.8rem" }}>
              {busy ? "Sending…" : "Send OTP →"}
            </button>
          </div>
        )}

        {tab === "email" && otpSentTo && otpTarget === "email" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {info && <p style={{ fontSize: "0.82rem", color: "var(--green)", textAlign: "center", background: "var(--green-light)", borderRadius: 10, padding: "0.5rem 0.75rem" }}>{info}</p>}
            <OtpInput value={otp} onChange={setOtp} length={6} />
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy || otp.length < 6} onClick={handleVerifyEmailOtp} style={{ padding: "0.8rem" }}>
              {busy ? "Verifying…" : "Verify OTP →"}
            </button>
            <button className="btn btn-ghost btn-full" onClick={() => { setOtpSentTo(null); setOtp(""); setError(null); setInfo(null); }} style={{ fontSize: "0.82rem" }}>
              ← Change email
            </button>
          </div>
        )}

        {/* ── Password ──────────────── */}
        {tab === "password" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" placeholder="staff@canteen.app" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="form-input" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handlePasswordLogin()} />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy} onClick={handlePasswordLogin} style={{ padding: "0.8rem" }}>
              {busy ? "Signing in…" : "Sign In →"}
            </button>
            <Divider label="forgot password?" />
            <button className="btn btn-ghost btn-full" onClick={() => switchTab("forgot")} style={{ fontSize: "0.82rem" }}>
              Reset Password
            </button>
          </div>
        )}

        {/* ── Forgot Password ──────────── */}
        {tab === "forgot" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input className="form-input" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleForgotPassword()} />
            </div>
            {info && <p style={{ fontSize: "0.82rem", color: "var(--green)", textAlign: "center", background: "var(--green-light)", borderRadius: 10, padding: "0.5rem 0.75rem" }}>{info}</p>}
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy || !email} onClick={handleForgotPassword} style={{ padding: "0.8rem" }}>
              {busy ? "Sending…" : "Send Reset Link →"}
            </button>
            <button className="btn btn-ghost btn-full" onClick={() => switchTab("password")} style={{ fontSize: "0.82rem" }}>
              ← Back to Sign In
            </button>
          </div>
        )}

        <p style={{ textAlign: "center", fontSize: "0.73rem", color: "var(--ink-3)", marginTop: "0.25rem" }}>
          By continuing you agree to our{" "}
          <a href="/terms" style={{ color: "var(--orange)" }}>Terms</a> &amp;{" "}
          <a href="/privacy" style={{ color: "var(--orange)" }}>Privacy Policy</a>
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
