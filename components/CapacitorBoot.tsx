"use client";

import { useCapacitorBootstrap } from "@/lib/capacitorBootstrap";

/**
 * Mounts the Capacitor bootstrap hook. Renders nothing — pure side-effect.
 * No-op on the web; on native it wires status-bar + push notifications.
 */
export function CapacitorBoot(): null {
  useCapacitorBootstrap();
  return null;
}
