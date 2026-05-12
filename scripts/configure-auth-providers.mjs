/**
 * configure-auth-providers.mjs
 *
 * One-shot script to configure Supabase Auth SMTP (Amazon SES) and
 * verify Resend connectivity. Run once after setting up credentials.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_xxx \
 *   SES_SMTP_HOST=email-smtp.ap-south-1.amazonaws.com \
 *   SES_SMTP_PORT=587 \
 *   SES_SMTP_USER=AKIAIOSFODNN7EXAMPLE \
 *   SES_SMTP_PASS=xxxxxxxxxx \
 *   SES_FROM_EMAIL=noreply@yourdomain.com \
 *   RESEND_API_KEY=re_xxx \
 *   node scripts/configure-auth-providers.mjs
 *
 * Or: add the vars to .env.local and run:
 *   node -e "require('dotenv').config({path:'.env.local'})" scripts/configure-auth-providers.mjs
 */

const PROJECT_REF = "dpycfyeiyhzvwbythcrp";
const MGMT_BASE = "https://api.supabase.com/v1";

// ─── helpers ────────────────────────────────────────────────────────────────

function require(key) {
  const v = process.env[key];
  if (!v) {
    console.error(`❌  Missing env var: ${key}`);
    process.exit(1);
  }
  return v;
}

function opt(key, fallback = "") {
  return process.env[key] ?? fallback;
}

async function mgmt(method, path, body) {
  const token = require("SUPABASE_ACCESS_TOKEN");
  const res = await fetch(`${MGMT_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`Supabase API ${method} ${path} → ${res.status}: ${text}`);
  }
  return data;
}

// ─── 1. Configure Amazon SES as Supabase SMTP ───────────────────────────────

async function configureSesSmtp() {
  const host = require("SES_SMTP_HOST");
  const port = Number(opt("SES_SMTP_PORT", "587"));
  const user = require("SES_SMTP_USER");
  const pass = require("SES_SMTP_PASS");
  const from = require("SES_FROM_EMAIL");

  console.log("\n📧  Configuring Amazon SES as Supabase SMTP...");

  await mgmt("PATCH", `/projects/${PROJECT_REF}/config/auth`, {
    smtp_admin_email: from,
    smtp_host: host,
    smtp_port: port,
    smtp_user: user,
    smtp_pass: pass,
    smtp_sender_name: opt("NEXT_PUBLIC_APP_NAME", "Canteen App"),
    smtp_max_frequency: 60,   // seconds between sends to same address (anti-spam)
    rate_limit_email_sent: 100, // max emails per hour
  });

  console.log("  ✅  SMTP configured:");
  console.log(`       Host:    ${host}:${port}`);
  console.log(`       Sender:  ${from}`);
  console.log(`       User:    ${user}`);
}

// ─── 2. Raise auth rate limits for 1-lakh/day scale ─────────────────────────

async function setRateLimits() {
  console.log("\n⚡  Raising auth rate limits for 1-lakh/day scale...");

  await mgmt("PATCH", `/projects/${PROJECT_REF}/config/auth`, {
    // Allow 1200 sign-up/OTP attempts per hour per IP (≈ 28 800/day)
    rate_limit_verify: 1200,
    // Allow up to 360 email OTPs per hour (the SES/Resend side has no hard cap)
    rate_limit_email_sent: 360,
    // Keep OTP tokens valid for 10 minutes
    mailer_otp_exp: 600,
    // OTP length: 6 digits
    mailer_otp_length: 6,
  });

  console.log("  ✅  Rate limits updated.");
}

// ─── 3. Verify Resend API key is valid ───────────────────────────────────────

async function verifyResend() {
  const key = opt("RESEND_API_KEY");
  if (!key) {
    console.log("\n⚠️   RESEND_API_KEY not set — skipping Resend verification.");
    console.log("    Set it later and rerun this script.");
    return;
  }

  console.log("\n📨  Verifying Resend API key...");
  const res = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    const t = await res.text();
    console.error(`  ❌  Resend API key invalid or request failed: ${res.status} ${t}`);
    return;
  }
  const data = await res.json();
  const domains = data?.data ?? [];
  if (domains.length === 0) {
    console.log("  ⚠️   Resend key is valid but NO verified domains found.");
    console.log("       Go to resend.com → Domains → Add Domain and verify your domain DNS.");
  } else {
    console.log("  ✅  Resend key valid. Verified domains:");
    for (const d of domains) {
      console.log(`       • ${d.name}  (status: ${d.status})`);
    }
    const ready = domains.filter((d) => d.status === "verified");
    if (ready.length === 0) {
      console.log("  ⚠️   No domains are 'verified' yet — DNS propagation may still be pending.");
    }
  }
}

// ─── 4. Print current auth config ────────────────────────────────────────────

async function printCurrentConfig() {
  console.log("\n📋  Current Supabase Auth config:");
  try {
    const cfg = await mgmt("GET", `/projects/${PROJECT_REF}/config/auth`);
    const keys = [
      "smtp_host", "smtp_port", "smtp_user", "smtp_admin_email",
      "rate_limit_verify", "rate_limit_email_sent", "mailer_otp_exp", "mailer_otp_length",
    ];
    for (const k of keys) {
      const v = cfg[k] ?? "(not set)";
      const masked = k.includes("pass") ? "***" : v;
      console.log(`  ${k.padEnd(30)} = ${masked}`);
    }
  } catch (e) {
    console.error("  Could not fetch config:", e.message);
  }
}

// ─── main ────────────────────────────────────────────────────────────────────

(async () => {
  console.log("🚀  Supabase Auth Provider Setup");
  console.log(`    Project: ${PROJECT_REF}`);

  try {
    // Validate access token first
    require("SUPABASE_ACCESS_TOKEN");

    const hasSes = process.env.SES_SMTP_HOST && process.env.SES_SMTP_USER;
    if (hasSes) {
      await configureSesSmtp();
      await setRateLimits();
    } else {
      console.log("\n⏭️   SES vars not set — skipping SMTP config.");
      console.log("    Set SES_SMTP_HOST, SES_SMTP_USER, SES_SMTP_PASS, SES_FROM_EMAIL to configure.");
    }

    await verifyResend();
    await printCurrentConfig();

    console.log("\n✅  Done! Supabase auth providers configured.");
    console.log("    Next steps:");
    console.log("    1. Set RESEND_API_KEY + OTP_FROM_EMAIL in Railway env vars");
    console.log("    2. Set SUPABASE_SERVICE_ROLE_KEY in Railway env vars");
    console.log("    3. Deploy your app");
  } catch (e) {
    console.error("\n❌  Setup failed:", e.message);
    process.exit(1);
  }
})();
