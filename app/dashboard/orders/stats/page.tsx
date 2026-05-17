"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

interface OrderItem { itemId: string; name: string; unitPrice: number; quantity: number; lineTotal: number }
interface DbOrder {
  id: string;
  total: number;
  status: string;
  rawStatus?: string;
  createdAt: string;
  canteenName?: string;
  items?: OrderItem[];
}

type RangeKey = "7d" | "30d" | "90d" | "180d";
const RANGES: { key: RangeKey; label: string; days: number }[] = [
  { key: "7d",   label: "Last 7 days",   days: 7   },
  { key: "30d",  label: "Last 30 days",  days: 30  },
  { key: "90d",  label: "Last 3 months", days: 90  },
  { key: "180d", label: "Last 6 months", days: 180 },
];

function inr(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export default function OrderStatsPage() {
  const router = useRouter();
  const { user, session, loading } = useAuth();
  const [range, setRange] = useState<RangeKey>("30d");
  const [orders, setOrders] = useState<DbOrder[]>([]);
  const [fetching, setFetching] = useState(true);

  useEffect(() => { if (!loading && !user) router.push("/login"); }, [loading, user, router]);

  useEffect(() => {
    if (!session?.access_token) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/orders", { headers: { Authorization: `Bearer ${session.access_token}` } });
        const d = await r.json();
        if (!cancelled && r.ok) setOrders((d.orders ?? []) as DbOrder[]);
      } catch { /* ignore */ }
      finally { if (!cancelled) setFetching(false); }
    })();
    return () => { cancelled = true; };
  }, [session?.access_token]);

  const { stats, recent } = useMemo(() => {
    const now = Date.now();
    const days = RANGES.find(r => r.key === range)!.days;
    const cutoff = now - days * 24 * 60 * 60 * 1000;
    // Only count orders that were actually paid for (not cancelled)
    const inRange = orders.filter(o => {
      const t = new Date(o.createdAt).getTime();
      const status = o.rawStatus ?? o.status;
      return t >= cutoff && status !== "cancelled";
    });
    const count = inRange.length;
    const spent = inRange.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const itemsCount = inRange.reduce((sum, o) => sum + (o.items?.reduce((s, i) => s + (Number(i.quantity) || 0), 0) ?? 0), 0);
    const avg = count > 0 ? spent / count : 0;
    // group by canteen
    const byCanteen = new Map<string, { count: number; spent: number }>();
    for (const o of inRange) {
      const k = o.canteenName ?? "Unknown";
      const prev = byCanteen.get(k) ?? { count: 0, spent: 0 };
      byCanteen.set(k, { count: prev.count + 1, spent: prev.spent + (Number(o.total) || 0) });
    }
    const topCanteens = Array.from(byCanteen.entries())
      .sort((a, b) => b[1].spent - a[1].spent)
      .slice(0, 5)
      .map(([name, v]) => ({ name, ...v }));
    return {
      stats: { count, spent, itemsCount, avg, topCanteens },
      recent: inRange.slice(0, 10),
    };
  }, [orders, range]);

  if (loading) return <div className="page-loading"><div className="spinner" /></div>;

  return (
    <div className="app-shell" style={{ flexDirection: "column" }}>
      {/* Top bar */}
      <div className="app-topbar">
        <h1 style={{ fontSize: "1.05rem", fontWeight: 700 }}>📊 Order Stats</h1>
        <Link href="/dashboard" style={{ fontSize: "0.8rem", color: "var(--orange)", textDecoration: "none", fontWeight: 700 }}>Order food →</Link>
      </div>

      {/* Range tabs */}
      <div className="slot-tabs" style={{ gap: "0.4rem", overflowX: "auto", padding: "0.5rem 1rem" }}>
        {RANGES.map(r => (
          <button
            key={r.key}
            className={`slot-tab ${range === r.key ? "active" : ""}`}
            onClick={() => setRange(r.key)}
            style={{ whiteSpace: "nowrap" }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ padding: "0.5rem 1rem 5rem", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
        {fetching && <p style={{ color: "var(--ink-3)", fontSize: "0.85rem" }}>Loading…</p>}

        {!fetching && stats.count === 0 && (
          <div className="empty-state">
            <span className="empty-icon">📊</span>
            <h3>No orders in this period</h3>
            <p>Try a longer range or place your first order.</p>
            <Link href="/dashboard" className="btn btn-primary" style={{ marginTop: "0.5rem" }}>Browse canteens</Link>
          </div>
        )}

        {!fetching && stats.count > 0 && (
          <>
            {/* KPI grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
              <div className="card" style={{ padding: "0.85rem" }}>
                <div style={{ fontSize: "0.7rem", color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase" }}>Total spent</div>
                <div style={{ fontSize: "1.4rem", fontWeight: 900, color: "var(--orange)", marginTop: "0.2rem" }}>{inr(stats.spent)}</div>
              </div>
              <div className="card" style={{ padding: "0.85rem" }}>
                <div style={{ fontSize: "0.7rem", color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase" }}>Orders placed</div>
                <div style={{ fontSize: "1.4rem", fontWeight: 900, color: "var(--ink)", marginTop: "0.2rem" }}>{stats.count}</div>
              </div>
              <div className="card" style={{ padding: "0.85rem" }}>
                <div style={{ fontSize: "0.7rem", color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase" }}>Items ordered</div>
                <div style={{ fontSize: "1.4rem", fontWeight: 900, color: "var(--ink)", marginTop: "0.2rem" }}>{stats.itemsCount}</div>
              </div>
              <div className="card" style={{ padding: "0.85rem" }}>
                <div style={{ fontSize: "0.7rem", color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase" }}>Avg / order</div>
                <div style={{ fontSize: "1.4rem", fontWeight: 900, color: "var(--ink)", marginTop: "0.2rem" }}>{inr(stats.avg)}</div>
              </div>
            </div>

            {/* Top canteens */}
            {stats.topCanteens.length > 0 && (
              <div className="card" style={{ padding: "0.85rem" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 800, marginBottom: "0.5rem" }}>🏆 Top canteens</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  {stats.topCanteens.map(c => (
                    <div key={c.name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.85rem" }}>
                      <span style={{ color: "var(--ink)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>{c.name}</span>
                      <span style={{ color: "var(--ink-3)", fontSize: "0.78rem" }}>{c.count} order{c.count > 1 ? "s" : ""} · <strong style={{ color: "var(--ink)" }}>{inr(c.spent)}</strong></span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent orders snippet */}
            <div className="card" style={{ padding: "0.85rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 800 }}>🧾 Recent orders</div>
                <Link href="/dashboard/orders" style={{ fontSize: "0.75rem", color: "var(--orange)", fontWeight: 700, textDecoration: "none" }}>See all →</Link>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {recent.map(o => (
                  <div key={o.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.82rem", borderBottom: "1px dashed var(--border)", paddingBottom: "0.3rem" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: "var(--ink)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.canteenName ?? "Canteen"}</div>
                      <div style={{ color: "var(--ink-3)", fontSize: "0.7rem" }}>{new Date(o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
                    </div>
                    <div style={{ color: "var(--ink)", fontWeight: 700 }}>{inr(Number(o.total) || 0)}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Bottom nav */}
      <nav className="bottom-nav">
        {[
          { tab: "home",    icon: "🏠", label: "Home",    href: "/dashboard" },
          { tab: "orders",  icon: "📊", label: "Stats",   href: "/dashboard/orders/stats" },
          { tab: "profile", icon: "👤", label: "Profile", href: "/dashboard/profile" },
        ].map(item => (
          <Link key={item.tab} href={item.href} className={`bottom-nav-item ${item.tab === "orders" ? "active" : ""}`}>
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
