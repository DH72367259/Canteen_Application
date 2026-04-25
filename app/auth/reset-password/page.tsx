"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase-client";

function ResetPasswordContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const exchanged = useRef(false);

  // Exchange the auth code in the URL for a valid session first
  useEffect(() => {
    if (exchanged.current) return;
    exchanged.current = true;

    const code = params.get("code");
    const errorParam = params.get("error");
    const errorDesc = params.get("error_description");

    if (errorParam) {
      setInitError(errorDesc || errorParam);
      setReady(true);
      return;
    }

    if (!code) {
      // Old implicit-flow hash token — Supabase client picks it up automatically
      setReady(true);
      return;
    }

    const supabase = getSupabaseClient();
    supabase.auth.exchangeCodeForSession(code).then(({ error: exchErr }) => {
      if (exchErr) {
        setInitError("This reset link has expired. Please request a new one from the login page.");
      }
      setReady(true);
    });
  }, [params]);

  async function handleReset() {
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setBusy(true);
    setError("");
    const supabase = getSupabaseClient();
    const { error: updateErr } = await supabase.auth.updateUser({
      password,
      data: {
        has_password: true,
        password_changed_at: new Date().toISOString(),
        must_change_password: false,
      },
    });
    if (updateErr) {
      setError(updateErr.message);
      setBusy(false);
    } else {
      setDone(true);
      setTimeout(() => router.replace("/login"), 2500);
    }
  }

  if (!ready) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ display: "flex", justifyContent: "center" }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (initError) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ display: "flex", flexDirection: "column", gap: "1rem", textAlign: "center" }}>
          <span style={{ fontSize: "2rem" }}>⚠️</span>
          <h2 style={{ color: "var(--ink-1)", margin: 0 }}>Link Expired</h2>
          <p style={{ color: "var(--ink-3)", fontSize: "0.9rem", margin: 0 }}>{initError}</p>
          <button className="btn btn-primary" onClick={() => router.replace("/login")}>
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ display: "flex", flexDirection: "column", gap: "1rem", textAlign: "center", alignItems: "center" }}>
          <span style={{ fontSize: "2rem" }}>✅</span>
          <p style={{ color: "var(--ink-1)", fontWeight: 600 }}>Password updated!</p>
          <p style={{ color: "var(--ink-3)", fontSize: "0.85rem" }}>Redirecting to login…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <span style={{ width: 48, height: 48, background: "var(--orange)", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", margin: "0 auto 0.5rem" }}>🔑</span>
          <h1>Set New Password</h1>
          <p>Choose a strong password for your account</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div className="form-group">
            <label className="form-label">New Password</label>
            <input
              className="form-input"
              type="password"
              placeholder="At least 8 characters"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm Password</label>
            <input
              className="form-input"
              type="password"
              placeholder="Re-enter new password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleReset()}
            />
          </div>
          {error && <p className="error-msg">{error}</p>}
          <button
            className="btn btn-primary btn-full"
            disabled={busy || !password || !confirm}
            onClick={handleReset}
            style={{ padding: "0.8rem" }}
          >
            {busy ? "Updating…" : "Update Password →"}
          </button>
          <button className="btn btn-ghost btn-full" onClick={() => router.replace("/login")} style={{ fontSize: "0.82rem" }}>
            ← Back to Login
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="login-page">
          <div className="login-card" style={{ display: "flex", justifyContent: "center" }}>
            <div className="spinner" />
          </div>
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  );
}
