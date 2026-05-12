import { Resend } from "resend";

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Canteen App";

/** Send a 6-digit OTP email via Resend. Returns null on success, error string on failure. */
export async function sendOtpEmail(
  to: string,
  otp: string
): Promise<string | null> {
  const resend = getResend();
  if (!resend) return "RESEND_API_KEY not configured";

  const fromEmail =
    process.env.OTP_FROM_EMAIL ?? "noreply@notifications.yourapp.com";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08)">
        <tr>
          <td style="background:#1a1a2e;padding:28px 40px;text-align:center">
            <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">${APP_NAME}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:40px">
            <p style="margin:0 0 8px;font-size:15px;color:#444">Your login verification code:</p>
            <div style="background:#f0f4ff;border:2px dashed #4f46e5;border-radius:10px;padding:24px;text-align:center;margin:20px 0">
              <span style="font-size:40px;font-weight:700;letter-spacing:10px;color:#1a1a2e">${otp}</span>
            </div>
            <p style="margin:0 0 8px;font-size:14px;color:#666">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
            <p style="margin:20px 0 0;font-size:13px;color:#999">If you did not request this code, you can safely ignore this email.</p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9f9f9;padding:16px 40px;text-align:center">
            <p style="margin:0;font-size:12px;color:#aaa">&copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const { error } = await resend.emails.send({
      from: fromEmail,
      to,
      subject: `${otp} is your ${APP_NAME} verification code`,
      html,
    });
    if (error) return error.message;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Resend send failed";
  }
}
