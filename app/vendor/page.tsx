import Link from "next/link";
import { vendorModules } from "@/lib/workflows";

export default function VendorWorkflowPage() {
  return (
    <main className="canteen-page">
      <section className="hero">
        <p className="hero-kicker">Workflow Branch</p>
        <h1>Vendor Flow</h1>
        <p>Pages mapped from the Vendor workflow branch in Figma.</p>
      </section>

      <section className="panel nav-grid">
        {vendorModules.map((module) => (
          <Link key={module.slug} href={`/vendor/${module.slug}`} className="nav-card">
            <h2>{module.title}</h2>
            <p>{module.description}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
