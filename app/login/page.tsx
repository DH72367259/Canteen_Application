"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getSupabaseClient } from "@/lib/supabase-client";

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
    signInWithIdentifier, signInWithPassword,
    logout,
  } = useAuth();

  type Tab = "student" | "password" | "forgot";
  const roleParam = params.get("role") || "user";
  const [tab, setTab] = useState<Tab>(roleParam === "user" ? "student" : "password");

  // ── Common state ──────────────────────────────────────────────────────────
  const [email,      setEmail]     = useState("");
  const [password,   setPassword]  = useState("");
  const [identifier, setIdentifier] = useState(""); // @username or 10-digit phone for sign-in
  const [otp,        setOtp]       = useState("");
  const [otpSentTo,  setOtpSentTo] = useState<string | null>(null);
  const [busy,       setBusy]      = useState(false);
  const [error,      setError]     = useState<string | null>(null);
  const [info,       setInfo]      = useState<string | null>(null);
  const [showPwd,    setShowPwd]   = useState(false);

  // ── Student tab mode: default = sign-in, toggle = register (email OTP) ────
  const [registerMode, setRegisterMode] = useState(false);

  // ── Account setup form — shown after first-ever email OTP verification ─────
  const [showSetup,       setShowSetup]       = useState(false);
  const [setupName,       setSetupName]       = useState("");
  const [setupUsername,   setSetupUsername]   = useState("");
  const [setupPhone,      setSetupPhone]      = useState("");
  const [setupPwd,        setSetupPwd]        = useState("");
  const [setupConfirmPwd, setSetupConfirmPwd] = useState("");
  const [setupBusy,       setSetupBusy]       = useState(false);
  const [setupShowPwd,    setSetupShowPwd]    = useState(false);

  // ── Forgot tab — password reset via OTP ──────────────────────────────────
  const [showPasswordReset,  setShowPasswordReset]  = useState(false);
  const [newPassword,        setNewPassword]        = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showNewPwd,         setShowNewPwd]         = useState(false);

  // ── Password-expired banner (set by hard 30-day signOut in auth-context) ──
  const [pwExpired, setPwExpired] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem("canteen_pw_expired") === "1") {
      setPwExpired(true);
      localStorage.removeItem("canteen_pw_expired");
    }
  }, []);

  // ── Guards: prevent stale-session silent redirects ───────────────────────
  // loginInitiatedRef  — set to true ONLY when the user explicitly triggers a
  //   login action on this page (password sign-in, OTP verify, canteen login).
  // hasSeenNullUserRef — set to true the first time loading=false with user=null.
  //   Once set, any later user!=null arrival that wasn't from an explicit login
  //   (e.g. background token refresh, cross-tab event, delayed getSession) is
  //   treated as a stale restore and ignored so the login form stays visible.
  const loginInitiatedRef  = useRef(false);
  const hasSeenNullUserRef = useRef(false);

  // ── Auth redirect logic ───────────────────────────────────────────────────
  useEffect(() => {
    // Always wait for auth to fully resolve before acting.
    if (loading) return;

    if (!user) {
      // Confirm we've seen the unauthenticated state at least once after load.
      hasSeenNullUserRef.current = true;
      return;
    }

    // user is non-null here.
    // If we previously confirmed the user was NOT logged in (hasSeenNullUser)
    // AND no explicit login was initiated on this page, this is a silent
    // background restore (token refresh, delayed getSession, etc.).
    // Do NOT redirect — the user must explicitly log in.
    if (hasSeenNullUserRef.current && !loginInitiatedRef.current) {
      return;
    }

    loginInitiatedRef.current = false; // reset for the next login attempt

    // Staff accounts are created by super_admin — they never go through OTP setup
    const isStaff = ["canteen_admin", "vendor", "super_admin", "worker", "co_admin"].includes(user.role ?? "");

    // First-time user hasn't set a password yet → show account setup (students only,
    // and ONLY when actively in the OTP register flow — not just any visit to /login)
    if (!user.hasPassword && !showSetup && !isStaff && registerMode) {
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
  }, [user, loading, router, params, showSetup, registerMode]);

  function clearState() { setError(null); setInfo(null); setOtp(""); setOtpSentTo(null); }
  function switchTab(t: Tab) {
    setEmail(""); setPassword(""); setIdentifier("");
    setOtp(""); setOtpSentTo(null);
    setError(null); setInfo(null);
    setRegisterMode(false); setShowSetup(false); setShowPwd(false);
    setShowPasswordReset(false); setNewPassword(""); setConfirmNewPassword(""); setShowNewPwd(false);
    setTab(t);
  }

  // ── Student sign-in — username or phone + password ─────────────────────
  async function handleSignIn() {
    const id = identifier.trim().replace(/^@/, "");
    if (!id) { setError("Enter your username or 10-digit mobile number."); return; }
    if (!password) { setError("Enter your password."); return; }
    setBusy(true); setError(null);
    try {
      loginInitiatedRef.current = true;
      await signInWithIdentifier(id, password);
      setTimeout(() => setBusy(false), 10000);
    } catch (e: unknown) {
      loginInitiatedRef.current = false;
      const msg = e instanceof Error ? e.message : "Login failed.";
      setError(
        msg.toLowerCase().includes("invalid login credentials") || msg.toLowerCase().includes("invalid credentials")
          ? "Incorrect username / phone or password. If you're new, tap 'Register' below."
          : msg.toLowerCase().includes("timed out")
          ? "Connection timed out. Check your internet and try again."
          : msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("no account")
          ? "No account found with that username. Try your phone number instead, or register."
          : msg
      );
      setBusy(false);
    }
  }

  // ── Email OTP — first-time registration ──────────────────────────────────
  async function handleSendEmailOtp() {
    const emailTrimmed = email.trim();
    if (!emailTrimmed) { setError("Enter your email address."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) { setError("Enter a valid email address."); return; }
    setBusy(true); clearState();
    try {
      await sendEmailOtp(emailTrimmed);
      setOtpSentTo(emailTrimmed);
      setInfo(`Verification code sent to ${emailTrimmed}. Check your inbox (and spam folder).`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send code. Please try again.");
    } finally { setBusy(false); }
  }

  async function handleVerifyEmailOtp() {
    if (otp.length < 6) { setError("Enter the 6-digit code from your email."); return; }
    if (!otpSentTo) return;
    setBusy(true); setError(null);
    try {
      loginInitiatedRef.current = true;
      await verifyEmailOtp(otpSentTo, otp);
      // After verify: useEffect detects user.hasPassword === false + registerMode → shows setup
      setTimeout(() => setBusy(false), 8000);
    } catch (e: unknown) {
      loginInitiatedRef.current = false;
      setError(e instanceof Error ? e.message : "Invalid or expired code. Please try again.");
      setBusy(false);
    }
  }

  // ── Account setup — called once after email OTP verification ─────────────
  async function handleSetupAccount() {
    setError(null);
    if (!setupName.trim())            { setError("Enter your name."); return; }
    if (!setupUsername.trim())        { setError("Choose a username."); return; }
    const usernameClean = setupUsername.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(usernameClean)) {
      setError("Username must be 3–20 characters: letters, numbers, or underscore (_) only.");
      return;
    }
    const phoneDigits = setupPhone.replace(/\D/g, "");
    if (phoneDigits.length !== 10) { setError("Enter a valid 10-digit Indian mobile number."); return; }
    if (!setupPwd)                  { setError("Create a password (min 8 characters)."); return; }
    if (setupPwd.length < 8)        { setError("Password must be at least 8 characters."); return; }
    if (setupPwd !== setupConfirmPwd) { setError("Passwords do not match."); return; }

    setSetupBusy(true);
    try {
      const res = await fetch("/api/auth/setup-account", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          displayName: setupName.trim(),
          username: usernameClean,
          phone: `+91${phoneDigits}`,
          password: setupPwd,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to set up account.");
      }
      // Refresh session so user_metadata.has_password: true is reflected
      await getSupabaseClient().auth.refreshSession();
      const role = user?.role;
      if (role === "vendor" || role === "canteen_admin") router.replace("/vendor/dashboard");
      else if (role === "super_admin") router.replace("/admin/dashboard");
      else if (role === "worker") router.replace("/worker/dashboard");
      else router.replace("/dashboard");
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
      loginInitiatedRef.current = true;  // explicit login — allow redirect
      await signInWithPassword(email, password);
      setTimeout(() => setBusy(false), 10000);
    } catch (e: unknown) {
      loginInitiatedRef.current = false;  // reset: login failed, stay on form
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

  // ── Forgot password — email OTP flow ────────────────────────────────────
  async function handleForgotSendCode() {
    const emailTrimmed = email.trim();
    if (!emailTrimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      setError("Enter a valid email address."); return;
    }
    setBusy(true); setError(null); setInfo(null);
    try {
      await sendEmailOtp(emailTrimmed);
      setOtpSentTo(emailTrimmed);
      setInfo(`Verification code sent to ${emailTrimmed}. Check your inbox.`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send code. Please try again.");
    } finally { setBusy(false); }
  }

  async function handleForgotVerifyOtp() {
    if (otp.length < 6) { setError("Enter the 6-digit code from your email."); return; }
    if (!otpSentTo) return;
    setBusy(true); setError(null);
    try {
      // Do NOT set loginInitiatedRef — OTP verify here must NOT trigger dashboard redirect
      await verifyEmailOtp(otpSentTo, otp);
      setShowPasswordReset(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Invalid or expired code. Please try again.");
    } finally { setBusy(false); }
  }

  async function handleForgotResetPassword() {
    if (newPassword.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (newPassword !== confirmNewPassword) { setError("Passwords do not match."); return; }
    setBusy(true); setError(null);
    try {
      const { error } = await getSupabaseClient().auth.updateUser({
        password: newPassword,
        data: {
          has_password: true,
          password_changed_at: new Date().toISOString(),
          must_change_password: false,
        },
      });
      if (error) throw error;
      await logout();
      switchTab("student");
      setInfo("✅ Password updated! Sign in with your new password.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update password. Please try again.");
      setBusy(false);
    }
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
            {(["student", "password"] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => switchTab(t)}
                style={{
                  flex: 1, padding: "0.55rem 0.25rem", fontWeight: 600,
                  border: "none", cursor: "pointer",
                  background: tab === t ? "var(--orange)" : "transparent",
                  color: tab === t ? "#fff" : "var(--ink-3)",
                  transition: "all 0.15s",
                }}
              >
                {t === "student" ? "🎓 Student" : "🏢 Canteen Login"}
              </button>
            ))}
          </div>
        )}

        {/* ── Account Setup (first-time, after email OTP verified) ───────────── */}
        {showSetup && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ textAlign: "center", padding: "0.25rem 0 0.5rem" }}>
              <span style={{ fontSize: "2rem" }}>🎉</span>
              <p style={{ fontWeight: 700, color: "var(--ink-1)", margin: "0.3rem 0 0.15rem", fontSize: "1.05rem" }}>
                Email Verified!
              </p>
              <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", margin: 0 }}>
                Complete your profile — you&apos;ll use your username or phone number to log in from now on
              </p>
            </div>

            <div className="form-group">
              <label className="form-label">Your Name</label>
              <input
                className="form-input"
                type="text"
                placeholder="What should we call you?"
                value={setupName}
                onChange={e => setSetupName(e.target.value)}
                autoFocus
                autoComplete="name"
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                Username{" "}
                <span style={{ fontSize: "0.74rem", color: "var(--ink-3)", fontWeight: 400 }}>(3–20 chars · letters, numbers, _)</span>
              </label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "var(--ink-3)", fontSize: "0.9rem", pointerEvents: "none" }}>@</span>
                <input
                  className="form-input"
                  type="text"
                  placeholder="john_doe"
                  value={setupUsername}
                  onChange={e => setSetupUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())}
                  autoComplete="username"
                  autoCapitalize="none"
                  style={{ paddingLeft: "1.75rem" }}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">
                Mobile Number{" "}
                <span style={{ fontSize: "0.74rem", color: "var(--ink-3)", fontWeight: 400 }}>(you can also use this to log in)</span>
              </label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <span className="form-input" style={{ width: 56, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#f3f4f6", color: "var(--ink-3)", fontSize: "0.88rem", fontWeight: 600 }}>+91</span>
                <input
                  className="form-input"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="10-digit mobile number"
                  value={setupPhone}
                  onChange={e => setSetupPhone(e.target.value.replace(/\D/g, ""))}
                  autoComplete="tel-national"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">
                Create Password{" "}
                <span style={{ fontWeight: 400, color: "var(--ink-3)", fontSize: "0.78rem" }}>(min 8 characters)</span>
              </label>
              <div style={{ position: "relative" }}>
                <input
                  className="form-input"
                  type={setupShowPwd ? "text" : "password"}
                  placeholder="Create a strong password"
                  value={setupPwd}
                  onChange={e => setSetupPwd(e.target.value)}
                  autoComplete="new-password"
                  style={{ paddingRight: "2.5rem" }}
                />
                <button
                  type="button"
                  onClick={() => setSetupShowPwd(v => !v)}
                  style={{ position: "absolute", right: "0.6rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: "1rem", color: "var(--ink-3)" }}
                >
                  {setupShowPwd ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <input
                className="form-input"
                type={setupShowPwd ? "text" : "password"}
                placeholder="Re-enter your password"
                value={setupConfirmPwd}
                onChange={e => setSetupConfirmPwd(e.target.value)}
                autoComplete="new-password"
                onKeyDown={e => e.key === "Enter" && handleSetupAccount()}
              />
            </div>

            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={setupBusy} onClick={handleSetupAccount} style={{ padding: "0.8rem" }}>
              {setupBusy ? "Creating account…" : "Create Account & Continue →"}
            </button>
            <p style={{ textAlign: "center", fontSize: "0.72rem", color: "var(--ink-3)", margin: 0 }}>
              After this, log in with your <strong>@username</strong> or <strong>phone number</strong> + password
            </p>
          </div>
        )}

        {/* ── Student — Sign In (username or phone + password) ─────────────── */}
        {tab === "student" && !showSetup && !registerMode && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div className="form-group">
              <label className="form-label">Username or Mobile Number</label>
              <input
                className="form-input"
                type="text"
                placeholder="@username  or  10-digit number"
                value={identifier}
                onChange={e => setIdentifier(e.target.value.replace(/\s/g, ""))}
                onKeyDown={e => e.key === "Enter" && handleSignIn()}
                autoComplete="username"
                autoCapitalize="none"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <div style={{ position: "relative" }}>
                <input
                  className="form-input"
                  type={showPwd ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSignIn()}
                  autoComplete="current-password"
                  style={{ paddingRight: "2.5rem" }}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  style={{ position: "absolute", right: "0.6rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: "1rem", color: "var(--ink-3)" }}
                >
                  {showPwd ? "🙈" : "👁️"}
                </button>
              </div>
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy} onClick={handleSignIn} style={{ padding: "0.8rem" }}>
              {busy ? "Signing in…" : "Sign In →"}
            </button>
            <button className="btn btn-ghost btn-full" onClick={() => switchTab("forgot")} style={{ fontSize: "0.82rem" }}>
              Forgot Password?
            </button>
            <Divider label="new to the app?" />
            <button className="btn btn-ghost btn-full" onClick={() => { clearState(); setRegisterMode(true); }} style={{ fontSize: "0.82rem" }}>
              Register with Email →
            </button>
          </div>
        )}

        {/* ── Student — Register: enter email ──────────────────────────────── */}
        {tab === "student" && !showSetup && registerMode && !otpSentTo && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ background: "var(--orange-light, #fff3eb)", borderRadius: 10, padding: "0.6rem 0.75rem", fontSize: "0.82rem", color: "var(--orange)", fontWeight: 500 }}>
              📧 One-time setup — verify your email, then choose a username &amp; password
            </div>
            <div className="form-group">
              <label className="form-label">Gmail or Email Address</label>
              <input
                className="form-input"
                type="email"
                placeholder="you@gmail.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSendEmailOtp()}
                autoComplete="email"
                autoFocus
              />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy || !email} onClick={handleSendEmailOtp} style={{ padding: "0.8rem" }}>
              {busy ? "Sending code…" : "Send Verification Code →"}
            </button>
            <button className="btn btn-ghost btn-full" onClick={() => { setRegisterMode(false); clearState(); }} style={{ fontSize: "0.82rem" }}>
              ← Already have an account? Sign In
            </button>
          </div>
        )}

        {/* ── Student — Register: verify email OTP ─────────────────────────── */}
        {tab === "student" && !showSetup && registerMode && otpSentTo && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {info && (
              <p style={{ fontSize: "0.82rem", color: "var(--green)", textAlign: "center", background: "var(--green-light)", borderRadius: 10, padding: "0.5rem 0.75rem" }}>
                {info}
              </p>
            )}
            <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", textAlign: "center", margin: 0 }}>
              Enter the 6-digit code sent to <strong>{otpSentTo}</strong>
            </p>
            <OtpInput value={otp} onChange={setOtp} length={6} />
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy || otp.length < 6} onClick={handleVerifyEmailOtp} style={{ padding: "0.8rem" }}>
              {busy ? "Verifying…" : "Verify Code →"}
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

        {/* ── Forgot Password — Step 1: enter email ────────────────────── */}
        {tab === "forgot" && !otpSentTo && !showPasswordReset && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", margin: 0, textAlign: "center" }}>
              Enter your registered email — we&apos;ll send a verification code to confirm it&apos;s you.
            </p>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input className="form-input" type="email" placeholder="you@example.com" value={email} autoFocus onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handleForgotSendCode()} autoComplete="email" />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy || !email} onClick={handleForgotSendCode} style={{ padding: "0.8rem" }}>
              {busy ? "Sending code…" : "Send Verification Code →"}
            </button>
            <button className="btn btn-ghost btn-full" onClick={() => switchTab("student")} style={{ fontSize: "0.82rem" }}>
              ← Back to Sign In
            </button>
          </div>
        )}

        {/* ── Forgot Password — Step 2: enter OTP ─────────────────────────── */}
        {tab === "forgot" && otpSentTo && !showPasswordReset && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {info && <p style={{ fontSize: "0.82rem", color: "var(--green)", textAlign: "center", background: "var(--green-light)", borderRadius: 10, padding: "0.5rem 0.75rem" }}>{info}</p>}
            <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", textAlign: "center", margin: 0 }}>
              Enter the 6-digit code sent to <strong>{otpSentTo}</strong>
            </p>
            <OtpInput value={otp} onChange={setOtp} length={6} />
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy || otp.length < 6} onClick={handleForgotVerifyOtp} style={{ padding: "0.8rem" }}>
              {busy ? "Verifying…" : "Verify Code →"}
            </button>
            <button className="btn btn-ghost btn-full" onClick={() => { setOtpSentTo(null); setOtp(""); setError(null); setInfo(null); }} style={{ fontSize: "0.82rem" }}>
              ← Change email
            </button>
          </div>
        )}

        {/* ── Forgot Password — Step 3: set new password ──────────────────── */}
        {tab === "forgot" && showPasswordReset && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ textAlign: "center" }}>
              <span style={{ fontSize: "1.5rem" }}>🔑</span>
              <p style={{ fontWeight: 700, color: "var(--ink-1)", margin: "0.3rem 0 0.1rem" }}>Set New Password</p>
              <p style={{ fontSize: "0.8rem", color: "var(--ink-3)", margin: 0 }}>Your email, username, and phone stay the same.</p>
            </div>
            <div className="form-group">
              <label className="form-label">New Password <span style={{ fontWeight: 400, color: "var(--ink-3)", fontSize: "0.78rem" }}>(min 8 characters)</span></label>
              <div style={{ position: "relative" }}>
                <input className="form-input" type={showNewPwd ? "text" : "password"} placeholder="Create a strong password" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" style={{ paddingRight: "2.5rem" }} />
                <button type="button" onClick={() => setShowNewPwd(v => !v)} style={{ position: "absolute", right: "0.6rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: "1rem", color: "var(--ink-3)" }}>
                  {showNewPwd ? "🙈" : "👁️"}
                </button>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Confirm New Password</label>
              <input className="form-input" type={showNewPwd ? "text" : "password"} placeholder="Re-enter your new password" value={confirmNewPassword} onChange={e => setConfirmNewPassword(e.target.value)} autoComplete="new-password" onKeyDown={e => e.key === "Enter" && handleForgotResetPassword()} />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy || !newPassword || !confirmNewPassword} onClick={handleForgotResetPassword} style={{ padding: "0.8rem" }}>
              {busy ? "Updating…" : "Update Password →"}
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
