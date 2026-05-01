/**
 * Shared helpers for headless browser E2E specs. Loads .env.local, exposes
 * a Supabase service-role client, and provides UI-driven login helpers for
 * each role (canteen_admin, super_admin, co_admin, worker, student).
 *
 * The student helper provisions a one-shot account via the admin SDK so the
 * spec is hermetic — it cleans up its own user in afterAll.
 */
import { Page, expect } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

export const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
export const SUPABASE_SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
export const APP_URL       = process.env.APP_BASE_URL ?? "http://localhost:3000";

/** Whitelist accounts kept by scripts/cleanup_db.mjs — safe to reuse. */
export const WHITELIST = {
  superAdmin:   { email: "admin@noqx.test",    password: "Admin@12345"   },
  coAdmin:      { email: "coadmin@noqx.test",  password: "Coadmin@12345" },
  canteenAdmin: { email: "canteen1@noqx.test", password: "Canteen@12345" },
  worker:       { email: "worker1@noqx.test",  password: "Worker@12345"  },
} as const;

export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SVC, { auth: { persistSession: false } });
}

/** Email + password login through the "🏢 Canteen Login" tab on /login. */
export async function loginViaPasswordTab(page: Page, email: string, password: string, expectUrl: RegExp) {
  await page.goto(`${APP_URL}/login`, { waitUntil: "domcontentloaded" });
  // Tab labels: "🎓 Student" | "🏢 Canteen Login". The canteen tab toggles
  // the form to email + password fields.
  const canteenTab = page.locator('button:has-text("Canteen Login")').first();
  await canteenTab.waitFor({ state: "visible", timeout: 15_000 });
  await canteenTab.click();
  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.waitFor({ state: "visible", timeout: 10_000 });
  await emailInput.fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.locator('button:has-text("Sign In")').first().click();
  await page.waitForURL(expectUrl, { timeout: 25_000 });
}

export async function loginWorkerUI(page: Page) {
  await page.goto(`${APP_URL}/worker/login`);
  await page.locator('input[type="text"]').first().fill(WHITELIST.worker.email);
  await page.locator('input[type="password"]').first().fill(WHITELIST.worker.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/worker\/dashboard/, { timeout: 20_000 });
}

/** Provisions a student via admin SDK and returns its credentials + id. */
export async function provisionStudent(canteenId: string, suffix: string) {
  const admin = adminClient();
  const email = `e2e-${suffix}-${Date.now()}@noqx.test`;
  const password = "Student@12345";
  const create = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { name: `E2E ${suffix}` },
  });
  if (create.error) throw create.error;
  const id = create.data.user.id;
  await admin.from("profiles").upsert({
    id, name: `E2E ${suffix}`, role: "student", canteen_id: canteenId,
  });
  return { id, email, password };
}

export async function deleteUser(id: string) {
  if (!id) return;
  const admin = adminClient();
  await admin.auth.admin.deleteUser(id).catch(() => {});
}

/** Quick sanity assertion on an authenticated page. */
export async function expectVisibleText(page: Page, pattern: RegExp, timeout = 15_000) {
  await expect(page.getByText(pattern).first()).toBeVisible({ timeout });
}
