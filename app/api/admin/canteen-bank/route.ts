import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx || ctx.role !== "super_admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const canteen_id = searchParams.get("canteen_id");

  const supabase = createAdminClient();
  let query = supabase.from("canteen_bank_details").select("*");
  if (canteen_id) query = query.eq("canteen_id", canteen_id);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ bank_details: data ?? [] });
}

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx || ctx.role !== "super_admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { canteen_id, account_name, account_no, ifsc_code, bank_name, upi_id, gpay_number } = body;
  if (!canteen_id || !account_name || !account_no || !ifsc_code)
    return Response.json({ error: "canteen_id, account_name, account_no, ifsc_code are required." }, { status: 400 });

  // Validate IFSC format: 4 letters, 0, 6 alphanumeric
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc_code.toUpperCase()))
    return Response.json({ error: "Invalid IFSC code format." }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("canteen_bank_details")
    .upsert(
      {
        canteen_id,
        account_name: account_name.trim(),
        account_no:   account_no.trim(),
        ifsc_code:    ifsc_code.toUpperCase().trim(),
        bank_name:    bank_name     || null,
        upi_id:       upi_id        || null,
        gpay_number:  gpay_number   || null,
        updated_at:   new Date().toISOString(),
      },
      { onConflict: "canteen_id" }
    )
    .select("*")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true, bank_details: data });
}
