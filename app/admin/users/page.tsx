"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";
import Link from "next/link";
import { getClientAuth, isFirebaseClientConfigured } from "@/lib/firebaseClient";

type AdminUser = {
  uid: string;
  email?: string;
  disabled: boolean;
  providerIds: string[];
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [role, setRole] = useState<"customer" | "admin" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const clientConfigReady = isFirebaseClientConfigured();

  const getAuthHeader = useCallback(async () => {
    const currentUser = getClientAuth().currentUser;
    if (!currentUser) {
      throw new Error("User not authenticated.");
    }

    const token = await currentUser.getIdToken();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/users", {
        cache: "no-store",
        headers: await getAuthHeader(),
      });
      const payload = (await response.json()) as {
        users?: AdminUser[];
        role?: "customer" | "admin";
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not fetch users.");
      }

      setUsers(payload.users ?? []);
      setRole(payload.role ?? "customer");
      setLoading(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load users.";
      setError(message);
      setLoading(false);
    }
  }, [getAuthHeader]);

  useEffect(() => {
    if (!clientConfigReady) {
      return;
    }

    const unsubscribe = onAuthStateChanged(getClientAuth(), async (authUser) => {
      if (!authUser) {
        setLoading(false);
        return;
      }

      await fetchUsers();
    });

    return () => {
      unsubscribe();
    };
  }, [clientConfigReady, fetchUsers]);

  async function handleAdminLogin() {
    setSigningIn(true);
    setError(null);

    try {
      await signInWithEmailAndPassword(getClientAuth(), adminEmail, adminPassword);
      await fetchUsers();
    } catch {
      setError("Admin login failed. Check email/password or admin allowlist.");
    } finally {
      setSigningIn(false);
    }
  }

  if (!clientConfigReady) {
    return (
      <main className="canteen-page">
        <section className="hero">
          <h1>Firebase configuration missing</h1>
        </section>
      </main>
    );
  }

  return (
    <main className="canteen-page">
      <section className="hero">
        <p className="hero-kicker">Admin Workflow</p>
        <h1>Users</h1>
        <p>Admin-only user directory from Firebase Authentication.</p>
        <p className="route-links">
          <Link href="/">Home</Link> | <Link href="/admin">Admin Dashboard</Link>
        </p>
      </section>

      {role !== "admin" ? (
        <section className="panel checkout">
          <h2>Admin Login Required</h2>
          <label htmlFor="admin-email">Email</label>
          <input
            id="admin-email"
            type="email"
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.target.value)}
            placeholder="admin@domain.com"
          />
          <label htmlFor="admin-password">Password</label>
          <input
            id="admin-password"
            type="password"
            value={adminPassword}
            onChange={(event) => setAdminPassword(event.target.value)}
            placeholder="Enter password"
          />
          <button type="button" className="place-btn" onClick={handleAdminLogin} disabled={signingIn}>
            {signingIn ? "Signing in..." : "Login as Admin"}
          </button>
          {error ? <p className="error-msg">{error}</p> : null}
        </section>
      ) : null}

      {role === "admin" ? (
        <section className="panel orders">
          <h2>Registered Users</h2>
          {loading ? <p>Loading users...</p> : null}
          {users.length === 0 && !loading ? <p>No users found.</p> : null}
          <div className="orders-list">
            {users.map((user) => (
              <div key={user.uid} className="order-card">
                <h3>{user.email ?? "No email"}</h3>
                <p>{user.uid}</p>
                <p>Disabled: {user.disabled ? "Yes" : "No"}</p>
                <p>Providers: {user.providerIds.join(", ") || "none"}</p>
              </div>
            ))}
          </div>
          {error ? <p className="error-msg">{error}</p> : null}
        </section>
      ) : null}
    </main>
  );
}
