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
  const {
    user, loading, session,
    sendEmailOtp, verifyEmailOtp,
    sendPhoneOtp, verifyPhoneOtp,
    signInWithIdentifier, signInWithPassword,
    resetPassword,
  } = useAuth();

  type Tab = "phone" | "email" | "password" | "forgot";
  const roleParam = params.get("role") || "user";
  const [tab, setTab] = useState<Tab>(roleParam === "user" ? "phone" : "password");

  // ── Common state ──────────────────────────────────────────────────────────
  const [phone,      setPhone]     = useState("");
  const [email,      setEmail]     = useState("");
  const [password,   setPassword]  = useState("");
  const [identifier, setIdentifier] = useState(""); // email OR phone for student sign-in
  const [otp,        setOtp]       = useState("");
  const [otpSentTo,  setOtpSentTo] = useState<string | null>(null);
  const [otpTarget,  setOtpTarget] = useState<"phone" | "email">("phone");
  const [busy,       setBusy]      = useState(false);
  const [error,      setError]     = useState<string | null>(null);
  const [info,       setInfo]      = useState<string | null>(null);
  const [showPwd,    setShowPwd]   = useState(false);

  // ── Student tab mode: default = "signin" (password), toggle = "register" (OTP) ──
  const [registerMode, setRegisterMode] = useState(false);

  // ── Account setup form — shown after first-ever OTP verification ──────────
  const [showSetup,       setShowSetup]       = useState(false);
  const [setupName,       setSetupName]       = useState("");
  const [setupPwd,        setSetupPwd]        = useState("");
  const [setupConfirmPwd, setSetupConfirmPwd] = useState("");
  const [setupEmail,      setSetupEmail]      = useState(""); // for phone-only users
  const [setupBusy,       setSetupBusy]       = useState(false);
  const [setupShowPwd,    setSetupShowPwd]    = useState(false);

  // ── Password-expired banner (set by hard 30-day signOut in auth-context) ──
  const [pwExpired, setPwExpired] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem("canteen_pw_expired") === "1") {
      setPwExpired(true);
      localStorage.removeItem("canteen_pw_expired");
    }
  }, []);

  // ── Auth redirect logic ───────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    // Staff accounts are created by super_admin — they never go through OTP setup
    const isStaff = ["canteen_admin", "vendor", "super_admin", "worker", "co_admin"].includes(user.role ?? "");

    // First-time user hasn't set a password yet → show account setup (students only)
    if (!user.hasPassword && !showSetup && !isStaff) {
      setShowSetup(true);
      setBusy(false);
      return;
    }

    // Still on the setup form — wait for user to complete it
    if (showSetup) return;

    // Admin-created account or 30-day password expiry → force change
    if (user.mustChangePassword) {
      router.replace("/change-password");
      return;
    }

    const next = params.get("next");
    if (next) { router.replace(next); return; }
    const role = user.role;
    if (role === "vendor" || role === "canteen_admin") router.replace("/vendor/dashboard");
    else if (role === "super_admin" || role === "co_admin") router.replace("/admin/dashboard");
    else if (role === "worker")                        router.replace("/worker/dashboard");
    else                                               router.replace("/dashboard");
  }, [user, router, params, showSetup]);

  function clearState() { setError(null); setInfo(null); setOtp(""); setOtpSentTo(null); }
  function switchTab(t: Tab) {
    // Clear ALL form state so nothing carries over between tabs
    setEmail("");
    setPhone("");
    setPassword("");
    setIdentifier("");
    setOtp("");
    setOtpSentTo(null);
    setError(null);
    setInfo(null);
    setRegisterMode(false);
    setShowSetup(false);
    setShowPwd(false);
    setTab(t);
  }

  // ── Student password sign-in (returning users, both phone & email tabs) ───
  async function handleSignIn() {
    const id = (tab === "phone" ? identifier : email).trim();
    if (tab === "phone") {
      if (id.length < 10) { setError("Enter a valid 10-digit mobile number."); return; }
    } else {
      if (!id) { setError("Enter your email address."); return; }
    }
    if (!password) { setError("Enter your password."); return; }
    setBusy(true); setError(null);
    try {
      await signInWithIdentifier(id, password);
      setTimeout(() => setBusy(false), 10000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Login failed.";
      setError(
        msg.toLowerCase().includes("invalid login credentials")
          ? "Incorrect email/phone or password. If you're new here, tap 'Register' below."
          : msg.toLowerCase().includes("timed out")
          ? "Connection timed out. Check your internet and try again."
          : msg
      );
      setBusy(false);
    }
  }

  // ── Phone OTP — registration flow ─────────────────────────────────────────
  async function handleSendPhoneOtp() {
    if (phone.length < 10) { setError("Enter a valid 10-digit mobile number."); return; }
    setBusy(true); clearState();
    try {
      const fullPhone = phone.startsWith("+") ? phone : `+91${phone}`;
      const result = await sendPhoneOtp(fullPhone);
      setOtpTarget("phone");
      setOtpSentTo(fullPhone);
      const via = result.channels.includes("whatsapp") && result.channels.includes("sms")
        ? "WhatsApp & SMS" : result.channels.includes("whatsapp") ? "WhatsApp" : "SMS";
      setInfo(`OTP sent to ${fullPhone} via ${via}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to send OTP.";
      setError(
        msg.toLowerCase().includes("unverified") || msg.toLowerCase().includes("trial") || msg.toLowerCase().includes("not a valid destination")
          ? "SMS could not be delivered. Please use the Email tab instead."
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
      // After verify, useEffect detects user.hasPassword === false → shows setup form
      setTimeout(() => setBusy(false), 8000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Invalid OTP. Please check the code and try again.");
      setBusy(false);
    }
  }

  // ── Email OTP — registration flow ─────────────────────────────────────────
  async function handleSendEmailOtp() {
    if (!email) { setError("Enter your email address."); return; }
    setBusy(true); clearState();
    try {
      await sendEmailOtp(email);
      setOtpTarget("email");
      setOtpSentTo(email);
      setInfo(`OTP sent to ${email}`);
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
      setTimeout(() => setBusy(false), 8000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Invalid or expired OTP.");
      setBusy(false);
    }
  }

  // ── Account setup — called once after first OTP verification ──────────────
  async function handleSetupAccount() {
    setError(null);
    if (!setupName.trim())            { setError("Please enter your name."); return; }
    if (!setupPwd)                    { setError("Please create a password."); return; }
    if (setupPwd.length < 8)         { setError("Password must be at least 8 characters."); return; }
    if (setupPwd !== setupConfirmPwd) { setError("Passwords do not match."); return; }
    const userHasEmail = !!user?.email;
    if (!userHasEmail && !setupEmail.trim()) {
      setError("Please enter your email address (used for future logins).");
      return;
    }
    if (!userHasEmail && setupEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(setupEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    setSetupBusy(true);
    try {
      const res = await fetch("/api/auth/setup-account", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          displayName: setupName.trim(),
          password: setupPwd,
          email: !userHasEmail ? setupEmail.trim() : undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to set up account.");
      }
      // Refresh session so user_metadata.has_password: true is reflected
      const { getSupabaseClient } = await import("@/lib/supabase-client");
      await getSupabaseClient().auth.refreshSession();
      // Navigate directly to dashboard
      const role = user?.role;
      if (role === "vendor" || role === "canteen_admin") router.replace("/vendor/dashboard");
      else if (role === "super_admin")                   router.replace("/admin/dashboard");
      else if (role === "worker")                        router.replace("/worker/dashboard");
      else                                               router.replace("/dashboard");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create account. Please try again.");
      setSetupBusy(false);
    }
  }

  // ── Canteen / admin password login ───────────────────────────────────────
  async function handlePasswordLogin() {
    if (!email || !password) { setError("Enter email and password."); return; }
    setBusy(true); setError(null);
    try {
      await signInWithPassword(email, password);
      setTimeout(() => setBusy(false), 10000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Login failed.";
      setError(
        msg.toLowerCase().includes("email not confirmed")
          ? "This account's email is not confirmed. Please contact your administrator."
          : msg.toLowerCase().includes("invalid login credentials")
          ? "Incorrect email or password. Please check and try again."
          : msg.toLowerCase().includes("timed out")
          ? "Connection timed out. Please check your internet and try again."
          : msg
      );
      setBusy(false);
    }
  }

  // ── Forgot password ───────────────────────────────────────────────────────
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

  // While auth loads (e.g. arriving via magic link), show a spinner
  if (loading) {
    return <div className="loading-screen"><div className="spinner" /></div>;
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Password-expired warning */}
        {pwExpired && (
          <div style={{
            background: "#fff3cd", border: "1px solid #ffc107", borderRadius: 10,
            padding: "0.65rem 1rem", fontSize: "0.82rem", color: "#7a5800",
            fontWeight: 600, marginBottom: "0.5rem", lineHeight: 1.5,
          }}>
            ⚠️ Your password expired after 30 days. Please sign in again and update your password.
          </div>
        )}

        {/* Logo */}
        <div className="login-logo">
          <span style={{ width: 48, height: 48, background: "var(--orange)", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", margin: "0 auto 0.5rem" }}>🍽️</span>
          <h1>Canteen-Application</h1>
          <p>Smart Institutional Dining</p>
        </div>

        {/* Tab switcher — hidden during account setup */}
        {!showSetup && (
          <div style={{ display: "flex", border: "1.5px solid var(--border)", borderRadius: 14, overflow: "hidden", fontSize: "0.78rem" }}>
            {(["phone", "email", "password"] as Tab[]).map(t => (
              <button key={t} onClick={() => switchTab(t)} style={{ flex: 1, padding: "0.55rem 0.25rem", fontWeight: 600, border: "none", cursor: "pointer", background: tab === t ? "var(--orange)" : "transparent", color: tab === t ? "#fff" : "var(--ink-3)", transition: "all 0.15s" }}>
                {t === "phone" ? "📱 Student (Phone)" : t === "email" ? "📧 Student (Email)" : "🏢 Canteen Login"}
              </button>
            ))}
          </div>
        )}

        {/* ── Account Setup (first-time, after OTP verification) ─────────────── */}
        {showSetup && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ textAlign: "center", padding: "0.25rem 0 0.5rem" }}>
              <span style={{ fontSize: "2rem" }}>🎉</span>
              <p style={{ fontWeight: 700, color: "var(--ink-1)", margin: "0.3rem 0 0.15rem", fontSize: "1.05rem" }}>Identity Verified!</p>
              <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", margin: 0 }}>
                Set up your name &amp; password — you'll use these to log in from now on
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">Your Name</label>
              <input className="form-input" type="text" placeholder="What should we call you?" value={setupName} onChange={e => setSetupName(e.target.value)} autoFocus autoComplete="name" />
            </div>

            {/* Email field — only shown for phone-verified users with no email yet */}
            {!user?.email && (
              <div className="form-group">
                <label className="form-label">Email Address <span style={{ color: "var(--ink-3)", fontWeight: 400, fontSize: "0.76rem" }}>(for future logins)</span></label>
                <input className="form-input" type="email" placeholder="you@example.com" value={setupEmail} onChange={e => setSetupEmail(e.target.value)} autoComplete="email" />
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Create Password <span style={{ fontWeight: 400, color: "var(--ink-3)", fontSize: "0.78rem" }}>(min 8 characters)</span></label>
              <div style={{ position: "relative" }}>
                <input className="form-input" type={setupShowPwd ? "text" : "password"} placeholder="Create a strong password" value={setupPwd} onChange={e => setSetupPwd(e.target.value)} autoComplete="new-password" style={{ paddingRight: "2.5rem" }} />
                <button type="button" onClick={() => setSetupShowPwd(v => !v)} style={{ position: "absolute", right: "0.6rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: "1rem", color: "var(--ink-3)" }}>
                  {setupShowPwd ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <input className="form-input" type={setupShowPwd ? "text" : "password"} placeholder="Re-enter your password" value={setupConfirmPwd} onChange={e => setSetupConfirmPwd(e.target.value)} autoComplete="new-password" onKeyDown={e => e.key === "Enter" && handleSetupAccount()} />
            </div>

            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={setupBusy} onClick={handleSetupAccount} style={{ padding: "0.8rem" }}>
              {setupBusy ? "Creating account…" : "Create Account & Continue →"}
            </button>
            <p style={{ textAlign: "center", fontSize: "0.72rem", color: "var(--ink-3)", margin: 0 }}>
              Next time log in with your email/phone + this password
            </p>
          </div>
        )}

        {/* ── Student (Phone) — Sign In (default) ─────────────────────────── */}
        {tab === "phone" && !showSetup && !registerMode && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div className="form-group">
              <label className="form-label">Mobile Number</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <span className="form-input" style={{ width: 56, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#f3f4f6", color: "var(--ink-3)", fontSize: "0.88rem", fontWeight: 600 }}>+91</span>
                <input className="form-input" type="tel" inputMode="numeric" maxLength={10} placeholder="10-digit mobile number" value={identifier} onChange={e => setIdentifier(e.target.value.replace(/\D/g, ""))} onKeyDown={e => e.key === "Enter" && handleSignIn()} autoComplete="tel-national" />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <div style={{ position: "relative" }}>
                <input className="form-input" type={showPwd ? "text" : "password"} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSignIn()} autoComplete="current-password" style={{ paddingRight: "2.5rem" }} />
                <button type="button" onClick={() => setShowPwd(v => !v)} style={{ position: "absolute", right: "0.6rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: "1rem", color: "var(--ink-3)" }}>
                  {showPwd ? "🙈" : "👁️"}
                </button>
              </div>
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy} onClick={handleSignIn} style={{ padding: "0.8rem" }}>
              {busy ? "Signing in…" : "Sign In →"}
            </button>
            <Divider label="new to the app?" />
            <button className="btn btn-ghost btn-full" onClick={() => { clearState(); setRegisterMode(true); }} style={{ fontSize: "0.82rem" }}>
              First time? Register with OTP →
            </button>
          </div>
        )}

        {/* ── Student (Phone) — Register: send OTP ────────────────────────── */}
        {tab === "phone" && !showSetup && registerMode && !otpSentTo && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ background: "var(--orange-light, #fff3eb)", borderRadius: 10, padding: "0.6rem 0.75rem", fontSize: "0.82rem", color: "var(--orange)", fontWeight: 500 }}>
              📋 One-time setup — you'll set a password after verifying your number
            </div>
            <div className="form-group">
              <label className="form-label">Mobile Number</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <span className="form-input" style={{ width: 56, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#f3f4f6", color: "var(--ink-3)", fontSize: "0.88rem", fontWeight: 600 }}>+91</span>
                <input className="form-input" type="tel" inputMode="numeric" maxLength={10} placeholder="10-digit mobile number" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ""))} onKeyDown={e => e.key === "Enter" && handleSendPhoneOtp()} />
              </div>
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy || phone.length < 10} onClick={handleSendPhoneOtp} style={{ padding: "0.8rem" }}>
              {busy ? "Sending OTP…" : "Send OTP →"}
            </button>
            <button className="btn btn-ghost btn-full" onClick={() => { setRegisterMode(false); clearState(); }} style={{ fontSize: "0.82rem" }}>
              ← Already have an account? Sign In
            </button>
          </div>
        )}

        {/* ── Student (Phone) — Register: verify OTP ──────────────────────── */}
        {tab === "phone" && !showSetup && registerMode && otpSentTo && otpTarget === "phone" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {info && <p style={{ fontSize: "0.82rem", color: "var(--green)", textAlign: "center", background: "var(--green-light)", borderRadius: 10, padding: "0.5rem 0.75rem" }}>{info}</p>}
            <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", textAlign: "center", margin: 0 }}>Enter the 6-digit OTP sent to {otpSentTo}</p>
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

        {/* ── Student (Email) — Sign In (default) ─────────────────────────── */}
        {tab === "email" && !showSetup && !registerMode && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input className="form-input" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSignIn()} autoComplete="username" />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <div style={{ position: "relative" }}>
                <input className="form-input" type={showPwd ? "text" : "password"} placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSignIn()} autoComplete="current-password" style={{ paddingRight: "2.5rem" }} />
                <button type="button" onClick={() => setShowPwd(v => !v)} style={{ position: "absolute", right: "0.6rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: "1rem", color: "var(--ink-3)" }}>
                  {showPwd ? "🙈" : "👁️"}
                </button>
              </div>
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy} onClick={handleSignIn} style={{ padding: "0.8rem" }}>
              {busy ? "Signing in…" : "Sign In →"}
            </button>
            <Divider label="new to the app?" />
            <button className="btn btn-ghost btn-full" onClick={() => { clearState(); setRegisterMode(true); }} style={{ fontSize: "0.82rem" }}>
              First time? Register with OTP →
            </button>
            <Divider label="forgot password?" />
            <button className="btn btn-ghost btn-full" onClick={() => switchTab("forgot")} style={{ fontSize: "0.82rem" }}>
              Reset Password
            </button>
          </div>
        )}

        {/* ── Student (Email) — Register: send OTP ────────────────────────── */}
        {tab === "email" && !showSetup && registerMode && !otpSentTo && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ background: "var(--orange-light, #fff3eb)", borderRadius: 10, padding: "0.6rem 0.75rem", fontSize: "0.82rem", color: "var(--orange)", fontWeight: 500 }}>
              📋 One-time setup — you'll set a password after verifying your email
            </div>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input className="form-input" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSendEmailOtp()} />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy || !email} onClick={handleSendEmailOtp} style={{ padding: "0.8rem" }}>
              {busy ? "Sending OTP…" : "Send OTP →"}
            </button>
            <button className="btn btn-ghost btn-full" onClick={() => { setRegisterMode(false); clearState(); }} style={{ fontSize: "0.82rem" }}>
              ← Already have an account? Sign In
            </button>
          </div>
        )}

        {/* ── Student (Email) — Register: verify OTP ──────────────────────── */}
        {tab === "email" && !showSetup && registerMode && otpSentTo && otpTarget === "email" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {info && <p style={{ fontSize: "0.82rem", color: "var(--green)", textAlign: "center", background: "var(--green-light)", borderRadius: 10, padding: "0.5rem 0.75rem" }}>{info}</p>}
            <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", textAlign: "center", margin: 0 }}>Enter the 6-digit OTP sent to {otpSentTo}</p>
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

        {/* ── Canteen / Admin Password Login (unchanged) ───────────────────── */}
        {tab === "password" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="form-input" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handlePasswordLogin()} />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy} onClick={handlePasswordLogin} style={{ padding: "0.8rem" }}>
              {busy ? "Signing in…" : "Sign In →"}
            </button>
            <p style={{ textAlign: "center", fontSize: "0.75rem", color: "var(--ink-3)", marginTop: "0.25rem" }}>
              🔐 Passwords are managed by your super admin. Contact them if you need access.
            </p>
          </div>
        )}

        {/* ── Forgot Password ──────────────────────────────────────────────── */}
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
