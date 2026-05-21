import Link from "next/link";

/**
 * Contact Us — required by Razorpay KYC. Provides real-human reach paths
 * so customers (and Razorpay disputes) can get hold of us. The email and
 * phone here are placeholders — the operator should replace them with
 * real values before Razorpay KYC review.
 */
export const metadata = {
  title: "Contact Us · NoQx",
  description: "Get in touch with the NoQx team — support, partnerships, refunds, and grievances.",
};

const SUPPORT_EMAIL    = "support@noqx.co.in";
const GRIEVANCE_EMAIL  = "grievance@noqx.co.in";
const SUPPORT_PHONE    = "+91 70199 86046";
const COMPANY_NAME     = "NoQx Technologies";
const COMPANY_ADDRESS  = "Bengaluru, Karnataka, India";

export default function ContactPage() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "2rem 1.25rem", fontFamily: "inherit" }}>
      <Link href="/" style={{ color: "var(--orange)", textDecoration: "none", fontSize: "0.875rem" }}>← Back to Home</Link>
      <h1 style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>Contact Us</h1>
      <p style={{ color: "var(--ink-3)", fontSize: "0.875rem", marginBottom: "2rem" }}>
        Last updated: {new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}
        &nbsp;·&nbsp; {COMPANY_NAME}, India
      </p>

      <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: "2rem" }}>
        <strong>📨 Reach us</strong>
        <ul style={{ marginTop: "0.5rem", marginBottom: 0 }}>
          <li>Email — <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "var(--orange)" }}>{SUPPORT_EMAIL}</a></li>
          <li>Phone — <a href={`tel:${SUPPORT_PHONE.replace(/\s/g, "")}`} style={{ color: "var(--orange)" }}>{SUPPORT_PHONE}</a> (Mon–Sat, 9am–7pm IST)</li>
          <li>Address — {COMPANY_ADDRESS}</li>
        </ul>
      </div>

      <section style={{ marginBottom: "2rem" }}>
        <h2>Customer support</h2>
        <p>If your order didn&apos;t arrive in the bin, your payment failed but money was debited, or you need help with a refund:</p>
        <ul>
          <li>Email <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "var(--orange)" }}>{SUPPORT_EMAIL}</a> — first response within 1 business day, resolution within 5 business days.</li>
          <li>Include your <strong>order ID</strong> (visible on the order status page) and a short description of the issue.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>Refund &amp; payment disputes</h2>
        <p>Most refunds are processed automatically by Razorpay and reach your bank within 5–7 business days. If your refund hasn&apos;t arrived after that window:</p>
        <ul>
          <li>Email <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "var(--orange)" }}>{SUPPORT_EMAIL}</a> with your order ID and the Razorpay payment ID (starts with <code>pay_</code>).</li>
          <li>For full refund rules, see our <Link href="/refund" style={{ color: "var(--orange)" }}>Refund Policy</Link>.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>Canteen partnerships</h2>
        <p>If you run a college canteen and want to onboard, email <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "var(--orange)" }}>{SUPPORT_EMAIL}</a> with the subject line <em>&ldquo;Canteen Partnership&rdquo;</em>. We&apos;ll send you onboarding documentation and schedule a call.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>Grievance officer (India IT Rules 2021)</h2>
        <p>As required under the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021:</p>
        <ul>
          <li><strong>Grievance Officer:</strong> Compliance Team, {COMPANY_NAME}</li>
          <li><strong>Email:</strong> <a href={`mailto:${GRIEVANCE_EMAIL}`} style={{ color: "var(--orange)" }}>{GRIEVANCE_EMAIL}</a></li>
          <li><strong>Address:</strong> {COMPANY_ADDRESS}</li>
          <li><strong>Response time:</strong> Acknowledged within 24 hours; resolved within 15 days.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>Security &amp; vulnerability reports</h2>
        <p>If you have discovered a security issue with the platform, please report it responsibly to <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: "var(--orange)" }}>{SUPPORT_EMAIL}</a> with subject <em>&ldquo;Security Report&rdquo;</em>. Please do not publicly disclose vulnerabilities before we have had a chance to fix them.</p>
      </section>

      <div style={{ marginTop: "3rem", paddingTop: "1.5rem", borderTop: "1px solid var(--border)", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <Link href="/terms" style={{ color: "var(--orange)", textDecoration: "none", fontSize: "0.875rem" }}>Terms of Service</Link>
        <Link href="/privacy" style={{ color: "var(--orange)", textDecoration: "none", fontSize: "0.875rem" }}>Privacy Policy</Link>
        <Link href="/refund" style={{ color: "var(--orange)", textDecoration: "none", fontSize: "0.875rem" }}>Refund Policy</Link>
        <Link href="/shipping" style={{ color: "var(--orange)", textDecoration: "none", fontSize: "0.875rem" }}>Shipping &amp; Delivery</Link>
      </div>
    </div>
  );
}
