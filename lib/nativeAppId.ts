/**
 * Resolves the native app's bundle/package ID at runtime.
 *
 * Returns:
 *   "com.noqx.student" — running inside the student app
 *   "com.noqx.worker"  — running inside the worker app
 *   null               — running on the web (no native shell)
 *
 * Used by NativeStudentGuard and NativeWorkerGuard so each guard only
 * enforces its role inside its own app. Without this gate, a worker
 * logging into the worker app would be signed out by NativeStudentGuard
 * (because role !== 'user') and vice versa.
 */
export async function getNativeAppId(): Promise<string | null> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return null;
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    return info.id ?? null;
  } catch {
    return null;
  }
}
