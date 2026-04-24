"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getSupabaseClient } from "@/lib/supabase-client";

/**
 * /change-password
 *
 * Shown automatically on first login when an admin has set a temporary password
 * (user_metadata.must_change_password === true). The user must set a new password
 * before accessing any dashboard.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, session, logout } = useAuth();
  const [newPwd,    setNewPwd]    = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showPwd,   setShowPwd]   = useState(false);
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  // If the user doesn't need to change password, redirect away
  useEffect(() => {
    if (!user) { router.replace("/login"); return; }
    // Staff passwords are managed by super_admin only — block self-service
    const staffRoles = ["canteen_admin", "vendor", "worker", "co_admin"];
    if (staffRoles.includes(user.role ?? "")) {
      const role = user.role;
      if (role === "vendor" || role === "canteen_admin") router.replace("/vendor/dashboard");
      else router.replace("/login");
      return;
    }
    if (!user.mustChangePassword) {
      // Already changed — go to appropriate dashboard
      const role = user.role;
      if (role === "vendor" || role === "canteen_admin") router.replace("/vendor/dashboard");
      else if (role === "super_admin" || role === "co_admin") router.replace("/admin/dashboard");
      else if (role === "worker")                        router.replace("/worker/dashboard");
      else                                               router.replace("/dashboard");
    }
  }, [user, router]);

  async function handleSubmit() {
    setError(null);
    if (!newPwd)               { setError("Please enter a new password."); return; }
    if (newPwd.length < 8)     { setError("Password must be at least 8 characters."); return; }
    if (newPwd !== confirmPwd) { setError("Passwords do not match."); return; }

    setBusy(true);
    try {
      const supabase = getSupabaseClient();

      // 1. Update the password in Supabase auth
      const { error: updateErr } = await supabase.auth.updateUser({ password: newPwd });
      if (updateErr) throw updateErr;

      // 2. Clear the must_change_password flag and mark has_password + password_changed_at
      await supabase.auth.updateUser({
        data: {
          must_change_password: false,
          has_password: true,
          password_changed_at: new Date().toISOString(),
        },
      });

      // 3. Also clear it via our server-side API (which uses service role to be certain)
      if (session?.access_token) {
        await fetch("/api/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ password: newPwd }),
        });
      }

      // 4. Redirect to the right dashboard
      const role = user?.role;
      if (role === "vendor" || role === "canteen_admin") router.replace("/vendor/dashboard");
      else if (role === "super_admin")                   router.replace("/admin/dashboard");
      else                                               router.replace("/dashboard");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update password. Please try again.");
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <span style={{ width: 48, height: 48, background: "var(--orange)", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem", margin: "0 auto 0.5rem" }}>🔑</span>
          <h1>Set Your Password</h1>
          <p>This is your first login. Please set a new password to continue.</p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div className="form-group">
            <label className="form-label">New Password <span style={{ fontWeight: 400, color: "var(--ink-3)", fontSize: "0.78rem" }}>(min 8 characters)</span></label>
            <div style={{ position: "relative" }}>
              <input
                className="form-input"
                type={showPwd ? "text" : "password"}
                placeholder="Enter a new password"
                value={newPwd}
                onChange={e => setNewPwd(e.target.value)}
                autoComplete="new-password"
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

          <div className="form-group">
            <label className="form-label">Confirm New Password</label>
            <input
              className="form-input"
              type={showPwd ? "text" : "password"}
              placeholder="Re-enter your new password"
              value={confirmPwd}
              onChange={e => setConfirmPwd(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()}
              autoComplete="new-password"
            />
          </div>

          {error && <p className="error-msg">{error}</p>}

          <button className="btn btn-primary btn-full" onClick={handleSubmit} disabled={busy} style={{ padding: "0.8rem" }}>
            {busy ? "Saving…" : "Set Password & Continue →"}
          </button>

          <button
            className="btn btn-ghost btn-full"
            onClick={() => { logout(); router.replace("/login"); }}
            style={{ fontSize: "0.82rem" }}
          >
            ← Sign out
          </button>
        </div>

        <p style={{ textAlign: "center", fontSize: "0.73rem", color: "var(--ink-3)", marginTop: "0.25rem" }}>
          By continuing you agree to our{" "}
          <a href="/terms" style={{ color: "var(--orange)" }}>Terms</a> &amp;{" "}
          <a href="/privacy" style={{ color: "var(--orange)" }}>Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}
