import Link from "next/link";

export default function HomePage() {
  return (
    <main className="canteen-page">
      <section className="hero">
        <p className="hero-kicker">NoQx Canteen Platform</p>
        <h1>Smart Institutional Dining Management</h1>
        <p>Skip queues. Pre-order your meals. Get rewards.</p>
      </section>

      <section className="panel">
        <h2>Access Portal</h2>
        <p style={{ marginBottom: "1rem" }}>Select your role to continue:</p>
        <div className="nav-grid" style={{ marginBottom: "1rem" }}>
          <Link href="/login?role=customer" className="nav-card">
            <h2>🛒 Customer</h2>
            <p>Place orders and track delivery</p>
          </Link>
          <Link href="/login?role=canteen-admin" className="nav-card">
            <h2>🏪 Canteen Admin</h2>
            <p>Manage orders and operations</p>
          </Link>
          <Link href="/login?role=vendor" className="nav-card">
            <h2>👨‍🍳 Vendor</h2>
            <p>Manage menu and sales</p>
          </Link>
          <Link href="/login?role=worker" className="nav-card">
            <h2>👷 Worker</h2>
            <p>Track tasks and waste</p>
          </Link>
          <Link href="/login?role=super-admin" className="nav-card">
            <h2>🔐 Super Admin</h2>
            <p>Platform administration</p>
          </Link>
        </div>
        <Link href="/login" className="nav-card" style={{ backgroundColor: "#f0f0f0" }}>
          <h2>Or Login Without Role Selection</h2>
          <p>Let the system detect your role</p>
        </Link>
      </section>

      <section className="panel">
        <h2>🌟 Platform Features</h2>
        <ul style={{ paddingLeft: "1.5rem", display: "grid", gap: "0.5rem" }}>
          <li>✓ Slot-based ordering system</li>
          <li>✓ Real-time order tracking</li>
          <li>✓ Bin-based pickup with OTP</li>
          <li>✓ Reward wallet (₹1-2 per order)</li>
          <li>✓ Worker waste tracking</li>
          <li>✓ Vendor dashboard with analytics</li>
          <li>✓ Canteen admin controls</li>
          <li>✓ Super admin analytics</li>
          <li>✓ Role-based access control</li>
          <li>✓ Firebase powered security</li>
        </ul>
      </section>

      <section className="panel" style={{ backgroundColor: "#f9f9f9" }}>
        <h2>📚 Workflow Hubs</h2>
        <p style={{ marginBottom: "1rem", color: "#666" }}>Direct access to role-specific tools:</p>
        <div className="nav-grid">
          <Link href="/vendor" className="nav-card">
            <h2>Vendor Workflows</h2>
            <p>Menu, Slots, Orders</p>
          </Link>
          <Link href="/system" className="nav-card">
            <h2>Admin Workflows</h2>
            <p>Canteens, Users, Analytics</p>
          </Link>
          <Link href="/operations" className="nav-card">
            <h2>Operations</h2>
            <p>Tasks, Bins, Waste</p>
          </Link>
        </div>
      </section>
    </main>
  );
}
