/**
 * 2Factor.in SMS OTP client for India (~₹0.25/OTP, no DLT registration needed).
 * API docs: https://2factor.in/API/V1/{API_KEY}/SMS/{PHONE}/{OTP}
 */

export async function sendSmsOtp(
  phone: string,
  code: string
): Promise<string | null> {
  const apiKey = process.env.TWOFACTOR_API_KEY;
  if (!apiKey) return "TWOFACTOR_API_KEY not configured";

  // 2Factor needs 10-digit number (strip +91 prefix)
  const digits = phone.replace(/\D/g, "").replace(/^91/, "");
  if (digits.length !== 10) return "Invalid Indian phone number (must be 10 digits)";

  try {
    const url = `https://2factor.in/API/V1/${apiKey}/SMS/${digits}/${code}/OTP1`;
    const res = await fetch(url, { method: "GET" });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.Status !== "Success") {
      return data.Details ?? `2Factor error ${res.status}`;
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "2Factor SMS request failed";
  }
}
