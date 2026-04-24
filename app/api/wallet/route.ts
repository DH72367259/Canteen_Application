import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return Response.json({ error: "Unauthorised" }, { status: 401 });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return Response.json({ error: "Unauthorised" }, { status: 401 });

  const { data: transactions, error: txErr } = await supabase
    .from("wallet_transactions")
    .select("id, type, amount, payment_method, description, status, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (txErr) return Response.json({ transactions: [] });

  const { data: profile } = await supabase
    .from("profiles")
    .select("wallet_balance")
    .eq("id", user.id)
    .single();

  return Response.json({
    balance: profile?.wallet_balance ?? 0,
    transactions: transactions ?? [],
  });
}
