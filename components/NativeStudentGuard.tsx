"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";

/**
 * Enforces student-only access when the app runs inside the native iOS/Android shell.
 *
 * On web: invisible no-op — any role can access the web app normally.
 * On native (Capacitor): if the logged-in user is NOT a student (role === 'user'),
 * they are immediately signed out and shown a "student app only" screen.
 * This prevents staff accounts (worker, canteen_admin, co_admin, super_admin)
 * from accidentally using the student app on mobile.
 */
export function NativeStudentGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [isNative, setIsNative] = useState(false);
  const [platformChecked, setPlatformChecked] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Detect native platform once on mount (lazy import keeps SSR clean)
  useEffect(() => {
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        setIsNative(Capacitor.isNativePlatform());
      } catch {
        setIsNative(false);
      } finally {
        setPlatformChecked(true);
      }
    })();
  }, []);

  // Re-check role whenever auth or platform state changes
  useEffect(() => {
    if (!platformChecked || !isNative || loading) return;

    if (!user) {
      // Not logged in — let the normal login flow run
      setBlocked(false);
      return;
    }

    const isStudent = user.role === "user" || user.role === null;
    if (!isStudent) {
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
  }, [user, loading, platformChecked, isNative]);

  if (blocked) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", minHeight: "100vh",
        background: "linear-gradient(135deg, #fff7f4 0%, #ffffff 100%)",
        padding: "32px 24px", textAlign: "center", fontFamily: "system-ui, sans-serif",
      }}>
        {/* Icon */}
        <div style={{ fontSize: "72px", marginBottom: "8px", lineHeight: 1 }}>🎓</div>

        {/* Brand */}
        <div style={{ fontSize: "28px", fontWeight: "800", color: "#ff6b35", marginBottom: "4px" }}>
          NoQx Student
        </div>
        <div style={{ fontSize: "13px", color: "#999", marginBottom: "32px", letterSpacing: "0.5px" }}>
          COLLEGE CANTEEN APP
        </div>

        {/* Message */}
        <div style={{
          background: "#fff3ee", border: "1px solid #ffd4c0",
          borderRadius: "16px", padding: "20px 24px", marginBottom: "32px",
          maxWidth: "320px",
        }}>
          <div style={{ fontSize: "16px", fontWeight: "600", color: "#333", marginBottom: "8px" }}>
            Student accounts only
          </div>
          <div style={{ fontSize: "14px", color: "#666", lineHeight: "1.6" }}>
            This app is for students to order food from their college canteen.
            Staff &amp; admin accounts must use the desktop site.
          </div>
        </div>

        {/* URL hint */}
        <div style={{ fontSize: "13px", color: "#999", marginBottom: "32px" }}>
          Staff portal:{" "}
          <span style={{ color: "#ff6b35", fontWeight: "600" }}>noqx.up.railway.app</span>
        </div>

        {/* Back to login button */}
        <button
          onClick={() => {
            setBlocked(false);
            window.location.href = "/login";
          }}
          style={{
            background: "#ff6b35", color: "#fff", border: "none",
            borderRadius: "14px", padding: "16px 40px",
            fontSize: "16px", fontWeight: "700", cursor: "pointer",
            boxShadow: "0 4px 20px rgba(255,107,53,0.35)",
            letterSpacing: "0.3px",
          }}
        >
          Back to Student Login
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
