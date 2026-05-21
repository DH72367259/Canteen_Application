"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function TermsOfServicePage() {
  const router = useRouter();
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "2rem 1.25rem", fontFamily: "inherit" }}>
      <button onClick={() => router.back()} style={{ background: "none", border: "none", color: "var(--orange)", textDecoration: "none", fontSize: "0.875rem", cursor: "pointer", padding: 0 }}>← Back</button>
      <h1 style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>Terms of Service</h1>
      <p style={{ color: "var(--ink-3)", fontSize: "0.875rem", marginBottom: "2rem" }}>
        Last updated: {new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}
      </p>

      <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: "2rem" }}>
        <strong>📋 Quick Summary</strong>
        <ul style={{ marginTop: "0.5rem", marginBottom: 0 }}>
          <li>You must be a verified student or staff member of a registered institution to use this platform.</li>
          <li>Orders must be picked up during the selected slot — uncollected orders are non-refundable.</li>
          <li>Misuse of OTPs or accounts may result in permanent suspension.</li>
        </ul>
      </div>

      <section style={{ marginBottom: "2rem" }}>
        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing or using the NoQx platform (&quot;Platform&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;), you agree to be bound by these Terms of Service (&quot;Terms&quot;). If you do not agree to these Terms, please do not use the Platform.
        </p>
        <p>
          These Terms apply to all users of the Platform including students, faculty, canteen staff, administrators, and visitors.
        </p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>2. Eligibility</h2>
        <ul>
          <li>You must be a registered student or authorised staff member of an institution partnered with NoQx.</li>
          <li>You must be at least 13 years of age to create an account.</li>
          <li>You must provide accurate, current, and complete information during registration.</li>
          <li>One account per person. Creating multiple accounts to abuse offers or promotions is prohibited.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>3. Account Responsibilities</h2>
        <ul>
          <li>You are responsible for maintaining the confidentiality of your login credentials.</li>
          <li>You must immediately notify us of any unauthorised use of your account.</li>
          <li>We are not liable for any loss or damage arising from your failure to protect your account credentials.</li>
          <li>You are responsible for all activity that occurs under your account.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>4. Ordering &amp; Pickup</h2>
        <ul>
          <li><strong>Slot booking:</strong> Orders must be placed for a specific time slot. Once a slot is full, you cannot add to it.</li>
          <li><strong>OTP verification:</strong> A unique OTP is generated for each order. You must present this OTP to the canteen worker to collect your food. Do not share your OTP with anyone other than the assigned canteen worker.</li>
          <li><strong>Pickup deadline:</strong> Orders not collected within the assigned slot timeframe are forfeited and are non-refundable after preparation has begun.</li>
          <li><strong>Order accuracy:</strong> Please review your order carefully before placing it. Once preparation begins, modifications are not possible.</li>
          <li><strong>Food safety:</strong> We are not responsible for allergic reactions if you have not disclosed dietary requirements to the canteen.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>5. Payments</h2>
        <ul>
          <li>All prices are displayed in Indian Rupees (₹) and are inclusive of applicable taxes.</li>
          <li>Payments are processed securely through Razorpay. We do not store your card or UPI credentials.</li>
          <li>You may pay via UPI, debit/credit card, or net banking.</li>
          <li>A transaction is confirmed only upon successful payment. Do not close the app during payment.</li>
          <li>In case of a failed transaction where your account was debited, contact us within 7 days at the support email below.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>6. Prohibited Conduct</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Place fraudulent orders or use stolen payment credentials.</li>
          <li>Share your account or OTPs to allow others to collect orders on your behalf in violation of institution policy.</li>
          <li>Abuse promotions or referral codes by creating fake accounts.</li>
          <li>Reverse-engineer, scrape, or disrupt any part of the Platform.</li>
          <li>Upload or transmit any content that is harmful, abusive, defamatory, or illegal.</li>
          <li>Impersonate any person or entity including canteen staff or administrators.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>7. Cancellations &amp; Refunds</h2>
        <p>
          Please refer to our{" "}
          <Link href="/refund" style={{ color: "var(--orange)" }}>Cancellation &amp; Refund Policy</Link>{" "}
          for full details. In summary:
        </p>
        <ul>
          <li>Cancellations before preparation begins are eligible for a full refund.</li>
          <li>Once food preparation starts, cancellations are not accepted.</li>
          <li>Refunds are processed to the original payment method within 5–7 business days.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>8. Intellectual Property</h2>
        <p>
          All content on the Platform — including logos, text, graphics, interfaces, and software — is the property of NoQx or its licensors and is protected by applicable intellectual property laws. You may not reproduce, distribute, or create derivative works without our written permission.
        </p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>9. Disclaimer of Warranties</h2>
        <p>
          The Platform is provided on an &quot;as is&quot; and &quot;as available&quot; basis. We do not guarantee that the Platform will be error-free, uninterrupted, or free from viruses. We disclaim all warranties, express or implied, including merchantability, fitness for a particular purpose, and non-infringement.
        </p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>10. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, NoQx shall not be liable for any indirect, incidental, special, consequential, or punitive damages — including loss of data, revenue, or goodwill — arising from your use of or inability to use the Platform, even if we have been advised of the possibility of such damages.
        </p>
        <p>
          Our total liability to you for any claim arising out of or relating to these Terms or your use of the Platform shall not exceed the amount you paid for the specific order giving rise to the claim.
        </p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>11. Termination</h2>
        <p>
          We reserve the right to suspend or terminate your account at any time, with or without notice, if we determine that you have violated these Terms, abused the Platform, or engaged in fraudulent activity. Upon termination, your right to use the Platform ceases immediately.
        </p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>12. Changes to These Terms</h2>
        <p>
          We may update these Terms from time to time. If we make material changes, we will notify you via email or a prominent notice on the Platform at least 7 days before they take effect. Continued use of the Platform after the effective date constitutes your acceptance of the updated Terms.
        </p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>13. Governing Law</h2>
        <p>
          These Terms are governed by and construed in accordance with the laws of India. Any dispute arising out of or related to these Terms shall be subject to the exclusive jurisdiction of the courts in India.
        </p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>14. Contact Us</h2>
        <p>If you have any questions about these Terms, please contact us:</p>
        <ul>
          <li><strong>Email:</strong> support@canteen-application.com</li>
          <li><strong>Grievance Officer:</strong> Available via the Support section in the app</li>
          <li><strong>Response time:</strong> Within 2 business days</li>
        </ul>
      </section>

      <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "1.5rem", display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
        <Link href="/privacy" style={{ color: "var(--orange)", textDecoration: "none", fontSize: "0.875rem" }}>Privacy Policy</Link>
        <Link href="/refund" style={{ color: "var(--orange)", textDecoration: "none", fontSize: "0.875rem" }}>Refund Policy</Link>
        <Link href="/login" style={{ color: "var(--orange)", textDecoration: "none", fontSize: "0.875rem" }}>Back to Login</Link>
      </div>
    </div>
  );
}
