"use client";

/**
 * QRCameraScanner — native camera QR scanner.
 *
 * How it works:
 *   1. Caller calls getUserMedia() SYNCHRONOUSLY inside a button onClick
 *      (keeps Chrome Android gesture context → permission dialog appears).
 *   2. Caller passes the resulting Promise<MediaStream> as `streamPromise`.
 *   3. This component attaches the stream to a <video> element and polls
 *      frames with the native BarcodeDetector API (Android Chrome 83+).
 *   4. On unmount the stream tracks are always stopped.
 *
 * No html5-qrcode or any other library — eliminates the gesture-context
 * problem that prevented the camera permission dialog from appearing.
 */

import { useEffect, useRef, useState } from "react";

interface Props {
  streamPromise: Promise<MediaStream> | null;
  onScanned: (text: string) => void;
}

export default function QRCameraScanner({ streamPromise, onScanned }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady]   = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!streamPromise) return;

    let alive = true;
    let stream: MediaStream | null = null;
    let rafId: number | null = null;

    streamPromise
      .then((s) => {
        if (!alive) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;

        const video = videoRef.current;
        if (!video) { s.getTracks().forEach((t) => t.stop()); return; }

        video.srcObject = s;
        video.play().catch(() => {});
        setReady(true);

        if (!("BarcodeDetector" in window)) {
          setError("QR scanning not supported on this browser — use OTP instead.");
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });

        const scan = async () => {
          if (!alive) return;
          try {
            if (video.readyState >= 2) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const codes: any[] = await detector.detect(video);
              if (codes.length > 0 && alive) {
                alive = false;
                onScanned(String(codes[0].rawValue));
                return;
              }
            }
          } catch { /* ignore per-frame errors */ }
          if (alive) rafId = requestAnimationFrame(() => { void scan(); });
        };

        video.onloadedmetadata = () => { void scan(); };
        if (video.readyState >= 2) void scan();
      })
      .catch((e) => {
        if (!alive) return;
        const name = e instanceof Error ? e.name : "";
        const msg  = e instanceof Error ? e.message : String(e);
        if (name === "NotAllowedError" || /denied|not allowed|permission/i.test(msg)) {
          setError(
            "Camera access was blocked. In Chrome tap ⋮ → Site settings → Camera → set to Allow, then tap Try Again.",
          );
        } else if (name === "NotFoundError") {
          setError("No camera found on this device. Use OTP instead.");
        } else {
          setError(`Camera error: ${msg || "unknown"}. Tap Try Again or use OTP.`);
        }
      });

    return () => {
      alive = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [streamPromise, onScanned]);

  if (error) {
    return (
      <div style={{ padding: "1.1rem", background: "#fef2f2", borderRadius: 12, border: "1.5px solid #fca5a5", textAlign: "center" }}>
        <div style={{ fontSize: "1.75rem", marginBottom: "0.4rem" }}>📷</div>
        <p style={{ color: "#dc2626", fontWeight: 700, fontSize: "0.83rem", margin: 0, lineHeight: 1.55 }}>
          {error}
        </p>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "#000", minHeight: 220 }}>
      {!ready && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="spinner" />
        </div>
      )}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{ width: "100%", display: "block", maxHeight: 300, objectFit: "cover" }}
      />
      {ready && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ width: 170, height: 170, border: "2.5px solid rgba(255,255,255,0.85)", borderRadius: 10, boxShadow: "0 0 0 2000px rgba(0,0,0,0.35)" }} />
        </div>
      )}
    </div>
  );
}
