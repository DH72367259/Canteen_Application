"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function WorkerLoginPage() {
  const router = useRouter();
  const { user, loading, signInWithIdentifier } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Redirect if already logged in as worker
  useEffect(() => {
    if (!loading && user) {
      if (user.role === "worker") router.replace("/worker/dashboard");
      else router.replace("/");
    }
  }, [user, loading, router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim() || !password.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithIdentifier(identifier.trim(), password);
      // Auth context will redirect via useEffect above
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed. Check your credentials.";
      setError(
        msg.toLowerCase().includes("database error") || msg.toLowerCase().includes("querying schema")
          ? "Login service temporarily unavailable. Contact your admin or try again shortly."
          : msg.toLowerCase().includes("invalid login credentials") || msg.toLowerCase().includes("invalid credentials")
          ? "Incorrect email or password. Please check and try again."
          : msg
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#1e293b" }}>
      <div className="spinner" style={{ borderTopColor: "#f97316" }} />
    </div>
  );

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(160deg, #1e293b 0%, #0f172a 100%)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "1.5rem",
    }}>
      {/* Logo / Header */}
      <div style={{ marginBottom: "2rem", textAlign: "center" }}>
        <div style={{
          width: 64, height: 64, borderRadius: 18,
          background: "linear-gradient(135deg, #f97316, #ea6a07)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "2rem", margin: "0 auto 1rem",
          boxShadow: "0 8px 24px rgba(249,115,22,0.35)",
        }}>
          🧑‍🍳
        </div>
        <h1 style={{ color: "#fff", fontSize: "1.5rem", fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>
          Worker Portal
        </h1>
        <p style={{ color: "#94a3b8", fontSize: "0.85rem", marginTop: "0.35rem" }}>
          Canteen-Application · Staff Login
        </p>
      </div>

      {/* Login Card */}
      <form onSubmit={handleLogin} style={{
        width: "100%", maxWidth: 380,
        background: "#fff",
        borderRadius: 20,
        padding: "2rem",
        boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
      }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1.5rem", color: "#1e293b" }}>
          Sign in to your account
        </h2>

        <div style={{ marginBottom: "1rem" }}>
          <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#475569", display: "block", marginBottom: "0.4rem" }}>
            Email / Username
          </label>
          <input
            type="text"
            value={identifier}
            onChange={e => setIdentifier(e.target.value)}
            placeholder="your@email.com or username"
            autoComplete="username"
            required
            style={{
              width: "100%", padding: "0.75rem 0.9rem",
              border: "1.5px solid #e2e8f0", borderRadius: 10,
              fontSize: "0.95rem", boxSizing: "border-box",
              outline: "none",
            }}
          />
        </div>

        <div style={{ marginBottom: "1.5rem" }}>
          <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#475569", display: "block", marginBottom: "0.4rem" }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter your password"
            autoComplete="current-password"
            required
            style={{
              width: "100%", padding: "0.75rem 0.9rem",
              border: "1.5px solid #e2e8f0", borderRadius: 10,
              fontSize: "0.95rem", boxSizing: "border-box",
              outline: "none",
            }}
          />
        </div>

        {error && (
          <div style={{
            background: "#fef2f2", border: "1px solid #fecaca",
            borderRadius: 8, padding: "0.65rem 0.85rem",
            fontSize: "0.82rem", color: "#dc2626",
            marginBottom: "1rem",
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !identifier.trim() || !password.trim()}
          style={{
            width: "100%", padding: "0.85rem",
            background: busy ? "#94a3b8" : "linear-gradient(135deg, #f97316, #ea6a07)",
            color: "#fff", border: "none", borderRadius: 12,
            fontWeight: 700, fontSize: "1rem", cursor: busy ? "not-allowed" : "pointer",
            boxShadow: busy ? "none" : "0 4px 12px rgba(249,115,22,0.35)",
            transition: "all 0.15s",
          }}
        >
          {busy ? "Signing in…" : "Sign In"}
        </button>

        <p style={{ marginTop: "1.25rem", textAlign: "center", fontSize: "0.78rem", color: "#94a3b8" }}>
          Not a worker?{" "}
          <button
            type="button"
            onClick={() => router.push("/login")}
            style={{ background: "none", border: "none", color: "#f97316", cursor: "pointer", fontWeight: 600, fontSize: "0.78rem" }}
          >
            Go to main login
          </button>
        </p>
      </form>
    </div>
  );
}
