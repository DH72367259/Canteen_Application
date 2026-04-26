/**
 * POST /api/admin/settlements/payout
 *
 * Initiates a Razorpay X fund transfer (payout) to a canteen's bank account or UPI.
 * Falls back to "manual record" mode when RAZORPAY_ACCOUNT_NUMBER is not configured.
 *
 * Body:
 *   canteen_id, amount, contact_name, account_type ("upi" | "bank_account"),
 *   upi_id?, account_no?, ifsc_code?,
 *   period_start, period_end, gross_amount, platform_charge, gst_on_charge, net_payable,
 *   notes?
 */
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const KEY_ID     = process.env.RAZORPAY_KEY_ID     || "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const ACCOUNT_NO = process.env.RAZORPAY_ACCOUNT_NUMBER || ""; // RazorpayX source a/c

function rzpAuth() {
  return "Basic " + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
}

async function rzpPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method: "POST",
    headers: { Authorization: rzpAuth(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.description ?? `Razorpay error on ${path}`);
  return data;
}

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx || ctx.role !== "super_admin")
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const {
    canteen_id, amount, contact_name,
    account_type, upi_id, account_no, ifsc_code,
    period_start, period_end,
    gross_amount, platform_charge, gst_on_charge, net_payable,
    notes,
  } = body;

  if (!canteen_id || !amount || !contact_name || !account_type || !period_start || !period_end)
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  if (Number(amount) <= 0)
    return Response.json({ error: "Amount must be positive." }, { status: 400 });
  if (account_type === "upi" && !upi_id)
    return Response.json({ error: "upi_id is required for UPI payout." }, { status: 400 });
  if (account_type === "bank_account" && (!account_no || !ifsc_code))
    return Response.json({ error: "account_no and ifsc_code are required for bank payout." }, { status: 400 });

  const amountPaise = Math.round(Number(amount) * 100);

  // ── Path A: Razorpay X payout (automated) ──────────────────────────────
  if (KEY_ID && KEY_SECRET && ACCOUNT_NO) {
    try {
      // 1. Create / fetch contact
      const contact = await rzpPost("contacts", {
        name: contact_name,
        type: "vendor",
        reference_id: `canteen_${canteen_id}`,
      });

      // 2. Create fund account
      const fundAccountBody: Record<string, unknown> = {
        contact_id: contact.id,
        account_type: account_type === "upi" ? "vpa" : "bank_account",
      };
      if (account_type === "upi") {
        fundAccountBody.vpa = { address: upi_id };
      } else {
        fundAccountBody.bank_account = {
          name: contact_name,
          ifsc: ifsc_code,
          account_number: account_no,
        };
      }
      const fundAccount = await rzpPost("fund_accounts", fundAccountBody);

      // 3. Create payout
      const payout = await rzpPost("payouts", {
        account_number: ACCOUNT_NO,
        fund_account_id: fundAccount.id,
        amount: amountPaise,
        currency: "INR",
        mode: account_type === "upi" ? "UPI" : "IMPS",
        purpose: "settlement",
        queue_if_low_balance: true,
        reference_id: `settle_${canteen_id}_${Date.now()}`,
        narration: `NoQx Settlement - ${notes ?? period_start}`,
      });

      // 4. Record in DB
      const supabase = createAdminClient();
      const { data: record, error } = await supabase
        .from("settlement_payments")
        .insert({
          canteen_id,
          period_start,
          period_end,
          gross_amount:    Number(gross_amount    ?? 0),
          platform_charge: Number(platform_charge ?? 0),
          gst_on_charge:   Number(gst_on_charge   ?? 0),
          net_payable:     Number(net_payable      ?? 0),
          amount_paid:     Number(amount),
          payment_mode:    account_type === "upi" ? "upi" : "bank_transfer",
          transaction_ref: payout.id,
          notes:           notes || `Razorpay payout ${payout.status}`,
          paid_by:         ctx.uid,
        })
        .select("*")
        .single();

      if (error) return Response.json({ error: "Failed to record payout." }, { status: 500 });

      return Response.json({
        success: true,
        mode: "razorpay",
        payout_id: payout.id,
        payout_status: payout.status,
        payment: record,
      });
    } catch {
      return Response.json({
        error: "Razorpay payout failed. Please try again or record manually.",
        mode: "razorpay_error",
      }, { status: 502 });
    }
  }

  // ── Path B: Manual record (Razorpay X not configured) ──────────────────
  const { transaction_ref, payment_mode } = body;
  if (!transaction_ref)
    return Response.json({
      error: "Razorpay payouts are not configured. Please provide a transaction_ref for manual recording.",
      razorpay_not_configured: true,
    }, { status: 422 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("settlement_payments")
    .insert({
      canteen_id,
      period_start,
      period_end,
      gross_amount:    Number(gross_amount    ?? 0),
      platform_charge: Number(platform_charge ?? 0),
      gst_on_charge:   Number(gst_on_charge   ?? 0),
      net_payable:     Number(net_payable      ?? 0),
      amount_paid:     Number(amount),
      payment_mode:    payment_mode || "upi",
      transaction_ref: transaction_ref || null,
      notes:           notes || null,
      paid_by:         ctx.uid,
    })
    .select("*")
    .single();

  if (error) return Response.json({ error: "Failed to record settlement payment." }, { status: 500 });
  return Response.json({ success: true, mode: "manual", payment: data });
}
