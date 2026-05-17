"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import QRCameraScanner from "@/components/QRCameraScanner";

type Mode = "otp" | "qr";

export default function WorkerOtpVerifyPage() {
  const router = useRouter();
  const { user, session, loading } = useAuth();
  const [mode, setMode]         = useState<Mode>("otp");
  const [otp, setOtp]           = useState("");
  const [busy, setBusy]         = useState(false);
  const [result, setResult]     = useState<{ ok: boolean; message: string } | null>(null);
  const inputRef                = useRef<HTMLInputElement>(null);
  const streamPromiseRef        = useRef<Promise<MediaStream> | null>(null);
  const [qrRetryKey, setQrRetryKey] = useState(0);

  useEffect(() => {
    if (loading) return;
    // Give Supabase a tick to restore the session before redirecting.
    // Without this, a transient race during reload would bounce the worker
    // to /login — making it look like "retry logged me out".
    if (!user) {
      const timer = setTimeout(() => {
        if (!loading && !user) router.push("/worker/login");
      }, 400);
      return () => clearTimeout(timer);
    }
    if (user.role !== "worker") router.push("/worker/login");
  }, [user, loading, router]);

  // Called by QRCameraScanner when a NOQX QR payload is detected.
  const handleQrScanned = useCallback(async (decodedText: string) => {
    const parts = decodedText.split("|");
    if (parts.length !== 4 || parts[0] !== "NOQX") return;
    const orderId = parts[1];
    if (!session) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/verify-qr`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ qrPayload: decodedText }),
      });
      const data = await res.json() as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      setResult({ ok: true, message: "Order collected ✅  Bin freed." });
      streamPromiseRef.current = null;
    } catch (e: unknown) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Verification failed" });
    } finally {
      setBusy(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  function switchMode(next: Mode) {
    if (next === "qr") {
      // Start getUserMedia synchronously in the click handler — Chrome Android
      // requires this to show the permission dialog. If mediaDevices is
      // unavailable (HTTP context, iframe), QRCameraScanner falls back to its
      // own "Start Camera" button instead of crashing the page.
      try {
        streamPromiseRef.current = navigator.mediaDevices?.getUserMedia({
          video: { facingMode: "environment" },
        }) ?? null;
      } catch {
        streamPromiseRef.current = null;
      }
      setQrRetryKey(k => k + 1);
    } else {
      streamPromiseRef.current = null;
    }
    setResult(null);
    setOtp("");
    setMode(next);
  }

  async function handleVerifyOtp() {
    if (otp.length < 4 || !session) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/orders/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ otp }),
      });
      const data = await res.json() as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      setResult({ ok: true, message: data.message ?? "Order marked collected ✅" });
      setOtp("");
    } catch (e: unknown) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Error" });
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  if (loading) return <div className="page-loading"><div className="spinner" /></div>;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* Top bar */}
      <div style={{ background: "#1e293b", color: "#fff", padding: "0.75rem 1rem", fontWeight: 700, fontSize: "1rem" }}>
        NOQX · Verify Order
      </div>

      {/* Mode toggle */}
      <div style={{ display: "flex", background: "#f1f5f9", margin: "1rem 1rem 0", borderRadius: 12, padding: 4, gap: 4 }}>
        {(["otp", "qr"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            style={{
              flex: 1, padding: "0.65rem 0", border: "none", borderRadius: 9, cursor: "pointer",
              fontWeight: 700, fontSize: "0.88rem",
              background: mode === m ? "#1e293b" : "transparent",
              color: mode === m ? "#fff" : "#64748b",
              transition: "all 0.15s",
            }}
          >
            {m === "otp" ? "🔢 Enter OTP" : "📷 Scan QR"}
          </button>
        ))}
      </div>

      <div style={{ padding: "1.25rem", paddingBottom: "6rem" }}>

        {/* ── OTP MODE ── */}
        {mode === "otp" && (
          <>
            <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--ink-3)" }}>CUSTOMER OTP</label>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={e => { setOtp(e.target.value.replace(/\D/g, "")); setResult(null); }}
              placeholder="0 0 0 0"
              style={{
                display: "block", width: "100%", padding: "1.25rem",
                fontSize: "2.5rem", letterSpacing: "0.6rem", fontWeight: 900,
                textAlign: "center", border: "2px solid var(--border)", borderRadius: 16,
                marginTop: "0.35rem", marginBottom: "1.5rem", background: "#fff",
                boxSizing: "border-box",
              }}
            />

            {result && (
              <div style={{
                background: result.ok ? "#f0fdf4" : "#fef2f2",
                border: `1.5px solid ${result.ok ? "#86efac" : "#fca5a5"}`,
                borderRadius: 14, padding: "1rem 1.25rem", marginBottom: "1.25rem", textAlign: "center",
              }}>
                <p style={{ fontWeight: 700, color: result.ok ? "#16a34a" : "#dc2626", fontSize: "1rem", margin: 0 }}>
                  {result.message}
                </p>
              </div>
            )}

            <button
              onClick={handleVerifyOtp}
              disabled={busy || otp.length < 4}
              style={{
                width: "100%", padding: "1rem",
                background: otp.length < 4 ? "#e5e7eb" : "#1e293b",
                color: otp.length < 4 ? "var(--ink-3)" : "#fff",
                border: "none", borderRadius: 14, fontWeight: 700, fontSize: "1.05rem",
                cursor: otp.length < 4 ? "default" : "pointer",
              }}
            >
              {busy ? "Verifying..." : "Verify OTP"}
            </button>

            <div style={{ marginTop: "2rem", background: "#f8fafc", borderRadius: 14, padding: "1rem 1.25rem", border: "1px solid var(--border)" }}>
              <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--ink-3)", marginBottom: "0.5rem" }}>HOW TO USE</p>
              <p style={{ fontSize: "0.82rem", color: "var(--ink-2)", margin: 0, lineHeight: 1.6 }}>
                Ask the student to share their OTP verbally. Enter it here to mark the order as collected and free the bin.
              </p>
            </div>
          </>
        )}

        {/* ── QR SCAN MODE ── */}
        {mode === "qr" && (
          <>
            {/* Success state */}
            {result?.ok && (
              <div style={{ textAlign: "center", paddingTop: "2rem" }}>
                <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>✅</div>
                <p style={{ fontWeight: 700, color: "#16a34a", fontSize: "1.1rem" }}>{result.message}</p>
                <button
                  onClick={() => setResult(null)}
                  style={{ marginTop: "1.5rem", padding: "0.75rem 2.5rem", background: "#1e293b", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: "0.95rem", cursor: "pointer" }}
                >
                  Scan Next Order
                </button>
              </div>
            )}

            {/* Error state */}
            {result && !result.ok && (
              <div style={{ textAlign: "center", paddingTop: "1rem" }}>
                <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 14, padding: "1.25rem", marginBottom: "1.5rem" }}>
                  <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>❌</div>
                  <p style={{ fontWeight: 700, color: "#dc2626", fontSize: "0.95rem", margin: 0 }}>{result.message}</p>
                </div>
                <button
                  onClick={() => setResult(null)}
                  style={{ padding: "0.75rem 2.5rem", background: "#1e293b", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: "0.95rem", cursor: "pointer" }}
                >
                  Try Again
                </button>
              </div>
            )}

            {/* Scanner state — no result yet */}
            {!result && (
              <>
                <p style={{ fontSize: "0.85rem", color: "#64748b", textAlign: "center", marginBottom: "1rem", fontWeight: 500 }}>
                  Point camera at the student&apos;s QR code
                </p>

                <QRCameraScanner
                  key={qrRetryKey}
                  streamPromise={streamPromiseRef.current}
                  onScanned={handleQrScanned}
                />

                {busy && (
                  <p style={{ textAlign: "center", marginTop: "1rem", color: "#64748b", fontWeight: 600, fontSize: "0.9rem" }}>
                    Verifying QR...
                  </p>
                )}

                <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
                  <button
                    onClick={() => {
                      try {
                        streamPromiseRef.current = navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment" } }) ?? null;
                      } catch {
                        streamPromiseRef.current = null;
                      }
                      setQrRetryKey(k => k + 1);
                    }}
                    style={{ flex: 1, padding: "0.75rem", background: "#1e293b", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: "0.88rem", cursor: "pointer" }}
                  >
                    Try Again
                  </button>
                  <button
                    onClick={() => switchMode("otp")}
                    style={{ flex: 1, padding: "0.75rem", background: "#f1f5f9", color: "#1e293b", border: "1.5px solid #cbd5e1", borderRadius: 12, fontWeight: 700, fontSize: "0.88rem", cursor: "pointer" }}
                  >
                    Use OTP Instead
                  </button>
                </div>

                <div style={{ marginTop: "1.5rem", background: "#f8fafc", borderRadius: 14, padding: "1rem 1.25rem", border: "1px solid var(--border)" }}>
                  <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--ink-3)", marginBottom: "0.5rem" }}>HOW TO USE</p>
                  <p style={{ fontSize: "0.82rem", color: "var(--ink-2)", margin: 0, lineHeight: 1.6 }}>
                    Ask the student to open their Order Status screen. The QR rotates every 30 seconds — scan while it&apos;s fresh. Once verified, the bin is freed automatically.
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{
        position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
        width: "100%", maxWidth: 430, background: "var(--surface,#fff)",
        borderTop: "1px solid var(--border,#e2e8f0)", display: "flex", zIndex: 30,
        paddingBottom: "env(safe-area-inset-bottom,0.5rem)", pointerEvents: "none",
      }}>
        {([
          { label: "Orders",     icon: "📦", href: "/worker/orders",     active: false },
          { label: "Bins",       icon: "🧺", href: "/worker/bins",       active: false },
          { label: "Verify",     icon: "🔐", href: "/worker/otp-verify", active: true  },
        ] as { label: string; icon: string; href: string; active: boolean }[]).map(({ label, icon, href, active }) => (
          <button key={label} onClick={() => router.push(href)}
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
              gap: "0.2rem", padding: "0.5rem 0", background: "none", border: "none",
              cursor: "pointer", fontSize: "0.65rem", fontWeight: 600,
              color: active ? "var(--orange,#f97316)" : "var(--ink-3,#64748b)",
              pointerEvents: "auto",
            }}>
            <span style={{ fontSize: "1.35rem" }}>{icon}</span>{label}
          </button>
        ))}
      </div>
    </div>
  );
}
