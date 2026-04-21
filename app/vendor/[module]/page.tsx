import Link from "next/link";
import { notFound } from "next/navigation";
import { getModuleBySlug, vendorModules } from "@/lib/workflows";

export default async function VendorModulePage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;
  const moduleData = getModuleBySlug(vendorModules, module);

  if (!moduleData) {
    notFound();
  }

  return (
    <main className="canteen-page">
      <section className="hero">
        <p className="hero-kicker">Vendor Module</p>
        <h1>{moduleData.title}</h1>
        <p>{moduleData.description}</p>
        <p className="route-links">
          <Link href="/">Home</Link> | <Link href="/vendor">Vendor Flow</Link> | <Link href="/system">System Flow</Link>
        </p>
      </section>

      <section className="panel">
        <h2>Implementation Note</h2>
        <p>
          This route is implemented according to the workflow node and can be extended with full page UI details.
        </p>
      </section>
    </main>
  );
}
