import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> }
) {
  const ctx = await getRequestContext(request);
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id: orderId } = await routeContext.params;
  const supabase = createAdminClient();

  const { data: order, error } = await supabase
    .from("orders")
    .select("*, order_items(*, menu_items(name, category)), canteens(name, city, college), profiles!orders_user_id_fkey(name, email)")
    .eq("id", orderId)
    .single();

  if (error || !order) return Response.json({ error: "Order not found" }, { status: 404 });

  // Only owner or admin can fetch
  if (order.user_id !== ctx.uid && ctx.role !== "super_admin" && ctx.role !== "canteen_admin")
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const items = (order.order_items ?? []).map((i: Record<string, unknown>) => {
    const qty       = Number(i.quantity ?? 0);
    const unit      = Number(i.unit_price ?? 0);
    const taxable   = unit * qty;
    const cgst      = Math.round(taxable * 0.025 * 100) / 100;
    const sgst      = Math.round(taxable * 0.025 * 100) / 100;
    const total     = Math.round((taxable + cgst + sgst) * 100) / 100;
    return {
      name:      (i.menu_items as Record<string, unknown>)?.name ?? "Item",
      quantity:  qty,
      unit_price: unit,
      taxable_amount: taxable,
      cgst_2_5: cgst,
      sgst_2_5: sgst,
      total,
    };
  });

  const subtotal        = items.reduce((s: number, i: { taxable_amount: number }) => s + i.taxable_amount, 0);
  const total_cgst      = items.reduce((s: number, i: { cgst_2_5: number })       => s + i.cgst_2_5, 0);
  const total_sgst      = items.reduce((s: number, i: { sgst_2_5: number })       => s + i.sgst_2_5, 0);
  const grand_total     = Math.round((subtotal + total_cgst + total_sgst) * 100) / 100;

  const invoiceDate = new Date(order.created_at);
  const invoiceNumber = `NOQX-${invoiceDate.getFullYear()}${String(invoiceDate.getMonth() + 1).padStart(2, "0")}${String(invoiceDate.getDate()).padStart(2, "0")}-${orderId.slice(-6).toUpperCase()}`;

  return Response.json({
    invoice_number: invoiceNumber,
    invoice_date:   order.created_at,
    order_id:       orderId,
    order_status:   order.status,
    customer: {
      name:  (order.profiles as Record<string, unknown>)?.name ?? "Student",
      email: (order.profiles as Record<string, unknown>)?.email ?? "",
    },
    canteen: {
      name:    (order.canteens as Record<string, unknown>)?.name ?? "Canteen",
      city:    (order.canteens as Record<string, unknown>)?.city ?? "",
      college: (order.canteens as Record<string, unknown>)?.college ?? "",
    },
    items,
    subtotal:    Math.round(subtotal * 100) / 100,
    total_cgst:  Math.round(total_cgst * 100) / 100,
    total_sgst:  Math.round(total_sgst * 100) / 100,
    grand_total,
    payment_id:  order.payment_id ?? null,
    gst_note:    "GST @ 5% (CGST 2.5% + SGST 2.5%) applicable on food items as per GST Act.",
  });
}
