/**
 * Twilio SMS sender for login OTP.
 * Uses Messaging Service SID so Twilio picks the best sender for India.
 */

export async function sendSmsOtp(
  phone: string,
  code: string
): Promise<string | null> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_MESSAGE_SERVICE_SID;

  if (!accountSid || !authToken || !serviceSid) {
    return "Twilio credentials not configured";
  }

  const digits = phone.replace(/\D/g, "").replace(/^91/, "");
  if (digits.length !== 10) return "Invalid Indian phone number (must be 10 digits)";

  const to = `+91${digits}`;
  const body = `Your NoQx login OTP is ${code}. Valid for 10 minutes. Do not share this with anyone.`;

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const params = new URLSearchParams({ To: to, MessagingServiceSid: serviceSid, Body: body });

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data as { message?: string }).message ?? `Twilio error ${res.status}`;
      return msg;
    }
    return null; // null = success
  } catch (e) {
    return e instanceof Error ? e.message : "Twilio request failed";
  }
}
