"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getNativeAppId } from "@/lib/nativeAppId";

const STUDENT_APP_ID = "com.noqx.student";

/**
 * Enforces student-only access when the app runs inside the student native shell.
 *
 * On web: invisible no-op.
 * On a non-student native app (e.g. com.noqx.worker): also a no-op — the
 *   worker app uses NativeWorkerGuard instead.
 * On com.noqx.student native: if the logged-in user is NOT a student
 *   (role === 'user'), they're signed out and shown a "student app only" screen.
 */
export function NativeStudentGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [isStudentApp, setIsStudentApp] = useState(false);
  const [platformChecked, setPlatformChecked] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Detect native platform + appId once on mount
  useEffect(() => {
    (async () => {
      const appId = await getNativeAppId();
      setIsStudentApp(appId === STUDENT_APP_ID);
      setPlatformChecked(true);
    })();
  }, []);

  // Re-check role whenever auth or platform state changes
  useEffect(() => {
    if (!platformChecked || !isStudentApp || loading) return;

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
  }, [user, loading, platformChecked, isStudentApp]);

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
        <div style={{ fontSize: "28px", fontWeight: "800", color: "#7c3aed", marginBottom: "4px" }}>
          NoQx Student
        </div>
        <div style={{ fontSize: "13px", color: "#999", marginBottom: "32px", letterSpacing: "0.5px" }}>
          COLLEGE CANTEEN APP
        </div>

        {/* Message */}
        <div style={{
          background: "#f5f3ff", border: "1px solid #ddd6fe",
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
          <span style={{ color: "#7c3aed", fontWeight: "600" }}>noqx.co.in</span>
        </div>

        {/* Back to login button */}
        <button
          onClick={() => {
            setBlocked(false);
            window.location.href = "/login";
          }}
          style={{
            background: "#7c3aed", color: "#fff", border: "none",
            borderRadius: "14px", padding: "16px 40px",
            fontSize: "16px", fontWeight: "700", cursor: "pointer",
            boxShadow: "0 4px 20px rgba(124,58,237,0.35)",
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
