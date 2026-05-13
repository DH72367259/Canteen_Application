/**
 * Fast2SMS OTP client for India (~₹0.15/OTP, SMS-only, no DLT needed).
 * API docs: https://docs.fast2sms.com
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

  try {
    const res = await fetch(
      `https://www.fast2sms.com/dev/bulkV2?authorization=${encodeURIComponent(apiKey)}&route=q&message=Your+NoQX+order+OTP+is+${code}.+Do+not+share+this+with+anyone.&numbers=${digits}&flash=0`,
      {
        method: "GET",
        headers: { "cache-control": "no-cache" },
      }
    );

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.return === false) {
      const msg = Array.isArray(data.message) ? data.message[0] : (data.message ?? `Fast2SMS error ${res.status}`);
      return msg;
    }
    return null; // null = success
  } catch (e) {
    return e instanceof Error ? e.message : "Fast2SMS request failed";
  }
}
