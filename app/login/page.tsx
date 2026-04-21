"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

function LoginContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, adminLogin, userLogin } = useAuth();

  const roleParam = params.get("role") || "user";

  const [tab, setTab] = useState<"user" | "staff">(
    roleParam === "user" ? "user" : "staff"
  );
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [email, setEmail] = useState(
    roleParam === "vendor" ? "vendor@noqx.in" :
    roleParam === "super-admin" ? "admin@noqx.in" :
    roleParam === "canteen-admin" ? "canteen@noqx.in" : ""
  );
  const [password, setPassword] = useState(
    roleParam === "vendor" ? "vendor123" :
    roleParam === "super-admin" ? "admin123" :
    roleParam === "canteen-admin" ? "canteen123" : ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      if (user.role === "vendor" || user.role === "canteen_admin") router.push("/vendor/dashboard");
      else if (user.role === "super_admin") router.push("/admin/dashboard");
      else if (user.role === "worker") router.push("/worker/dashboard");
      else router.push("/dashboard");
    }
  }, [user, router]);

  async function handleUserLogin() {
    if (!otpSent) {
      if (phone.length < 10) { setError("Enter a valid 10-digit phone number."); return; }
      setBusy(true);
      // Mock: just send OTP
      await new Promise(r => setTimeout(r, 800));
      setOtpSent(true);
      setError(null);
      setBusy(false);
      return;
    }
    if (otp !== "1234") { setError("Wrong OTP. Use 1234 for demo."); return; }
    setBusy(true);
    await userLogin(phone, name || undefined);
    setBusy(false);
  }

  async function handleStaffLogin() {
    if (!email || !password) { setError("Enter email and password."); return; }
    setBusy(true);
    setError(null);
    try {
      await adminLogin(email, password);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <span style={{ width: 44, height: 44, background: "var(--orange)", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem" }}>🍽️</span>
          </div>
          <h1>NoQx</h1>
          <p>Smart Institutional Dining</p>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", border: "1.5px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
          <button
            onClick={() => { setTab("user"); setError(null); }}
            style={{ flex: 1, padding: "0.6rem", fontSize: "0.85rem", fontWeight: 600, border: "none", cursor: "pointer", background: tab === "user" ? "var(--orange)" : "transparent", color: tab === "user" ? "#fff" : "var(--ink-3)", transition: "all 0.15s" }}
          >Student / User</button>
          <button
            onClick={() => { setTab("staff"); setError(null); }}
            style={{ flex: 1, padding: "0.6rem", fontSize: "0.85rem", fontWeight: 600, border: "none", cursor: "pointer", background: tab === "staff" ? "var(--orange)" : "transparent", color: tab === "staff" ? "#fff" : "var(--ink-3)", transition: "all 0.15s" }}
          >Staff / Vendor</button>
        </div>

        {tab === "user" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {!otpSent ? (
              <>
                <div className="form-group">
                  <label className="form-label">Your Name (optional)</label>
                  <input className="form-input" type="text" placeholder="e.g. Arjun Sharma" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Mobile Number</label>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <span className="form-input" style={{ width: 52, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#f3f4f6", color: "var(--ink-3)", fontSize: "0.9rem" }}>+91</span>
                    <input className="form-input" type="tel" maxLength={10} placeholder="98765 43210" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ""))} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", textAlign: "center" }}>
                  OTP sent to +91 {phone}. <br /><strong style={{ color: "var(--orange)" }}>(Demo OTP: 1234)</strong>
                </p>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {[0, 1, 2, 3].map(i => (
                    <input
                      key={i}
                      className="otp-digit"
                      type="text"
                      maxLength={1}
                      value={otp[i] || ""}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, "");
                        const next = otp.split("");
                        next[i] = val;
                        setOtp(next.join("").slice(0, 4));
                        if (val && i < 3) {
                          const nextInput = document.querySelector<HTMLInputElement>(`input.otp-digit:nth-of-type(${i + 2})`);
                          nextInput?.focus();
                        }
                      }}
                    />
                  ))}
                </div>
              </>
            )}
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy} onClick={handleUserLogin} style={{ padding: "0.8rem" }}>
              {busy ? "Please wait…" : otpSent ? "Verify OTP" : "Send OTP"}
            </button>
            {otpSent && (
              <button className="btn btn-ghost btn-full" onClick={() => { setOtpSent(false); setOtp(""); setError(null); }} style={{ fontSize: "0.82rem" }}>
                ← Change number
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div style={{ background: "var(--orange-light)", border: "1px solid #fed7aa", borderRadius: 12, padding: "0.65rem 0.85rem", fontSize: "0.78rem", color: "var(--orange-dark)" }}>
              <strong>Demo accounts:</strong><br />
              vendor@noqx.in / vendor123 · admin@noqx.in / admin123
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" placeholder="vendor@noqx.in" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input className="form-input" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleStaffLogin()} />
            </div>
            {error && <p className="error-msg">{error}</p>}
            <button className="btn btn-primary btn-full" disabled={busy} onClick={handleStaffLogin} style={{ padding: "0.8rem" }}>
              {busy ? "Signing in…" : "Sign In"}
            </button>
          </div>
        )}

        <p style={{ textAlign: "center", fontSize: "0.75rem", color: "var(--ink-3)", marginTop: "0.25rem" }}>
          By continuing you agree to our Terms & Privacy Policy
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

