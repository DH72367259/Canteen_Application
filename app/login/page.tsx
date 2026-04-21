"use client";

import { useState } from "react";
import { signInAnonymously, signInWithEmailAndPassword } from "firebase/auth";
import { useRouter } from "next/navigation";
import { getClientAuth, isFirebaseClientConfigured } from "@/lib/firebaseClient";
import { getDashboardUrl } from "@/lib/rolesClient";
import type { UserRole } from "@/types/canteen";

export default function LoginPage() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<UserRole>("customer");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isFirebaseClientConfigured()) {
    return (
      <main className="canteen-page">
        <section className="hero">
          <h1>Firebase configuration missing</h1>
          <p>Set environment values and restart the app.</p>
        </section>
      </main>
    );
  }

  async function continueAsCustomer() {
    setBusy(true);
    setError(null);
    try {
      await signInAnonymously(getClientAuth());
      router.push(getDashboardUrl("customer"));
    } catch {
      setError("Customer sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function adminLogin() {
    setBusy(true);
    setError(null);
    try {
      const result = await signInWithEmailAndPassword(getClientAuth(), adminEmail, adminPassword);
      
      // Get the role from custom claims or use selected role
      const token = await result.user.getIdTokenResult();
      const userRole = (token.claims.role as UserRole) || selectedRole;
      
      // Redirect to appropriate dashboard
      const dashboardUrl = getDashboardUrl(userRole);
      router.push(dashboardUrl);
    } catch {
      setError("Admin login failed. Check email/password.");
    } finally {
      setBusy(false);
    }
  }

  const roleOptions: { value: UserRole; label: string; icon: string }[] = [
    { value: "customer", label: "Customer / End User", icon: "🛒" },
    { value: "canteen-admin", label: "Canteen Admin", icon: "🏪" },
    { value: "vendor", label: "Vendor", icon: "👨‍🍳" },
    { value: "worker", label: "Worker", icon: "👷" },
    { value: "super-admin", label: "Super Admin", icon: "🔐" },
  ];

  return (
    <main className="canteen-page">
      <section className="hero">
        <p className="hero-kicker">Access Portal</p>
        <h1>Login</h1>
        <p>Select your role or continue as a customer.</p>
      </section>

      <section className="grid-wrap">
        <article className="panel">
          <h2>Customer</h2>
          <p>Continue to place and track your own orders.</p>
          <button type="button" className="place-btn" disabled={busy} onClick={continueAsCustomer}>
            Continue as Customer
          </button>
        </article>

        <article className="panel checkout">
          <h2>Admin Access</h2>
          
          <label htmlFor="role-select">Select Role</label>
          <select
            id="role-select"
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value as UserRole)}
            className="form-select"
          >
            {roleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.icon} {option.label}
              </option>
            ))}
          </select>

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
          <button type="button" className="place-btn" disabled={busy} onClick={adminLogin}>
            Login as {roleOptions.find((r) => r.value === selectedRole)?.label}
          </button>
          {error ? <p className="error-msg">{error}</p> : null}
        </article>
      </section>
    </main>
  );
}
