"use client";

import { useEffect } from "react";

/**
 * Hamburger button + slide-out backdrop for the vendor / admin sidebar on
 * mobile viewports (≤768px). On desktop both elements are display:none.
 *
 * No React state or context: the open/closed state lives as a body class
 * (`body.sidebar-open`). The CSS in app/globals.css drives the transform
 * animation and backdrop visibility from that single class.
 *
 * `<MobileSidebarToggle />` — render once in the topbar of each dashboard.
 * `<MobileSidebarBackdrop />` — render once inside the .web-shell wrapper.
 * The same component instance auto-closes the drawer when any sidebar
 * link inside it is tapped, so navigating sections feels native.
 */
function closeSidebar() {
  if (typeof document !== "undefined") {
    document.body.classList.remove("sidebar-open");
  }
}

export function MobileSidebarToggle() {
  // Delegate: any click anywhere inside an open .sidebar that lands on a
  // .sidebar-link closes the drawer. Keeps the toggle component the only
  // place that knows about the body class, so parent pages don't have to
  // sprinkle close() calls into every navigation handler.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".sidebar .sidebar-link")) {
        closeSidebar();
      }
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  function toggle() {
    if (typeof document === "undefined") return;
    document.body.classList.toggle("sidebar-open");
  }

  return (
    <button
      onClick={toggle}
      aria-label="Open menu"
      className="mobile-sidebar-toggle"
      type="button"
    >
      ☰
    </button>
  );
}

export function MobileSidebarBackdrop() {
  return (
    <div
      className="mobile-sidebar-backdrop"
      onClick={closeSidebar}
      aria-hidden="true"
    />
  );
}
