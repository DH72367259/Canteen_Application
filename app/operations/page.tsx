import Link from "next/link";
import { operationsModules } from "@/lib/workflows";

export default function OperationsWorkflowPage() {
  return (
    <main className="canteen-page">
      <section className="hero">
        <p className="hero-kicker">Workflow Branch</p>
        <h1>Operations Flow</h1>
        <p>Additional operational branch captured from the Figma navigation map.</p>
      </section>

      <section className="panel nav-grid">
        {operationsModules.map((module) => (
          <Link key={module.slug} href={`/operations/${module.slug}`} className="nav-card">
            <h2>{module.title}</h2>
            <p>{module.description}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
