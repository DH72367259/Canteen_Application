/**
 * Fast2SMS client for India OTP delivery.
 * Uses "q" (Quick SMS) route as fallback when OTP route is pending website verification.
 * Once Fast2SMS approves OTP route, switch FAST2SMS_ROUTE env var to "otp".
 */

export async function sendSmsOtp(
  phone: string,
  code: string
): Promise<string | null> {
  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) return "FAST2SMS_API_KEY not configured";

  // Fast2SMS needs 10-digit number (strip +91 prefix)
  const digits = phone.replace(/\D/g, "").replace(/^91/, "");
  if (digits.length !== 10) return "Invalid Indian phone number (must be 10 digits)";

  // Use "otp" route if approved, else fall back to "q" (Quick SMS)
  const route = process.env.FAST2SMS_ROUTE ?? "q";

  const body =
    route === "otp"
      ? {
          route: "otp",
          variables_values: code,
          flash: "0",
          numbers: digits,
        }
      : {
          route: "q",
          message: `Your Canteen App OTP is ${code}. Valid for 10 minutes. Do not share it with anyone.`,
          language: "english",
          flash: "0",
          numbers: digits,
        };

  try {
    const res = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: {
        authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.return === false) {
      return data.message ?? `Fast2SMS error ${res.status}`;
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Fast2SMS request failed";
  }
}
