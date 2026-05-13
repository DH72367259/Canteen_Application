"use client";
import { useEffect } from "react";

/**
 * Prevents right-click context menu and common DevTools keyboard shortcuts.
 * Mounted once at the root layout — no visible output.
 */
export function DisableDevTools() {
  useEffect(() => {
    const blockCtxMenu = (e: MouseEvent) => e.preventDefault();

    const blockKeys = (e: KeyboardEvent) => {
      const ctrl  = e.ctrlKey;
      const meta  = e.metaKey;   // Cmd on Mac
      const shift = e.shiftKey;
      const alt   = e.altKey;    // Option on Mac
      const k     = e.key;

      if (
        k === "F12" ||                              // F12
        (ctrl && shift && k === "I") ||             // Ctrl+Shift+I
        (ctrl && shift && k === "J") ||             // Ctrl+Shift+J
        (ctrl && shift && k === "C") ||             // Ctrl+Shift+C
        (ctrl && k === "u") ||                      // Ctrl+U (view-source)
        (meta && alt  && k === "i") ||              // Cmd+Opt+I
        (meta && alt  && k === "j") ||              // Cmd+Opt+J
        (meta && alt  && k === "c") ||              // Cmd+Opt+C
        (meta && alt  && k === "u")                 // Cmd+Opt+U
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener("contextmenu", blockCtxMenu);
    document.addEventListener("keydown",     blockKeys,    true);

    return () => {
      document.removeEventListener("contextmenu", blockCtxMenu);
      document.removeEventListener("keydown",     blockKeys,    true);
    };
  }, []);

  return null;
}
