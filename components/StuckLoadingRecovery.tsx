"use client";

/**
 * StuckLoadingRecovery — fixed-position banner that appears when the
 * auth context stays in `loading=true` for more than 10 seconds, which
 * is well past the auth-context's own 2.5s safety timeout. If you see
 * this banner, the most likely cause is a corrupted cookie or stale
 * service-worker cache (the Brave-cookie-partitioning case the user hit
 * on 2026-05-19 is the canonical example).
 *
 * The banner exposes a single "Reset & retry" button that calls
 * auth-context's resetSession(), which wipes every piece of local
 * storage we own and hard-reloads to the login page.
 *
 * Mounted once globally in app/layout.tsx so every route inherits it.
 * Renders nothing while loading is healthy (<10s) or after recovery,
 * so it has zero visual cost on normal page loads.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";

const STUCK_THRESHOLD_MS = 10_000;

export function StuckLoadingRecovery() {
  const { loading, resetSession } = useAuth();
  const [showBanner, setShowBanner] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading) {
      setShowBanner(false);
      return;
    }
    const id = setTimeout(() => setShowBanner(true), STUCK_THRESHOLD_MS);
    return () => clearTimeout(id);
  }, [loading]);

  if (!showBanner) return null;

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        left: "50%",
        bottom: "1rem",
        transform: "translateX(-50%)",
        width: "calc(100% - 2rem)",
        maxWidth: 420,
        background: "#1e293b",
        color: "#fff",
        borderRadius: 14,
        padding: "0.85rem 1rem",
        boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
        zIndex: 9998,
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
      }}
    >
      <div style={{ fontSize: "1.4rem" }}>⚠️</div>
      <div style={{ flex: 1, minWidth: 0, fontSize: "0.82rem", lineHeight: 1.4 }}>
        <div style={{ fontWeight: 700, marginBottom: "0.15rem" }}>
          Taking longer than expected
        </div>
        <div style={{ color: "#cbd5e1" }}>
          Clearing saved data usually fixes this.
        </div>
      </div>
      <button
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          try { await resetSession(); }
          catch {
            // resetSession reloads on success, so an exception means it
            // never reached the reload — surface that to the user.
            setBusy(false);
            alert("Reset failed. Please clear your browser's site data manually and retry.");
          }
        }}
        disabled={busy}
        style={{
          flexShrink: 0,
          padding: "0.55rem 0.9rem",
          background: busy ? "#475569" : "#f97316",
          color: "#fff",
          border: "none",
          borderRadius: 10,
          fontWeight: 700,
          fontSize: "0.82rem",
          cursor: busy ? "not-allowed" : "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {busy ? "Resetting…" : "Reset & retry"}
      </button>
    </div>
  );
}
