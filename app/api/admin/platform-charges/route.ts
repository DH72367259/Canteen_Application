import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx || ctx.role !== "super_admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const supabase = createAdminClient();
  const { data } = await supabase.from("platform_charges").select("*").limit(1);
  return Response.json({ platform_charges: data?.[0] ?? null });
}

export async function PATCH(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx || ctx.role !== "super_admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const { charge_pct, flat_charge, gst_pct } = body;

  if (charge_pct !== undefined && (Number(charge_pct) < 0 || Number(charge_pct) > 100))
    return Response.json({ error: "charge_pct must be 0-100." }, { status: 400 });
  if (gst_pct !== undefined && (Number(gst_pct) < 0 || Number(gst_pct) > 100))
    return Response.json({ error: "gst_pct must be 0-100." }, { status: 400 });

  const supabase = createAdminClient();
  // Get existing charges row
  const { data: existing } = await supabase.from("platform_charges").select("id").limit(1);
  const id = existing?.[0]?.id;

  const updates: Record<string, number | string> = { updated_at: new Date().toISOString(), updated_by: ctx.uid };
  if (charge_pct  !== undefined) updates.charge_pct  = Number(charge_pct);
  if (flat_charge !== undefined) updates.flat_charge = Number(flat_charge);
  if (gst_pct     !== undefined) updates.gst_pct     = Number(gst_pct);

  let data, error;
  if (id) {
    ({ data, error } = await supabase.from("platform_charges").update(updates).eq("id", id).select("*").single());
  } else {
    ({ data, error } = await supabase.from("platform_charges").insert({ charge_pct: Number(charge_pct ?? 2), flat_charge: Number(flat_charge ?? 0), gst_pct: Number(gst_pct ?? 18), updated_by: ctx.uid }).select("*").single());
  }

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true, platform_charges: data });
}
