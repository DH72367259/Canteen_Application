/**
 * Fast2SMS client for India OTP delivery.
 * Pricing: ~₹0.15/SMS. No Twilio needed.
 * Get API key: fast2sms.com → Dashboard → Dev API
 */

/** Sends a 6-digit OTP to an Indian mobile number via Fast2SMS.
 *  Returns null on success, error string on failure. */
export async function sendSmsOtp(
  phone: string,
  code: string
): Promise<string | null> {
  const apiKey = process.env.FAST2SMS_API_KEY;
  if (!apiKey) return "FAST2SMS_API_KEY not configured";

  // Fast2SMS needs 10-digit number (strip +91 or 91 prefix)
  const digits = phone.replace(/\D/g, "").replace(/^91/, "");
  if (digits.length !== 10) return "Invalid Indian phone number (must be 10 digits)";

  try {
    const res = await fetch("https://www.fast2sms.com/dev/bulkV2", {
      method: "POST",
      headers: {
        authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        route: "otp",
        variables_values: code,
        flash: "0",
        numbers: digits,
      }),
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
