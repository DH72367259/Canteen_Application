import Link from "next/link";
import { notFound } from "next/navigation";
import { getModuleBySlug, operationsModules } from "@/lib/workflows";

export default async function OperationsModulePage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;
  const moduleData = getModuleBySlug(operationsModules, module);

  if (!moduleData) {
    notFound();
  }

  return (
    <main className="canteen-page">
      <section className="hero">
        <p className="hero-kicker">Operations Module</p>
        <h1>{moduleData.title}</h1>
        <p>{moduleData.description}</p>
        <p className="route-links">
          <Link href="/">Home</Link> | <Link href="/operations">Operations Flow</Link>
        </p>
      </section>

      <section className="panel">
        <h2>Implementation Note</h2>
        <p>
          This route is wired from the workflow map and ready for pixel-level design implementation.
        </p>
      </section>
    </main>
  );
}
