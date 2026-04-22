import Link from "next/link";

export default function PrivacyPolicyPage() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "2rem 1.25rem", fontFamily: "inherit" }}>
      <Link href="/" style={{ color: "var(--orange)", textDecoration: "none", fontSize: "0.875rem" }}>← Back to Home</Link>
      <h1 style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>Privacy Policy</h1>
      <p style={{ color: "var(--ink-3)", fontSize: "0.875rem", marginBottom: "2rem" }}>Last updated: {new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}</p>

      <section style={{ marginBottom: "2rem" }}>
        <h2>1. Information We Collect</h2>
        <p>We collect information you provide directly to us, including:</p>
        <ul>
          <li><strong>Account information:</strong> Name, email address, phone number, and password when you create an account.</li>
          <li><strong>Order information:</strong> Food items ordered, pickup slot selections, payment details, and order history.</li>
          <li><strong>Device information:</strong> Browser type, operating system, and IP address for security and fraud prevention.</li>
          <li><strong>Usage data:</strong> Pages visited, features used, and time spent on the platform to improve our services.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>2. How We Use Your Information</h2>
        <ul>
          <li>Process and fulfill your food orders and send order confirmations.</li>
          <li>Generate and verify OTPs for secure pickup authentication.</li>
          <li>Calculate and credit NoQx Cash (reward points) to your wallet.</li>
          <li>Send transactional emails including order updates, slot reminders, and OTP codes.</li>
          <li>Send promotional emails about offers, discounts, and festival specials — you may opt out at any time.</li>
          <li>Improve our services, troubleshoot issues, and prevent fraud.</li>
          <li>Comply with legal obligations.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>3. Information Sharing</h2>
        <p>We do not sell, trade, or rent your personal information to third parties. We may share your data with:</p>
        <ul>
          <li><strong>Canteen operators:</strong> Your name, order details, and OTP are shared with the canteen you order from for fulfillment purposes only.</li>
          <li><strong>Payment processors:</strong> PhonePe processes payments on our behalf. We share only the information necessary to complete your transaction. PhonePe&apos;s privacy policy applies to payment data.</li>
          <li><strong>Service providers:</strong> Supabase (database and authentication) and email service providers who process data under strict confidentiality agreements.</li>
          <li><strong>Legal requirements:</strong> If required by law or to protect rights, property, or safety.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>4. Data Security</h2>
        <p>We implement industry-standard security measures including:</p>
        <ul>
          <li>SSL/TLS encryption for all data in transit.</li>
          <li>Supabase&apos;s enterprise-grade database security with row-level security policies.</li>
          <li>OTP-based pickup verification to prevent unauthorized order collection.</li>
          <li>Role-based access controls — canteen staff can only access orders for their canteen.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>5. NoQx Cash (Reward Points)</h2>
        <p>NoQx Cash earned through orders or promotions:</p>
        <ul>
          <li>Expires 7 days from the date of earning.</li>
          <li>Cannot be transferred, withdrawn as cash, or combined with external discounts.</li>
          <li>Balances are visible in your profile and wallet page at all times.</li>
          <li>Expiring balances are shown prominently — it is your responsibility to use them before expiry.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>6. Cookies</h2>
        <p>We use cookies and similar technologies to:</p>
        <ul>
          <li>Maintain your authentication session securely.</li>
          <li>Remember your canteen and meal preferences.</li>
          <li>Analyse usage patterns to improve the platform.</li>
        </ul>
        <p>You may disable cookies in your browser settings, though this may affect functionality.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>7. Your Rights</h2>
        <ul>
          <li><strong>Access:</strong> Request a copy of personal data we hold about you.</li>
          <li><strong>Correction:</strong> Update inaccurate information via your Profile page.</li>
          <li><strong>Deletion:</strong> Request deletion of your account and associated data. Note that order history may be retained for accounting and dispute resolution for up to 3 years.</li>
          <li><strong>Opt-out:</strong> Unsubscribe from promotional emails at any time via the unsubscribe link in emails.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>8. Children&apos;s Privacy</h2>
        <p>Our service is designed for campus communities including students. We do not knowingly collect personal information from children under 13 years of age. If you believe we have inadvertently collected such information, please contact us to have it removed.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>9. Changes to This Policy</h2>
        <p>We may update this Privacy Policy periodically. We will notify users of material changes via email or a prominent notice on the platform. Continued use of the service after changes constitutes acceptance of the updated policy.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>10. Contact Us</h2>
        <p>For privacy-related questions or to exercise your rights, contact us at:</p>
        <p><strong>Email:</strong> privacy@noqx.in</p>
        <p><strong>Address:</strong> NoQx, Bengaluru, Karnataka, India</p>
      </section>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", marginTop: "2rem", display: "flex", gap: "1.5rem", fontSize: "0.875rem" }}>
        <Link href="/terms" style={{ color: "var(--orange)", textDecoration: "none" }}>Terms of Service</Link>
        <Link href="/refund" style={{ color: "var(--orange)", textDecoration: "none" }}>Refund Policy</Link>
        <Link href="/" style={{ color: "var(--orange)", textDecoration: "none" }}>Home</Link>
      </div>
    </div>
  );
}
