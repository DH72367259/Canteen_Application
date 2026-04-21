import { NextRequest } from "next/server";
import crypto from "crypto";

const MERCHANT_ID  = process.env.PHONEPE_MERCHANT_ID  || "";
const SALT_KEY     = process.env.PHONEPE_SALT_KEY     || "";
const SALT_INDEX   = process.env.PHONEPE_SALT_INDEX   || "1";
const IS_PROD      = process.env.PHONEPE_ENV === "production";

const PHONEPE_BASE =
  IS_PROD
    ? "https://api.phonepe.com/apis/hermes"
    : "https://api-preprod.phonepe.com/apis/pg-sandbox";

export async function POST(req: NextRequest) {
  if (!MERCHANT_ID || !SALT_KEY) {
    return Response.json(
      { error: "Payment gateway not configured. Contact support." },
      { status: 503 }
    );
  }

  let body: { amount?: number; userId?: string; txnId?: string; redirectUrl?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { amount, userId, txnId, redirectUrl } = body;

  if (!amount || !txnId || !redirectUrl) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }

  // Sanitise txnId — PhonePe allows max 38 alphanumeric chars
  const safeTxnId = String(txnId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 38);

  const payload = {
    merchantId:            MERCHANT_ID,
    merchantTransactionId: safeTxnId,
    merchantUserId:        String(userId || "GUEST").slice(0, 36),
    amount:                Math.round(Number(amount) * 100), // convert ₹ to paise
    redirectUrl,
    redirectMode:          "REDIRECT",
    callbackUrl:           redirectUrl,
    paymentInstrument:     { type: "PAY_PAGE" },
  };

  const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64");
  const hashInput     = base64Payload + "/pg/v1/pay" + SALT_KEY;
  const checksum      = crypto.createHash("sha256").update(hashInput).digest("hex") +
                        "###" + SALT_INDEX;

  let phonePeData: {
    success?: boolean;
    data?: { instrumentResponse?: { redirectInfo?: { url?: string } } };
  };
  try {
    const resp = await fetch(`${PHONEPE_BASE}/pg/v1/pay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-VERIFY":     checksum,
      },
      body: JSON.stringify({ request: base64Payload }),
    });
    phonePeData = await resp.json();
  } catch {
    return Response.json({ error: "Payment gateway unreachable." }, { status: 502 });
  }

  const redirectInfo = phonePeData?.data?.instrumentResponse?.redirectInfo;
  if (!phonePeData?.success || !redirectInfo?.url) {
    return Response.json({ error: "Payment initiation failed." }, { status: 502 });
  }

  return Response.json({ redirectUrl: redirectInfo.url });
}
