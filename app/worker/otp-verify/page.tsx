"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function WorkerOtpVerifyPage() {
  const router = useRouter();
  const { user, session, loading } = useAuth();
  const [slotLabel, setSlotLabel] = useState("all");
  const [otp,       setOtp]       = useState("");
  const [busy,      setBusy]      = useState(false);
  const [result,    setResult]    = useState<{ ok: boolean; message: string; binCode?: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
    if (!loading && user && user.role !== "worker") router.push("/");
  }, [user, loading, router]);

  async function handleVerify() {
    if (otp.length < 4 || !session) return;
    setBusy(true); setResult(null);
    try {
      const res = await fetch("/api/orders/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ otp, slot_label: slotLabel !== "all" ? slotLabel : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      setResult({ ok: true, message: data.message ?? "Order marked collected ✅", binCode: data.bin_code });
      setOtp("");
    } catch (e: unknown) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Error" });
    } finally { setBusy(false); setTimeout(() => inputRef.current?.focus(), 100); }
  }

  if (loading) return <div className="page-loading"><div className="spinner" /></div>;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <div style={{ background: "#1e293b", color: "#fff", padding: "0.75rem 1rem", fontWeight: 700, fontSize: "1rem" }}>
        NoQx · OTP Verify (Backup)
      </div>

      <div style={{ padding: "1.5rem", paddingBottom: "5rem" }}>
        {/* Slot selector */}
        <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--ink-3)" }}>SLOT</label>
        <select
          value={slotLabel}
          onChange={e => setSlotLabel(e.target.value)}
          style={{ display: "block", width: "100%", padding: "0.75rem 1rem", fontSize: "0.95rem", border: "1.5px solid var(--border)", borderRadius: 12, marginTop: "0.35rem", marginBottom: "1.5rem", background: "#fff" }}
        >
          <option value="all">All Slots</option>
          <option value="morning">Morning</option>
          <option value="afternoon">Afternoon</option>
          <option value="evening">Evening</option>
          <option value="12:00">12:00 PM</option>
          <option value="12:30">12:30 PM</option>
          <option value="1:00">1:00 PM</option>
          <option value="1:30">1:30 PM</option>
          <option value="2:00">2:00 PM</option>
          <option value="7:00">7:00 PM</option>
          <option value="7:30">7:30 PM</option>
        </select>

        {/* OTP input — large and tap-friendly */}
        <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--ink-3)" }}>CUSTOMER OTP</label>
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={otp}
          onChange={e => { setOtp(e.target.value.replace(/\D/g, "")); setResult(null); }}
          placeholder="0 0 0 0"
          style={{ display: "block", width: "100%", padding: "1.25rem", fontSize: "2.5rem", letterSpacing: "0.6rem", fontWeight: 900, textAlign: "center", border: "2px solid var(--border)", borderRadius: 16, marginTop: "0.35rem", marginBottom: "1.5rem", background: "#fff", boxSizing: "border-box" }}
        />

        {/* Result banner */}
        {result && (
          <div style={{ background: result.ok ? "#f0fdf4" : "#fef2f2", border: `1.5px solid ${result.ok ? "#86efac" : "#fca5a5"}`, borderRadius: 14, padding: "1rem 1.25rem", marginBottom: "1.25rem", textAlign: "center" }}>
            <p style={{ fontWeight: 700, color: result.ok ? "#16a34a" : "#dc2626", fontSize: "1rem", margin: 0 }}>{result.message}</p>
            {result.ok && result.binCode && (
              <p style={{ fontSize: "0.82rem", color: "#16a34a", marginTop: "0.25rem" }}>Bin #{result.binCode} cleared ✅</p>
            )}
          </div>
        )}

        <button
          onClick={handleVerify}
          disabled={busy || otp.length < 4}
          style={{ width: "100%", padding: "1rem", background: otp.length < 4 ? "#e5e7eb" : "#1e293b", color: otp.length < 4 ? "var(--ink-3)" : "#fff", border: "none", borderRadius: 14, fontWeight: 700, fontSize: "1.05rem", cursor: otp.length < 4 ? "default" : "pointer" }}
        >
          {busy ? "Verifying..." : "Verify OTP"}
        </button>

        {/* Info card */}
        <div style={{ marginTop: "2rem", background: "#f8fafc", borderRadius: 14, padding: "1rem 1.25rem", border: "1px solid var(--border)" }}>
          <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--ink-3)", marginBottom: "0.5rem" }}>HOW TO USE</p>
          <p style={{ fontSize: "0.82rem", color: "var(--ink-2)", margin: 0, lineHeight: 1.6 }}>
            Use this when a customer&apos;s app cannot show the OTP (offline / glitch). Ask the customer to share their 4‑digit OTP verbally. Enter it here to mark their order as collected and free the bin.
          </p>
        </div>
      </div>

      <div className="bottom-nav">
        <button className="nav-item" onClick={() => router.push("/worker/orders")}>📦<span>Orders</span></button>
        <button className="nav-item" onClick={() => router.push("/worker/bins")}>🧺<span>Bins</span></button>
        <button className="nav-item active">🔐<span>OTP Verify</span></button>
      </div>
    </div>
  );
}
