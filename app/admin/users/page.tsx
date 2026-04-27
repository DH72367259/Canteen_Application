"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

type AdminUser = {
  uid: string;
  email?: string;
  name?: string;
  role?: string;
  disabled: boolean;
  providerIds: string[];
};

export default function AdminUsersPage() {
  const router = useRouter();
  const { user, session, loading } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);
  const [resetStatus, setResetStatus] = useState<Record<string, "loading" | "sent" | "error">>({});

  const fetchUsers = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch("/api/admin/users", {
        cache: "no-store",
        headers: { Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not fetch users.");
      setUsers(data.users ?? []);
      setIsSuperAdmin(data.isSuperAdmin === true);
      setFetching(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load users.");
      setFetching(false);
    }
  }, [session]);

  useEffect(() => {
    if (!loading && !user) { router.push("/login"); return; }
    if (!loading && user && user.role !== "super_admin") { router.push("/"); return; }
    if (!loading && user && session) fetchUsers();
  }, [user, loading, session, router, fetchUsers]);

  if (loading || fetching) return <div className="page-loading"><div className="spinner" /></div>;

  async function handleResetPassword(uid: string) {
    if (!session) return;
    setResetStatus((prev) => ({ ...prev, [uid]: "loading" }));
    try {
      const res = await fetch("/api/admin/users/reset-password", {
        method: "POST",
        headers: { Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: uid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send reset email.");
      setResetStatus((prev) => ({ ...prev, [uid]: "sent" }));
    } catch {
      setResetStatus((prev) => ({ ...prev, [uid]: "error" }));
    }
  }

  return (
    <main className="canteen-page">
      <section className="hero">
        <p className="hero-kicker">Admin</p>
        <h1>Users</h1>
        <p>All registered users from Supabase Auth.</p>
        <p className="route-links">
          <Link href="/">Home</Link> | <Link href="/admin">Admin Dashboard</Link>
        </p>
      </section>

      <section className="panel orders">
        <h2>Registered Users</h2>
        {error ? <p className="error-msg">{error}</p> : null}
        <div className="orders-list">
          {users.map((u) => (
            <div key={u.uid} className="order-card">
              <h3>{u.name ?? u.email ?? "No email"}</h3>
              <p style={{ fontSize: "0.82rem", color: "#777" }}>{u.uid}</p>
              <p style={{ fontSize: "0.82rem" }}>Role: <strong>{u.role ?? "user"}</strong></p>
              <p style={{ fontSize: "0.82rem" }}>Email: {u.email ?? "—"}</p>
              {isSuperAdmin && (
                <div style={{ marginTop: "0.5rem" }}>
                  <button
                    onClick={() => handleResetPassword(u.uid)}
                    disabled={resetStatus[u.uid] === "loading" || resetStatus[u.uid] === "sent"}
                    style={{
                      fontSize: "0.78rem",
                      padding: "4px 10px",
                      cursor: resetStatus[u.uid] === "sent" ? "default" : "pointer",
                      opacity: resetStatus[u.uid] === "loading" ? 0.6 : 1,
                    }}
                  >
                    {resetStatus[u.uid] === "loading"
                      ? "Sending…"
                      : resetStatus[u.uid] === "sent"
                      ? "✓ Reset email sent"
                      : "Reset Password"}
                  </button>
                  {resetStatus[u.uid] === "error" && (
                    <span style={{ fontSize: "0.78rem", color: "red", marginLeft: "8px" }}>
                      Failed — try again
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
          {users.length === 0 && <p>No users found.</p>}
        </div>
      </section>
    </main>
  );
}
