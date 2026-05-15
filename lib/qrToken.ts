/**
 * TOTP-style QR token for order verification.
 *
 * Tokens rotate every 30 seconds. Even if a student screenshots the QR,
 * it becomes invalid within 30 seconds. This is the primary screenshot
 * protection mechanism.
 *
 * Format: NOQX|{orderId}|{window}|{hmac16}
 * - window  = Math.floor(Date.now() / 30_000)  (changes every 30s)
 * - hmac16  = HMAC-SHA256(orderId + ":" + window, QR_SECRET).slice(0,16)
 */
import crypto from "crypto";

const QR_SECRET =
  process.env.QR_HMAC_SECRET ?? "noqx-qr-fallback-change-in-prod";

export function currentWindow(): number {
  return Math.floor(Date.now() / 30_000);
}

export function hmac16(orderId: string, window: number): string {
  return crypto
    .createHmac("sha256", QR_SECRET)
    .update(`${orderId}:${window}`)
    .digest("hex")
    .slice(0, 16);
}

/** Build the QR string that the student's app displays. */
export function buildQrPayload(orderId: string): string {
  const win = currentWindow();
  const h   = hmac16(orderId, win);
  return `NOQX|${orderId}|${win}|${h}`;
}

/**
 * Verify a QR payload string from the worker's scanner.
 * Accepts current window and one window back (graceful 30s overlap).
 * Returns the orderId on success, null on failure.
 */
export function verifyQrPayload(payload: string): string | null {
  const parts = payload.split("|");
  if (parts.length !== 4 || parts[0] !== "NOQX") return null;
  const [, orderId, winStr, receivedHmac] = parts;
  const win = parseInt(winStr, 10);
  if (isNaN(win)) return null;

  const now = currentWindow();
  const valid =
    (win === now     && hmac16(orderId, win) === receivedHmac) ||
    (win === now - 1 && hmac16(orderId, win) === receivedHmac);

  return valid ? orderId : null;
}
