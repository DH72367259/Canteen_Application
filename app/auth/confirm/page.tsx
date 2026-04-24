"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase-client";

function ConfirmContent() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const errorParam = params.get("error");
    const errorDesc = params.get("error_description");

    if (errorParam) {
      setError(errorDesc || errorParam);
      return;
    }

    const supabase = getSupabaseClient();

    async function finish() {
      // ── Case 1: PKCE code in query string ──────────────────────────
      const code = params.get("code");
      if (code) {
        const { error: exchErr } = await supabase.auth.exchangeCodeForSession(code);
        if (!exchErr) {
          router.replace("/login");
          return;
        }
        // PKCE exchange failed (e.g. opened on a different device) — fall through
      }

      // ── Case 2: Implicit-flow tokens in the URL hash ────────────────
      // With flowType:'implicit', Supabase puts access_token in #hash.
      // detectSessionInUrl:true in the client handles this automatically on page load.
      // We just wait briefly for onAuthStateChange to fire, then redirect.
      if (typeof window !== "undefined" && window.location.hash.includes("access_token=")) {
        // The client automatically extracts the token from the hash and sets the session.
        await new Promise(r => setTimeout(r, 1500));
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          router.replace("/login");
          return;
        }
      }

      // ── Case 3: Token in query params (some Supabase flows) ─────────
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error: setErr } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (!setErr) {
          router.replace("/login");
          return;
        }
      }

      // All methods failed
      setError("This link has expired or has already been used. Please request a new OTP from the login page.");
    }

    finish();
  }, [params, router]);

  if (error) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ display: "flex", flexDirection: "column", gap: "1rem", textAlign: "center" }}>
          <span style={{ fontSize: "2rem" }}>⚠️</span>
          <h2 style={{ color: "var(--ink-1)", margin: 0 }}>Link Expired</h2>
          <p style={{ color: "var(--ink-3)", fontSize: "0.9rem", margin: 0 }}>{error}</p>
          <p style={{ color: "var(--ink-3)", fontSize: "0.82rem", margin: 0 }}>
            💡 Tip: Use the 6-digit OTP code from the email instead of clicking the link — it works on any device.
          </p>
          <button className="btn btn-primary" onClick={() => router.replace("/login")}>
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card" style={{ display: "flex", flexDirection: "column", gap: "1rem", alignItems: "center" }}>
        <div className="spinner" />
        <p style={{ color: "var(--ink-3)", margin: 0 }}>Confirming your account…</p>
      </div>
    </div>
  );
}

export default function AuthConfirmPage() {
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
      <ConfirmContent />
    </Suspense>
  );
}

