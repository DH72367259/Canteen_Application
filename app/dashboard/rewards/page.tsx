"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

// Window.Razorpay is declared in cart/page.tsx global — no duplicate needed here

interface WalletTx {
  id: string;
  type: "topup" | "withdrawal" | "earned" | "redeemed" | "expired";
  amount: number;
  payment_method?: string;
  description?: string;
  status: string;
  created_at: string;
}

const MIN_TOPUP = 100;
const MIN_RESERVE = 100; // ₹100 must remain — cannot be withdrawn
const TOPUP_PRESETS = [100, 200, 500, 1000];

export default function RewardsPage() {
  const router = useRouter();
  const { user, session, loading, concurrentSession, clearConcurrentSession, forceLogoutAllSessions } = useAuth();

  const [balance, setBalance] = useState(user?.walletBalance ?? 0);
  const [transactions, setTransactions] = useState<WalletTx[]>([]);
  const [fetching, setFetching] = useState(true);

  // Top-up state
  const [showTopUp, setShowTopUp] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState<string>("");
  const [topUpError, setTopUpError] = useState("");
  const [topUpLoading, setTopUpLoading] = useState(false);
  const [topUpSuccess, setTopUpSuccess] = useState<{ amount: number; newBalance: number } | null>(null);

  // Withdraw state
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState<string>("");
  const [withdrawError, setWithdrawError] = useState("");
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawSuccess, setWithdrawSuccess] = useState<{ message: string; refundId: string; method: string } | null>(null);

  // Concurrent session
  const [forcingLogout, setForcingLogout] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  const fetchWallet = useCallback(async () => {
    if (!session?.access_token) { setFetching(false); return; }
    try {
      const res = await fetch("/api/wallet", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      setBalance(data.balance ?? 0);
      setTransactions(data.transactions ?? []);
    } catch { /* ignore */ } finally {
      setFetching(false);
    }
  }, [session?.access_token]);

  useEffect(() => { fetchWallet(); }, [fetchWallet]);

  const withdrawable = Math.max(0, balance - MIN_RESERVE);

  // ── Top Up via Razorpay ──────────────────────────────────────
  const handleTopUp = async () => {
    setTopUpError("");
    const amount = Number(topUpAmount);
    if (!amount || amount < MIN_TOPUP) { setTopUpError(`Minimum top-up is ₹${MIN_TOPUP}.`); return; }
    if (!session?.access_token) return;
    setTopUpLoading(true);
    try {
      const orderRes = await fetch("/api/wallet/topup", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const orderData = await orderRes.json();
      if (!orderRes.ok) { setTopUpError(orderData.error ?? "Failed to create order."); setTopUpLoading(false); return; }

      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script");
          s.src = "https://checkout.razorpay.com/v1/checkout.js";
          s.onload = () => resolve();
          s.onerror = () => reject(new Error("Razorpay script failed to load"));
          document.head.appendChild(s);
        });
      }

      const rzp = new window.Razorpay({
        key: orderData.keyId,
        amount: orderData.amount,
        currency: orderData.currency,
        name: "Canteen Cash",
        description: "Wallet Top-Up",
        order_id: orderData.orderId,
        prefill: { email: user?.email ?? undefined, contact: user?.phone ?? undefined },
        theme: { color: "#ea580c" },
        modal: { ondismiss: () => setTopUpLoading(false) },
        handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string; method?: string }) => {
          const verifyRes = await fetch("/api/wallet/topup/verify", {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              amount: orderData.amount,
              payment_method: response.method ?? "unknown",
            }),
          });
          const verifyData = await verifyRes.json();
          if (verifyRes.ok && verifyData.success) {
            setBalance(verifyData.newBalance);
            setTopUpSuccess({ amount: verifyData.credited, newBalance: verifyData.newBalance });
            setShowTopUp(false);
            setTopUpAmount("");
            fetchWallet();
          } else {
            setTopUpError(verifyData.error ?? "Payment verification failed.");
          }
          setTopUpLoading(false);
        },
      });
      rzp.open();
    } catch (e) {
      setTopUpError(e instanceof Error ? e.message : "Something went wrong.");
      setTopUpLoading(false);
    }
  };

  // ── Withdraw ─────────────────────────────────────────────────
  const handleWithdraw = async () => {
    setWithdrawError("");
    const amount = Number(withdrawAmount);
    if (!amount || amount <= 0) { setWithdrawError("Enter a valid amount."); return; }
    if (amount > withdrawable) { setWithdrawError(`You can withdraw at most ₹${withdrawable}. ₹${MIN_RESERVE} must remain.`); return; }
    if (!session?.access_token) return;
    setWithdrawLoading(true);
    try {
      const res = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setWithdrawError(data.error ?? "Withdrawal failed.");
      } else {
        setBalance(data.newBalance);
        setWithdrawSuccess({ message: data.message, refundId: data.refundId, method: data.refundMethod });
        setShowWithdraw(false);
        setWithdrawAmount("");
        fetchWallet();
      }
    } catch { setWithdrawError("Network error. Please try again."); }
    finally { setWithdrawLoading(false); }
  };

  const handleForceLogout = async () => {
    setForcingLogout(true);
    await forceLogoutAllSessions();
    setForcingLogout(false);
  };

  if (loading) return <div className="page-loading"><div className="spinner" /></div>;

  return (
    <div className="app-shell">

      {/* ── Concurrent session modal ── */}
      {concurrentSession && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: "1.5rem", maxWidth: 380, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ fontSize: "1.8rem", textAlign: "center", marginBottom: "0.75rem" }}>⚠️</div>
            <h3 style={{ fontWeight: 800, textAlign: "center", marginBottom: "0.5rem" }}>Active session detected</h3>
            <p style={{ fontSize: "0.85rem", color: "var(--ink-3)", textAlign: "center", marginBottom: "1rem" }}>Your account is already signed in on another device:</p>
            <div style={{ background: "#f3f4f6", borderRadius: 10, padding: "0.65rem 0.85rem", fontSize: "0.78rem", color: "var(--ink-2)", marginBottom: "1.25rem", wordBreak: "break-all" }}>
              📱 {concurrentSession.existingDevice || "Another device"}
            </div>
            <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", marginBottom: "1rem", textAlign: "center" }}>Log out from all other places and continue here?</p>
            <button onClick={handleForceLogout} disabled={forcingLogout} style={{ width: "100%", background: "var(--orange)", color: "#fff", border: "none", borderRadius: 12, padding: "0.8rem", fontSize: "0.92rem", fontWeight: 700, cursor: "pointer", marginBottom: "0.5rem" }}>
              {forcingLogout ? "Signing out everywhere…" : "Yes, log out all other sessions"}
            </button>
            <button onClick={clearConcurrentSession} style={{ width: "100%", background: "none", border: "1.5px solid var(--border)", borderRadius: 12, padding: "0.7rem", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer", color: "var(--ink-3)" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Top bar ── */}
      <div className="app-topbar">
        <button onClick={() => router.back()} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem", color: "var(--ink-3)" }}>←</button>
        <h1 style={{ fontSize: "1.05rem", fontWeight: 700 }}>Canteen Cash</h1>
        <div />
      </div>

      {/* ── Balance card ── */}
      <div className="rewards-balance-card">
        <div className="balance-label">Total Balance</div>
        <div className="balance-amount">₹{balance}</div>
        <div style={{ fontSize: "0.75rem", opacity: 0.75, marginTop: "0.4rem" }}>
          Withdrawable: ₹{withdrawable}
          {withdrawable < balance && ` · ₹${MIN_RESERVE} reserved`}
        </div>
      </div>

      {/* ── Success banners ── */}
      {topUpSuccess && (
        <div style={{ margin: "0 1rem", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 14, padding: "0.75rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontWeight: 700, color: "#15803d", fontSize: "0.88rem" }}>✅ ₹{topUpSuccess.amount} added!</div>
            <div style={{ fontSize: "0.75rem", color: "var(--ink-3)" }}>New balance: ₹{topUpSuccess.newBalance}</div>
          </div>
          <button onClick={() => setTopUpSuccess(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", fontSize: "1.1rem" }}>✕</button>
        </div>
      )}
      {withdrawSuccess && (
        <div style={{ margin: "0 1rem", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 14, padding: "0.75rem 1rem" }}>
          <div style={{ fontWeight: 700, color: "var(--blue)", fontSize: "0.88rem" }}>✅ Withdrawal initiated</div>
          <div style={{ fontSize: "0.75rem", color: "var(--ink-3)", marginTop: "0.2rem" }}>{withdrawSuccess.message}</div>
          <div style={{ fontSize: "0.7rem", color: "var(--ink-3)", marginTop: "0.15rem" }}>Refund ID: {withdrawSuccess.refundId}</div>
        </div>
      )}

      {/* ── Action buttons ── */}
      <div style={{ display: "flex", gap: "0.75rem", padding: "1rem 1rem 0" }}>
        <button onClick={() => { setShowTopUp(true); setTopUpError(""); setTopUpAmount(""); }}
          style={{ flex: 1, background: "var(--orange)", color: "#fff", border: "none", borderRadius: 14, padding: "0.85rem", fontSize: "0.92rem", fontWeight: 700, cursor: "pointer" }}>
          + Add Money
        </button>
        <button onClick={() => { setShowWithdraw(true); setWithdrawError(""); setWithdrawAmount(""); }} disabled={withdrawable <= 0}
          style={{ flex: 1, background: withdrawable > 0 ? "var(--blue-light)" : "#f3f4f6", color: withdrawable > 0 ? "var(--blue)" : "var(--ink-3)", border: `1.5px solid ${withdrawable > 0 ? "var(--blue)" : "var(--border)"}`, borderRadius: 14, padding: "0.85rem", fontSize: "0.92rem", fontWeight: 700, cursor: withdrawable > 0 ? "pointer" : "not-allowed" }}>
          Withdraw
        </button>
      </div>

      {/* ── Wallet rules ── */}
      <div style={{ margin: "0.75rem 1rem 0", background: "#fefce8", border: "1px solid #fde047", borderRadius: 12, padding: "0.75rem 0.9rem", fontSize: "0.76rem", color: "#713f12" }}>
        <strong>💰 Wallet rules:</strong>
        <ul style={{ margin: "0.3rem 0 0", paddingLeft: "1.1rem", lineHeight: 1.8 }}>
          <li>Minimum top-up: <strong>₹{MIN_TOPUP}</strong></li>
          <li>₹{MIN_RESERVE} minimum balance must always stay — not withdrawable</li>
          <li>Withdrawals refunded to <strong>original payment method only</strong> (UPI → UPI, Card → Card)</li>
          <li>Wallet credits usable for paying orders in full</li>
        </ul>
      </div>

      {/* ── How it works ── */}
      <div style={{ padding: "0 1rem", marginTop: "0.75rem" }}>
        <h3 style={{ fontSize: "0.9rem", fontWeight: 700, marginBottom: "0.5rem" }}>HOW IT WORKS</h3>
        <div style={{ fontSize: "0.85rem", color: "var(--ink-2)", lineHeight: 1.8 }}>
          🍽️ Order → Earn rewards<br />
          ⏰ Pickup on time → Earn more<br />
          💵 Use Canteen Cash at checkout
        </div>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
          <div style={{ flex: 1, background: "var(--orange-light)", border: "1px solid #fed7aa", borderRadius: 12, padding: "0.65rem", textAlign: "center" }}>
            <div style={{ fontWeight: 700, color: "var(--orange-dark)", fontSize: "0.8rem" }}>Expiry</div>
            <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", marginTop: "0.25rem" }}>7 days from earning</div>
          </div>
          <div style={{ flex: 1, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "0.65rem", textAlign: "center" }}>
            <div style={{ fontWeight: 700, color: "var(--green)", fontSize: "0.8rem" }}>Earn Rate</div>
            <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", marginTop: "0.25rem" }}>₹1 per ₹50 ordered</div>
          </div>
        </div>
      </div>

      {/* ── Transaction history ── */}
      <div style={{ padding: "0 1rem 6rem", marginTop: "0.75rem" }}>
        <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "0 0 0.6rem" }}>RECENT ACTIVITY</h3>
        {fetching && <p style={{ color: "var(--ink-3)", fontSize: "0.85rem" }}>Loading…</p>}
        {!fetching && transactions.length === 0 && (
          <p style={{ color: "var(--ink-3)", fontSize: "0.85rem" }}>No transactions yet. Add money or place an order to start earning!</p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {transactions.map(t => {
            const isCredit = t.amount > 0;
            const icon = t.type === "topup" ? "💰" : t.type === "withdrawal" ? "↩️" : t.type === "earned" ? "⭐" : t.type === "redeemed" ? "🛒" : "⏰";
            return (
              <div key={t.id} className="card" style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem" }}>
                <div style={{ fontSize: "1.4rem", flexShrink: 0 }}>{icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>{t.description || t.type}</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--ink-3)", marginTop: "0.1rem", display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                    <span>{new Date(t.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    {t.payment_method && t.payment_method !== "unknown" && (
                      <span style={{ background: "#f3f4f6", borderRadius: 4, padding: "0.1rem 0.35rem", fontWeight: 600, textTransform: "uppercase", fontSize: "0.65rem" }}>{t.payment_method}</span>
                    )}
                    {t.status === "processing" && <span style={{ color: "#d97706", fontWeight: 600 }}>Processing</span>}
                  </div>
                </div>
                <div style={{ fontWeight: 800, fontSize: "0.95rem", color: isCredit ? "var(--green)" : "var(--red)", flexShrink: 0 }}>
                  {isCredit ? "+" : ""}₹{Math.abs(t.amount)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Top Up bottom sheet ── */}
      {showTopUp && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setShowTopUp(false); }}>
          <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: "1.25rem 1.25rem 2.5rem", width: "100%", maxWidth: 480 }}>
            <div style={{ width: 40, height: 4, background: "#e5e7eb", borderRadius: 99, margin: "0 auto 1rem" }} />
            <h3 style={{ fontWeight: 800, marginBottom: "0.25rem" }}>Add Money to Wallet</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--ink-3)", marginBottom: "1rem" }}>Minimum ₹{MIN_TOPUP} · Secured by Razorpay (PCI DSS)</p>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.85rem" }}>
              {TOPUP_PRESETS.map(p => (
                <button key={p} onClick={() => setTopUpAmount(String(p))} style={{ flex: 1, borderRadius: 10, padding: "0.5rem 0.25rem", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer", background: topUpAmount === String(p) ? "var(--orange)" : "var(--orange-light)", color: topUpAmount === String(p) ? "#fff" : "var(--orange-dark)", border: `1.5px solid ${topUpAmount === String(p) ? "var(--orange)" : "#fed7aa"}` }}>
                  ₹{p}
                </button>
              ))}
            </div>
            <input type="number" placeholder={`Enter amount (min ₹${MIN_TOPUP})`} value={topUpAmount} onChange={e => { setTopUpAmount(e.target.value); setTopUpError(""); }} min={MIN_TOPUP}
              style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 12, padding: "0.7rem 0.9rem", fontSize: "1rem", outline: "none", marginBottom: "0.5rem", boxSizing: "border-box" }}
              onFocus={e => (e.target.style.borderColor = "var(--orange)")} onBlur={e => (e.target.style.borderColor = "var(--border)")} />
            {topUpError && <p style={{ color: "var(--red)", fontSize: "0.78rem", marginBottom: "0.5rem" }}>⚠️ {topUpError}</p>}
            <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", marginBottom: "0.85rem" }}>🔒 256-bit encrypted · PCI DSS compliant · Refund to original gateway only</div>
            <button onClick={handleTopUp} disabled={topUpLoading || !topUpAmount || Number(topUpAmount) < MIN_TOPUP}
              style={{ width: "100%", background: "var(--orange)", color: "#fff", border: "none", borderRadius: 14, padding: "0.85rem", fontSize: "0.95rem", fontWeight: 700, cursor: topUpLoading ? "not-allowed" : "pointer", opacity: topUpLoading ? 0.7 : 1 }}>
              {topUpLoading ? "Processing…" : `Pay ₹${topUpAmount || "—"} via Razorpay`}
            </button>
          </div>
        </div>
      )}

      {/* ── Withdraw bottom sheet ── */}
      {showWithdraw && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setShowWithdraw(false); }}>
          <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: "1.25rem 1.25rem 2.5rem", width: "100%", maxWidth: 480 }}>
            <div style={{ width: 40, height: 4, background: "#e5e7eb", borderRadius: 99, margin: "0 auto 1rem" }} />
            <h3 style={{ fontWeight: 800, marginBottom: "0.25rem" }}>Withdraw Money</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--ink-3)", marginBottom: "0.5rem" }}>Available to withdraw: <strong>₹{withdrawable}</strong></p>
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "0.55rem 0.75rem", fontSize: "0.76rem", color: "#dc2626", marginBottom: "0.85rem" }}>
              ⚠️ ₹{MIN_RESERVE} minimum must remain. Refund sent to <strong>original payment gateway only</strong> (5–7 working days).
            </div>
            <input type="number" placeholder={`Enter amount (max ₹${withdrawable})`} value={withdrawAmount} onChange={e => { setWithdrawAmount(e.target.value); setWithdrawError(""); }} max={withdrawable} min={1}
              style={{ width: "100%", border: "1.5px solid var(--border)", borderRadius: 12, padding: "0.7rem 0.9rem", fontSize: "1rem", outline: "none", marginBottom: "0.5rem", boxSizing: "border-box" }}
              onFocus={e => (e.target.style.borderColor = "var(--blue)")} onBlur={e => (e.target.style.borderColor = "var(--border)")} />
            {withdrawError && <p style={{ color: "var(--red)", fontSize: "0.78rem", marginBottom: "0.5rem" }}>⚠️ {withdrawError}</p>}
            <button onClick={handleWithdraw} disabled={withdrawLoading || !withdrawAmount || Number(withdrawAmount) <= 0 || Number(withdrawAmount) > withdrawable}
              style={{ width: "100%", background: "var(--blue)", color: "#fff", border: "none", borderRadius: 14, padding: "0.85rem", fontSize: "0.95rem", fontWeight: 700, cursor: withdrawLoading ? "not-allowed" : "pointer", opacity: withdrawLoading ? 0.7 : 1 }}>
              {withdrawLoading ? "Processing…" : `Withdraw ₹${withdrawAmount || "—"}`}
            </button>
          </div>
        </div>
      )}

      {/* ── Bottom nav ── */}
      <nav className="bottom-nav">
        {[
          { tab: "home",    icon: "🏠", label: "Home",      href: "/dashboard" },
          { tab: "orders",  icon: "📦", label: "My Orders", href: "/dashboard/orders" },
          { tab: "rewards", icon: "💰", label: "Rewards",   href: "/dashboard/rewards" },
          { tab: "profile", icon: "👤", label: "Profile",   href: "/dashboard/profile" },
        ].map(item => (
          <Link key={item.tab} href={item.href} className={`bottom-nav-item ${item.tab === "rewards" ? "active" : ""}`}>
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
