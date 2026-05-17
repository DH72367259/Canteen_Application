/**
 * Loaded by Jest before any test file runs (setupFiles in jest.config.ts).
 * Reads .env.local so integration tests can connect to real Supabase.
 */
import { readFileSync } from "fs";
import { resolve } from "path";

try {
  const raw = readFileSync(resolve(__dirname, ".env.local"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // CI will inject vars via environment directly — no file needed
}
