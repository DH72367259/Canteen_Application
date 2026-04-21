import { NextRequest } from "next/server";
import crypto from "crypto";

const MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID || "";
const SALT_KEY    = process.env.PHONEPE_SALT_KEY    || "";
const SALT_INDEX  = process.env.PHONEPE_SALT_INDEX  || "1";
const IS_PROD     = process.env.PHONEPE_ENV === "production";

const PHONEPE_BASE =
  IS_PROD
    ? "https://api.phonepe.com/apis/hermes"
    : "https://api-preprod.phonepe.com/apis/pg-sandbox";

export async function GET(req: NextRequest) {
  const txnId = req.nextUrl.searchParams.get("txnId");

  if (!txnId) {
    return Response.json({ error: "Missing txnId." }, { status: 400 });
  }
  if (!MERCHANT_ID || !SALT_KEY) {
    return Response.json({ error: "Payment gateway not configured." }, { status: 503 });
  }

  const path     = `/pg/v1/status/${MERCHANT_ID}/${txnId}`;
  const checksum = crypto.createHash("sha256")
    .update(path + SALT_KEY)
    .digest("hex") + "###" + SALT_INDEX;

  let data: { success?: boolean; code?: string };
  try {
    const resp = await fetch(`${PHONEPE_BASE}${path}`, {
      headers: {
        "Content-Type":  "application/json",
        "X-VERIFY":      checksum,
        "X-MERCHANT-ID": MERCHANT_ID,
      },
    });
    data = await resp.json();
  } catch {
    return Response.json({ error: "Verification request failed." }, { status: 502 });
  }

  const success = data?.success === true && data?.code === "PAYMENT_SUCCESS";
  return Response.json({ success, txnId, code: data?.code });
}
