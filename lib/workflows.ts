export type WorkflowModule = {
  slug: string;
  title: string;
  description: string;
};

export const vendorModules: WorkflowModule[] = [
  { slug: "login", title: "Vendor Web Login", description: "Vendor authentication entry point." },
  { slug: "dashboard", title: "Vendor Dashboard", description: "Operational overview for each vendor." },
  { slug: "staff-access", title: "Manage Staff Access", description: "Grant and revoke access for vendor staff." },
  { slug: "menu", title: "Manage Menu", description: "Maintain item catalog and availability." },
  { slug: "live-slots", title: "Live Slots", description: "Control slot availability in real time." },
  { slug: "orders-report", title: "Slot Orders Report", description: "Track orders grouped by slots." },
];

export const systemModules: WorkflowModule[] = [
  { slug: "login", title: "Super Admin Login", description: "Super admin authentication entry point." },
  { slug: "dashboard", title: "System Dashboard", description: "Global controls and system-level overview." },
  { slug: "complaints-escalations", title: "Complaints & Escalations", description: "Incident intake and escalation flow." },
  { slug: "canteens", title: "Manage Canteens", description: "Create and configure canteen entities." },
  { slug: "users-control", title: "All Users Control", description: "Role control and account governance." },
  { slug: "cities", title: "Manage Cities", description: "City-level operational configuration." },
  { slug: "platform-analytics", title: "Platform Analytics", description: "Cross-platform metrics and trends." },
  { slug: "payments-settlements", title: "Payments & Settlements", description: "Payment reconciliation and settlements." },
  { slug: "colleges", title: "Manage Colleges", description: "College onboarding and configuration." },
];

export const operationsModules: WorkflowModule[] = [
  { slug: "hostel-day-board", title: "Hostel / Day Board", description: "Hostel or day-board operational branch." },
  { slug: "payout", title: "Payout", description: "Payout orchestration entry for this branch." },
  { slug: "support", title: "Support", description: "Support operations and issue handling." },
  { slug: "vendor-payout", title: "Vendor Payout", description: "Vendor payout execution and tracking." },
  { slug: "control-hub", title: "Control Hub", description: "Central control and monitoring." },
];

export function getModuleBySlug(modules: WorkflowModule[], slug: string) {
  return modules.find((module) => module.slug === slug) ?? null;
}
