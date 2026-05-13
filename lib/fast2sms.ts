/**
 * Fast2SMS OTP client for India (~₹0.15/OTP, SMS-only, no DLT needed).
 * API docs: https://docs.fast2sms.com
 * Route: OTP — sends a 4-6 digit OTP via SMS template
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
      `https://www.fast2sms.com/dev/bulkV2?authorization=${apiKey}&route=otp&variables_values=${code}&flash=0&numbers=${digits}`,
      {
        method: "GET",
        headers: { "cache-control": "no-cache" },
      }
    );

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.return === false) {
      return data.message?.[0] ?? `Fast2SMS error ${res.status}`;
    }
    return null; // null = success
  } catch (e) {
    return e instanceof Error ? e.message : "Fast2SMS request failed";
  }
}
