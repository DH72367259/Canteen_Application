"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getNativeAppId } from "@/lib/nativeAppId";

const WORKER_APP_ID = "com.noqx.worker";

/**
 * Enforces worker-only access when the app runs inside the worker native shell.
 *
 * On web: invisible no-op.
 * On a non-worker native app (e.g. com.noqx.student): also a no-op.
 * On com.noqx.worker native: if the logged-in user is NOT a worker
 *   (role === 'worker'), they're signed out and shown a "worker app only"
 *   screen so students/admins can't accidentally see live-order queues.
 */
export function NativeWorkerGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [isWorkerApp, setIsWorkerApp] = useState(false);
  const [platformChecked, setPlatformChecked] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    (async () => {
      const appId = await getNativeAppId();
      setIsWorkerApp(appId === WORKER_APP_ID);
      setPlatformChecked(true);
    })();
  }, []);

  useEffect(() => {
    if (!platformChecked || !isWorkerApp || loading) return;

    if (!user) {
      setBlocked(false);
      return;
    }

    if (user.role !== "worker") {
      setSigningOut(true);
      import("@/lib/supabase-client")
        .then(({ getSupabaseClient }) => getSupabaseClient()?.auth.signOut())
        .catch(() => {})
        .finally(() => {
          setSigningOut(false);
          setBlocked(true);
        });
    } else {
      setBlocked(false);
    }
  }, [user, loading, platformChecked, isWorkerApp]);

  if (blocked) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", minHeight: "100vh",
        background: "linear-gradient(135deg, #f4f7ff 0%, #ffffff 100%)",
        padding: "32px 24px", textAlign: "center", fontFamily: "system-ui, sans-serif",
      }}>
        <div style={{ fontSize: "72px", marginBottom: "8px", lineHeight: 1 }}>👨‍🍳</div>

        <div style={{ fontSize: "28px", fontWeight: "800", color: "#2563eb", marginBottom: "4px" }}>
          NoQx Worker
        </div>
        <div style={{ fontSize: "13px", color: "#999", marginBottom: "32px", letterSpacing: "0.5px" }}>
          CANTEEN STAFF APP
        </div>

        <div style={{
          background: "#eef2ff", border: "1px solid #c7d2fe",
          borderRadius: "16px", padding: "20px 24px", marginBottom: "32px",
          maxWidth: "320px",
        }}>
          <div style={{ fontSize: "16px", fontWeight: "600", color: "#333", marginBottom: "8px" }}>
            Worker accounts only
          </div>
          <div style={{ fontSize: "14px", color: "#666", lineHeight: "1.6" }}>
            This app is for canteen workers to manage live orders, prep,
            and OTP verification. Students &amp; admins must use the
            desktop site or student app.
          </div>
        </div>

        <div style={{ fontSize: "13px", color: "#999", marginBottom: "32px" }}>
          Other portals:{" "}
          <span style={{ color: "#2563eb", fontWeight: "600" }}>noqx.up.railway.app</span>
        </div>

        <button
          onClick={() => {
            setBlocked(false);
            window.location.href = "/worker/login";
          }}
          style={{
            background: "#2563eb", color: "#fff", border: "none",
            borderRadius: "14px", padding: "16px 40px",
            fontSize: "16px", fontWeight: "700", cursor: "pointer",
            boxShadow: "0 4px 20px rgba(37,99,235,0.35)",
            letterSpacing: "0.3px",
          }}
        >
          Back to Worker Login
        </button>
      </div>
    );
  }

  if (signingOut) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", background: "#fff",
      }}>
        <div style={{ fontSize: "14px", color: "#999" }}>Signing out…</div>
      </div>
    );
  }

  return <>{children}</>;
}
