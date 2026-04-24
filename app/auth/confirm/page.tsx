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

    const code = params.get("code");
    const supabase = getSupabaseClient();

    async function finish() {
      if (code) {
        const { error: exchErr } = await supabase.auth.exchangeCodeForSession(code);
        if (exchErr) {
          setError("This confirmation link has expired or already been used. Please request a new one.");
          return;
        }
      }
      // Session is now active — onAuthStateChange in auth-context will pick it up.
      // Redirect to /login which immediately re-checks user and routes to the right dashboard.
      router.replace("/login");
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
