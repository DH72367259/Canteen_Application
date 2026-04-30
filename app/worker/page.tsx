"use client";

import Link from "next/link";

export default function WorkerPage() {
  return (
    <main className="canteen-page">
      <section className="hero">
        <p className="hero-kicker">Worker Operations</p>
        <h1>Worker Workflows</h1>
        <p>Access your worker tools and operations.</p>
        <p className="route-links">
          <Link href="/">Home</Link>
        </p>
      </section>

      <section className="panel">
        <h2>🔧 Workflow Hub</h2>
        <nav className="nav-grid">
          <Link href="/worker/dashboard" className="nav-card">
            <h2>Dashboard</h2>
            <p>View your tasks and workload</p>
          </Link>
          <Link href="/worker/orders" className="nav-card">
            <h2>Incoming Orders</h2>
            <p>Manage and confirm new orders</p>
          </Link>
          <Link href="/worker/bins" className="nav-card">
            <h2>Bin Management</h2>
            <p>Track and update bin status</p>
          </Link>
          <Link href="/worker/waste-tracking" className="nav-card">
            <h2>Waste Reporting</h2>
            <p>Report waste disposal</p>
          </Link>
        </nav>
      </section>
    </main>
  );
}
