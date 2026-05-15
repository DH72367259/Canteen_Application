"use client";

/**
 * OrderQRCode — rotating TOTP-style QR code for order pickup.
 *
 * Security properties:
 * - Renders to <canvas> (no right-click → Save Image on most browsers)
 * - Blocks pointer events on the canvas to prevent long-press save on mobile
 * - Token rotates every 30 seconds (even if screenshotted, expires fast)
 * - oncontextmenu blocked on the whole container
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  orderId: string;
  token: string;          // access_token for the API call
  size?: number;
}

interface QrTokenResponse {
  payload: string;
  expiresAt: number;
  orderId: string;
}

export default function OrderQRCode({ orderId, token, size = 220 }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [error, setError]     = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const refreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const drawQr = useCallback(async (payload: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const QRCode = (await import("qrcode")).default;
      await QRCode.toCanvas(canvas, payload, {
        width: size,
        margin: 2,
        color: { dark: "#1e293b", light: "#ffffff" },
        errorCorrectionLevel: "M",
      });
    } catch {
      // ignore canvas draw errors
    }
  }, [size]);

  const fetchAndDraw = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/qr-token`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setError(d.error ?? "Could not load QR.");
        setLoading(false);
        return;
      }
      const data = await res.json() as QrTokenResponse;
      setError(null);
      await drawQr(data.payload);

      // Schedule next refresh just after the window expires
      const msUntilExpiry = Math.max(0, data.expiresAt - Date.now()) + 200;
      if (refreshRef.current) clearTimeout(refreshRef.current);
      refreshRef.current = setTimeout(() => { void fetchAndDraw(); }, msUntilExpiry);
    } catch {
      setError("Network error loading QR.");
    } finally {
      setLoading(false);
    }
  }, [orderId, token, drawQr]);

  // Countdown timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000);
      const remaining = 30 - (nowSec % 30);
      setSecondsLeft(remaining);
    }, 500);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  useEffect(() => {
    void fetchAndDraw();
    return () => {
      if (refreshRef.current) clearTimeout(refreshRef.current);
    };
  }, [fetchAndDraw]);

  const urgency = secondsLeft <= 5;

  return (
    <div
      style={{ userSelect: "none", WebkitUserSelect: "none" }}
      onContextMenu={e => e.preventDefault()}
    >
      {/* QR canvas */}
      <div style={{ position: "relative", width: size, height: size, margin: "0 auto", borderRadius: 16, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.12)" }}>
        {loading && (
          <div style={{ position: "absolute", inset: 0, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div className="spinner" />
          </div>
        )}
        {error && (
          <div style={{ position: "absolute", inset: 0, background: "#fef2f2", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem", textAlign: "center", fontSize: "0.8rem", color: "#dc2626" }}>
            {error}
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={size}
          height={size}
          style={{ display: "block", pointerEvents: "none", touchAction: "none" }}
        />
      </div>

      {/* Countdown ring */}
      <div style={{ marginTop: "0.75rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
        <svg width={28} height={28} viewBox="0 0 28 28">
          <circle cx={14} cy={14} r={12} fill="none" stroke="#e5e7eb" strokeWidth={2.5} />
          <circle
            cx={14} cy={14} r={12}
            fill="none"
            stroke={urgency ? "#dc2626" : "#f97316"}
            strokeWidth={2.5}
            strokeDasharray={75.4}
            strokeDashoffset={75.4 * (1 - secondsLeft / 30)}
            strokeLinecap="round"
            transform="rotate(-90 14 14)"
            style={{ transition: "stroke-dashoffset 0.5s linear, stroke 0.3s" }}
          />
          <text x={14} y={18} textAnchor="middle" fontSize={9} fontWeight="700" fill={urgency ? "#dc2626" : "#475569"}>
            {secondsLeft}s
          </text>
        </svg>
        <span style={{ fontSize: "0.78rem", color: urgency ? "#dc2626" : "#64748b", fontWeight: urgency ? 700 : 500 }}>
          {urgency ? "Refreshing…" : "Refreshes automatically"}
        </span>
      </div>
    </div>
  );
}
