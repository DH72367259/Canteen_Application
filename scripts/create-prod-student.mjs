// Create a student account in production for darshan849696@gmail.com so we
// can run the Resend password-reset dry-run end-to-end.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://dpycfyeiyhzvwbythcrp.supabase.co";
const SERVICE_ROLE = process.env.SERVICE_ROLE;
if (!SERVICE_ROLE) { console.error("SERVICE_ROLE env var required"); process.exit(1); }

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const email = "darshan849696@gmail.com";
const tempPassword = "TempPass#2026";  // operator will reset via OTP flow

// 1. Create auth user
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email,
  password: tempPassword,
  email_confirm: true,
  user_metadata: { name: "Darshan (operator)" },
});

if (createErr && !createErr.message?.includes("already")) {
  console.error("createUser failed:", createErr);
  process.exit(1);
}

let userId = created?.user?.id;
if (!userId) {
  // already exists — look up by listing
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const found = list?.users?.find(u => u.email === email);
  if (!found) { console.error("auth user not found after create"); process.exit(1); }
  userId = found.id;
  console.log("auth user already existed:", userId);
} else {
  console.log("auth user created:", userId);
}

// 2. Create profile row
const { error: profileErr } = await admin
  .from("profiles")
  .upsert({
    id: userId,
    email,
    name: "Darshan (operator)",
    role: "user",
    phone: "+91 70199 86046",
  }, { onConflict: "id" });

if (profileErr) {
  console.error("profile upsert failed:", profileErr);
  process.exit(1);
}
console.log("profile upserted ✓");

console.log("\nDONE. Account ready:");
console.log("  email   :", email);
console.log("  role    : user (student)");
console.log("  temp pw : (irrelevant — use Forgot Password to set real one)");
console.log("\nNow go to https://noqx.co.in/login → Forgot password → enter the email.");
