import Link from "next/link";
import { systemModules } from "@/lib/workflows";

export default function SystemWorkflowPage() {
  return (
    <main className="canteen-page">
      <section className="hero">
        <p className="hero-kicker">Workflow Branch</p>
        <h1>System Flow</h1>
        <p>Pages mapped from the Super Admin/System workflow branch in Figma.</p>
      </section>

      <section className="panel nav-grid">
        {systemModules.map((module) => (
          <Link key={module.slug} href={`/system/${module.slug}`} className="nav-card">
            <h2>{module.title}</h2>
            <p>{module.description}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
