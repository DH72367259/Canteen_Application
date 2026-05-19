"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

interface Bin {
  id: string;
  bin_code: number;
  color: string;
  status: "empty" | "occupied" | "overdue" | "grace_expired";
  order_count: number;
  active_order_ref?: string | null;
  customer_name?: string | null;
}

const BIN_COLORS: Record<string, string> = {
  red: "#ef4444", blue: "#3b82f6", green: "#22c55e",
  yellow: "#eab308", purple: "#a855f7", orange: "#f97316",
};

export default function WorkerBinsPage() {
  const router = useRouter();
  const { user, session, loading } = useAuth();
  const [bins, setBins]         = useState<Bin[]>([]);
  const [fetching, setFetching] = useState(true);
  const [selected, setSelected] = useState<Bin | null>(null);
  const [orderRef, setOrderRef] = useState("");
  const [busy, setBusy]         = useState(false);
  const [msg, setMsg]           = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
    if (!loading && user && user.role !== "worker") router.push("/worker/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!session) return;
    let aborted = false;

    async function fetchBins() {
      try {
        const res  = await fetch("/api/bins", { headers: { Authorization: `Bearer ${session!.access_token}` } });
        const data = await res.json();
        if (!aborted) { setBins(data.bins ?? []); setFetching(false); }
      } catch { if (!aborted) setFetching(false); }
    }

    fetchBins();
    const iv = setInterval(fetchBins, 5000);
    return () => { aborted = true; clearInterval(iv); };
  }, [session]);

  async function handleMarkPicked() {
    if (!selected || !session || orderRef.trim().length < 4) return;
    setBusy(true); setMsg(null);
    try {
      const res  = await fetch(`/api/bins/${selected.id}/mark-picked`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ orderRef: orderRef.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to mark picked.");
      setMsg("✅ Handover confirmed — bin cleared.");
      setOrderRef("");
      setSelected(null);
      setBins(prev => prev.map(b => b.id === selected.id ? { ...b, status: "empty" as const, order_count: 0 } : b));
    } catch (e: unknown) {
      setMsg(`❌ ${e instanceof Error ? e.message : "Error"}`);
    } finally { setBusy(false); }
  }

  const normalBins  = bins.filter(b => !["overdue", "grace_expired"].includes(b.status));
  const overdueBins = bins.filter(b => ["overdue", "grace_expired"].includes(b.status));

  if (loading || fetching) return <div className="page-loading"><div className="spinner" /></div>;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <div style={{ background: "#1e293b", color: "#fff", padding: "calc(env(safe-area-inset-top, 0) + 0.75rem) 1rem 0.75rem", fontWeight: 700, fontSize: "1rem", position: "sticky", top: 0, zIndex: 20 }}>
        Canteen-Application · Bin Management
      </div>

      <div style={{ padding: "1rem", paddingBottom: "5rem" }}>
        {/* Normal bins grid */}
        <h3 style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--ink-3)", marginBottom: "0.75rem" }}>BINS ({normalBins.length})</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1.5rem" }}>
          {normalBins.map(bin => {
            const bgColor = bin.status === "empty" ? "#e5e7eb" : (BIN_COLORS[bin.color] ?? "#f97316");
            return (
              <button key={bin.id} onClick={() => { if (bin.status !== "empty") { setSelected(bin); setMsg(null); setOrderRef(""); } }} style={{ background: bgColor, borderRadius: 14, padding: "0.75rem 0.5rem", textAlign: "center", border: "none", cursor: bin.status !== "empty" ? "pointer" : "default", opacity: bin.status === "empty" ? 0.5 : 1, boxShadow: "0 2px 6px rgba(0,0,0,0.12)" }}>
                <div style={{ color: bin.status === "empty" ? "var(--ink-3)" : "#fff", fontWeight: 900, fontSize: "1.75rem", lineHeight: 1 }}>{bin.bin_code}</div>
                {bin.order_count > 0 && <div style={{ color: "rgba(255,255,255,0.85)", fontSize: "0.7rem", marginTop: "0.2rem" }}>{bin.order_count} orders</div>}
              </button>
            );
          })}
        </div>

        {/* Overdue bins */}
        {overdueBins.length > 0 && (
          <>
            <h3 style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--red)", marginBottom: "0.75rem" }}>⚠️ OVERDUE / GRACE-EXPIRED ({overdueBins.length})</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem", marginBottom: "1.5rem" }}>
              {overdueBins.map(bin => (
                <button key={bin.id} onClick={() => { setSelected(bin); setMsg(null); setOrderRef(""); }} style={{ background: "#ef4444", borderRadius: 14, padding: "0.75rem 0.5rem", textAlign: "center", border: "2px solid #fca5a5", cursor: "pointer", boxShadow: "0 2px 6px rgba(0,0,0,0.12)" }}>
                  <div style={{ color: "#fff", fontWeight: 900, fontSize: "1.75rem", lineHeight: 1 }}>{bin.bin_code}</div>
                  <div style={{ color: "rgba(255,255,255,0.85)", fontSize: "0.65rem", marginTop: "0.2rem" }}>OVERDUE</div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Handover confirmation modal (manager-absent fallback) */}
        {selected && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "1rem" }}>
            <div style={{ background: "#fff", borderRadius: 20, padding: "1.5rem", width: "100%", maxWidth: 360 }}>
              <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Bin {selected.bin_code} — Handover</h3>
              <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", marginBottom: "1rem" }}>No. of items: {selected.order_count}</p>
              <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", marginBottom: "0.35rem" }}>
                Student: <strong>{selected.customer_name || "Unknown"}</strong>
              </p>
              <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", marginBottom: "0.75rem" }}>
                Expected Order Ref: <strong>{selected.active_order_ref || "N/A"}</strong>
              </p>
              <input
                type="text"
                inputMode="text"
                maxLength={6}
                value={orderRef}
                onChange={e => setOrderRef(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                placeholder="Enter order ref"
                style={{ width: "100%", padding: "0.85rem", fontSize: "1.5rem", textAlign: "center", letterSpacing: "0.3rem", fontWeight: 700, border: "2px solid var(--border)", borderRadius: 12, marginBottom: "0.75rem", boxSizing: "border-box" }}
              />
              {msg && <p style={{ fontSize: "0.82rem", color: msg.startsWith("✅") ? "var(--green)" : "var(--red)", marginBottom: "0.75rem", textAlign: "center" }}>{msg}</p>}
              <button onClick={handleMarkPicked} disabled={busy || orderRef.trim().length < 4} style={{ width: "100%", padding: "0.85rem", background: "#1e293b", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: "1rem", cursor: "pointer", marginBottom: "0.5rem" }}>
                {busy ? "Verifying..." : "Confirm Order Ref & Mark Picked"}
              </button>
              <button onClick={() => { setSelected(null); setMsg(null); setOrderRef(""); }} style={{ width: "100%", padding: "0.6rem", background: "none", border: "none", color: "var(--ink-3)", cursor: "pointer", fontSize: "0.88rem" }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bottom-nav">
        <button className="nav-item" onClick={() => router.push("/worker/orders")}>📦<span>Orders</span></button>
        <button className="nav-item active">🧺<span>Bins</span></button>
      </div>
    </div>
  );
}
