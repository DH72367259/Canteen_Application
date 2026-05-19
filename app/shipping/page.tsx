import Link from "next/link";

/**
 * Shipping & Delivery Policy — required by Razorpay KYC even though we
 * don't ship anything. Our "delivery" model is in-canteen bin pickup, so
 * this page exists to (a) satisfy the KYC reviewer's checklist and
 * (b) make our actual fulfilment model unambiguous to users.
 */
export const metadata = {
  title: "Shipping & Delivery Policy · Canteen-Application",
  description: "How orders placed on Canteen-Application are fulfilled — no shipping; orders are picked up at the canteen counter.",
};

export default function ShippingPolicyPage() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "2rem 1.25rem", fontFamily: "inherit" }}>
      <Link href="/" style={{ color: "var(--orange)", textDecoration: "none", fontSize: "0.875rem" }}>← Back to Home</Link>
      <h1 style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>Shipping &amp; Delivery Policy</h1>
      <p style={{ color: "var(--ink-3)", fontSize: "0.875rem", marginBottom: "2rem" }}>
        Last updated: {new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}
        &nbsp;·&nbsp; NoQx Technologies, India
      </p>

      <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: "2rem" }}>
        <strong>📦 Quick Summary</strong>
        <ul style={{ marginTop: "0.5rem", marginBottom: 0 }}>
          <li><strong>No shipping involved.</strong> Canteen-Application is an in-canteen pickup service.</li>
          <li>Orders are prepared by the canteen and placed in a numbered pickup bin during your chosen slot.</li>
          <li>You collect your order yourself by sharing your OTP / QR code at the canteen.</li>
          <li>No courier, no delivery person, no shipping fee.</li>
        </ul>
      </div>

      <section style={{ marginBottom: "2rem" }}>
        <h2>1. How fulfilment works</h2>
        <p>Canteen-Application is a pre-order and pickup platform for college canteens. We do <strong>not</strong> ship or deliver food to your address. Every order follows the same path:</p>
        <ol>
          <li>You browse a canteen&apos;s menu in the app and add items to your cart.</li>
          <li>You pick a pickup time slot (typically a 15-minute window).</li>
          <li>You pay through Razorpay using UPI, card, netbanking, or wallet.</li>
          <li>The canteen prepares the food during your chosen slot.</li>
          <li>The canteen places your order in a numbered pickup bin and the app shows you the bin number plus an OTP / QR code.</li>
          <li>You walk to the canteen, share the OTP / QR code with staff, and collect your order from the bin.</li>
        </ol>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>2. Pickup window</h2>
        <p>Orders must be collected during the slot you selected at checkout. If you fail to collect during the slot, the order moves to a <em>late pickup counter</em> and is held by the canteen for a limited grace period (usually until canteen closing time on the same day).</p>
        <p>Food that is not collected within the grace period is treated as unclaimed and may be discarded by the canteen at their discretion. Such orders are <strong>not refundable</strong> because the food was made for you.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>3. Fulfilment timing</h2>
        <ul>
          <li><strong>Slot ordering window:</strong> Orders for a slot close one slot-duration before the slot starts (e.g. for a 1:00 PM slot with a 15-minute duration, ordering closes at 12:45 PM).</li>
          <li><strong>Preparation:</strong> The canteen begins preparing during your slot. Most orders are ready within the same slot.</li>
          <li><strong>Ready notification:</strong> You receive a notification (and the app updates in real-time) the moment your food is placed in a pickup bin.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>4. Geographic coverage</h2>
        <p>Canteen-Application is available only at participating college canteens within India. The platform does not deliver to home addresses, hostels, or any location off-campus. Each canteen serves only the campus or building it is physically located in.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>5. Shipping charges</h2>
        <p>There are <strong>no shipping charges</strong> because no shipping occurs. The bill on the checkout page consists of:</p>
        <ul>
          <li>Item prices set by the canteen</li>
          <li>Applicable taxes (CGST + SGST)</li>
          <li>An extra-bin fee where an order needs more than one pickup bin (starting from the 2nd bin onward)</li>
          <li>An optional convenience fee, waived if you are on NoQx Pro</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>6. Cancellations &amp; refunds</h2>
        <p>For order cancellation and refund rules, see our <Link href="/refund" style={{ color: "var(--orange)" }}>Refund Policy</Link>. In short: you can cancel within 45 seconds of placing an order for a full automatic refund; after that the canteen has accepted the order and refunds depend on whether preparation has begun.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>7. Contact</h2>
        <p>If your order was not in the bin during your slot, or you have any other fulfilment issue, please reach out via our <Link href="/contact" style={{ color: "var(--orange)" }}>Contact page</Link>. We will coordinate with the canteen on your behalf.</p>
      </section>

      <div style={{ marginTop: "3rem", paddingTop: "1.5rem", borderTop: "1px solid var(--border)", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <Link href="/terms" style={{ color: "var(--orange)", textDecoration: "none", fontSize: "0.875rem" }}>Terms of Service</Link>
        <Link href="/privacy" style={{ color: "var(--orange)", textDecoration: "none", fontSize: "0.875rem" }}>Privacy Policy</Link>
        <Link href="/refund" style={{ color: "var(--orange)", textDecoration: "none", fontSize: "0.875rem" }}>Refund Policy</Link>
        <Link href="/contact" style={{ color: "var(--orange)", textDecoration: "none", fontSize: "0.875rem" }}>Contact Us</Link>
      </div>
    </div>
  );
}
