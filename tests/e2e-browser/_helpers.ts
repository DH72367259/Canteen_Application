/**
 * Shared helpers for E2E browser specs.
 * Loads .env.local, exposes a Supabase service-role client, and provides
 * UI-driven + API-driven login helpers for each role.
 */
import { Page, expect } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// ── Env loading ───────────────────────────────────────────────────────────────
try {
  const raw = readFileSync(".env.local", "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* CI: environment variables already set */ }

export const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const SUPABASE_SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
export const APP_URL       = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

// ── Whitelist test accounts (created by scripts/seed-staging.mjs) ─────────────
export const ACCOUNTS = {
  superAdmin:   { email: "admin@noqx.test",    password: "Admin@12345",   role: "super_admin"   },
  coAdmin:      { email: "coadmin@noqx.test",  password: "Coadmin@12345", role: "co_admin"      },
  canteenAdmin: { email: "canteen1@noqx.test", password: "Canteen@12345", role: "canteen_admin" },
  canteen2Admin:{ email: "canteen2@noqx.test", password: "Canteen@12345", role: "canteen_admin" },
  worker:       { email: "worker1@noqx.test",  password: "Worker@12345",  role: "worker"        },
  student1:     { email: "student1@noqx.test", password: "Student@12345", role: "user"          },
  student2:     { email: "student2@noqx.test", password: "Student@12345", role: "user"          },
} as const;

// ── Supabase admin client (service role) ──────────────────────────────────────
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SVC, { auth: { persistSession: false } });
}

// ── Token helpers ─────────────────────────────────────────────────────────────
// Cache tokens for 50 s to avoid Supabase auth 429 rate-limiting during test runs.
const _tokenCache = new Map<string, { token: string; expiry: number }>();

export async function getAccessToken(email: string, password: string): Promise<string> {
  const cached = _tokenCache.get(email);
  if (cached && cached.expiry > Date.now()) return cached.token;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, string>;
    throw new Error(`Token fetch failed for ${email}: ${err.error_description ?? err.message ?? res.status}`);
  }
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error(`No token returned for ${email}`);
  _tokenCache.set(email, { token: data.access_token, expiry: Date.now() + 50_000 });
  return data.access_token;
}

// ── Authenticated fetch ───────────────────────────────────────────────────────
let _ipSeed = 0;
function nextIp(): string {
  _ipSeed = (_ipSeed + 1) % 60000;
  return `10.${(_ipSeed >> 8) & 0xff}.${_ipSeed & 0xff}.1`;
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
  creds?: { email: string; password: string },
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  headers.set("x-forwarded-for", nextIp()); // unique IP → avoids rate-limit collisions
  if (creds) {
    const tok = await getAccessToken(creds.email, creds.password);
    headers.set("Authorization", `Bearer ${tok}`);
  }
  return fetch(`${APP_URL}${path}`, { ...init, headers });
}

// ── UI login helpers ──────────────────────────────────────────────────────────
/** Logs in via the "Canteen Login" tab (email + password). Used by all staff. */
export async function loginStaff(page: Page, email: string, password: string, expectUrlPattern: RegExp) {
  await page.goto(`${APP_URL}/login`, { waitUntil: "domcontentloaded" });
  const canteenBtn = page.locator('button:has-text("Canteen Login")').first();
  await canteenBtn.waitFor({ state: "visible", timeout: 20_000 });
  await canteenBtn.click();
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('button:has-text("Sign In")').first().click();
  await page.waitForURL(expectUrlPattern, { timeout: 25_000 });
}

/** Logs in via the "Canteen Login" tab and expects /admin/dashboard. */
export async function loginSuperAdmin(page: Page) {
  const a = ACCOUNTS.superAdmin;
  await loginStaff(page, a.email, a.password, /\/admin\/dashboard/);
}

/** Logs in via the "Canteen Login" tab and expects /vendor/dashboard. */
export async function loginCanteenAdmin(page: Page) {
  const a = ACCOUNTS.canteenAdmin;
  await loginStaff(page, a.email, a.password, /\/vendor\/dashboard/);
}

/** Logs in via the worker login page (/worker/login). */
export async function loginWorker(page: Page) {
  const a = ACCOUNTS.worker;
  await page.goto(`${APP_URL}/worker/login`, { waitUntil: "domcontentloaded" });
  const emailOrUsername = page.locator('input[type="text"], input[type="email"]').first();
  await emailOrUsername.waitFor({ state: "visible", timeout: 10_000 });
  await emailOrUsername.fill(a.email);
  await page.locator('input[type="password"]').first().fill(a.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/worker\/(orders|dashboard)/, { timeout: 25_000 });
}

// ── Canteen / profile lookups ─────────────────────────────────────────────────
/** Returns the canteen_id linked to the canteen1 admin's profile. */
export async function getCanteen1Id(): Promise<string> {
  const db = adminClient();
  const { data } = await db
    .from("profiles")
    .select("canteen_id")
    .eq("email", ACCOUNTS.canteenAdmin.email)
    .maybeSingle();
  const id = (data as { canteen_id?: string } | null)?.canteen_id;
  if (!id) throw new Error("canteen1Id not found — run scripts/seed-staging.mjs first");
  return id;
}

/**
 * Returns student1's profile.id — used as the user_id when test helpers
 * seed orders directly. orders.user_id is NOT NULL on staging, so every
 * order-creation helper MUST set a real profile id or the insert fails
 * silently and the test skips. Cached to keep test fixtures fast.
 */
let _student1IdCache: string | null = null;
export async function getStudent1Id(): Promise<string> {
  if (_student1IdCache) return _student1IdCache;
  const db = adminClient();
  const { data } = await db
    .from("profiles")
    .select("id")
    .eq("email", ACCOUNTS.student1.email)
    .maybeSingle();
  const id = (data as { id?: string } | null)?.id;
  if (!id) throw new Error("student1 profile not found — run scripts/seed-staging.mjs first");
  _student1IdCache = id;
  return id;
}

/** Returns the canteen_id linked to the worker's profile. */
export async function getWorkerCanteenId(): Promise<string> {
  const db = adminClient();
  const { data } = await db
    .from("profiles")
    .select("canteen_id")
    .eq("email", ACCOUNTS.worker.email)
    .maybeSingle();
  const id = (data as { canteen_id?: string } | null)?.canteen_id;
  if (!id) throw new Error("worker canteen_id not found — run scripts/seed-staging.mjs first");
  return id;
}

// ── One-shot user provisioning (for tests that need a unique user) ─────────────
export async function provisionStudent(suffix: string) {
  const db = adminClient();
  const email = `e2e-student-${suffix}-${Date.now()}@noqx.test`;
  const { data, error } = await db.auth.admin.createUser({
    email, password: "Student@12345", email_confirm: true,
    user_metadata: { name: `E2E Student ${suffix}`, has_password: true },
  });
  if (error) throw error;
  const id = data.user.id;
  await db.from("profiles").upsert({
    id, email, name: `E2E Student ${suffix}`, role: "user",
    username: `e2e_student_${suffix}`.slice(0, 20),
  });
  return { id, email, password: "Student@12345" };
}

export async function deleteUser(id: string) {
  if (!id) return;
  await adminClient().auth.admin.deleteUser(id).catch(() => {});
}

// ── Convenience assertions ────────────────────────────────────────────────────
export async function expectText(page: Page, pattern: RegExp | string, timeout = 15_000) {
  const locator = typeof pattern === "string"
    ? page.getByText(pattern, { exact: false }).first()
    : page.getByText(pattern).first();
  await expect(locator).toBeVisible({ timeout });
}
