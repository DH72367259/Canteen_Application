"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function PrivacyPolicyPage() {
  const router = useRouter();
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "2rem 1.25rem", fontFamily: "inherit" }}>
      <button onClick={() => router.back()} style={{ background: "none", border: "none", color: "var(--orange)", textDecoration: "none", fontSize: "0.875rem", cursor: "pointer", padding: 0 }}>← Back</button>
      <h1 style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>Privacy Policy</h1>
      <p style={{ color: "var(--ink-3)", fontSize: "0.875rem", marginBottom: "0.5rem" }}>
        Last updated: {new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}
      </p>
      <p style={{ color: "var(--ink-3)", fontSize: "0.875rem", marginBottom: "2rem" }}>
        This policy explains how <strong>NoQx</strong> (operated by NoQx Technologies, India)
        collects, uses, stores and protects your personal data. It is written to comply with the
        <em> Digital Personal Data Protection Act, 2023 (DPDP Act)</em> and the Information
        Technology (Reasonable Security Practices) Rules, 2011.
      </p>

      <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: "2rem" }}>
        <strong>🔒 At a glance</strong>
        <ul style={{ marginTop: "0.5rem", marginBottom: 0 }}>
          <li>We never sell or rent your data — period.</li>
          <li>Card / UPI details are handled by Razorpay; we never see them.</li>
          <li>Your IP address is never stored — we keep a one-way SHA-256 hash only.</li>
          <li>Only one active session per account (auto-logout elsewhere on new login).</li>
          <li>You can request deletion of your account at any time.</li>
        </ul>
      </div>

      <section style={{ marginBottom: "2rem" }}>
        <h2>1. Information We Collect</h2>
        <h3>1.1 You give us</h3>
        <ul>
          <li><strong>Account:</strong> name, email, phone number, college/canteen, password (stored hashed by Supabase Auth — never in plain text).</li>
          <li><strong>Order history:</strong> items, quantities, slot, OTP, bin assignment, status, total amount.</li>
          <li><strong>Support requests:</strong> any message or attachment you send via the in-app support page.</li>
        </ul>
        <h3>1.2 We collect automatically</h3>
        <ul>
          <li><strong>Device info:</strong> user-agent string truncated to 120 chars (no fingerprinting).</li>
          <li><strong>IP address:</strong> never stored raw — only a 16-char SHA-256 hash, used to detect fraud + concurrent-session abuse.</li>
          <li><strong>Push device token:</strong> if you allow notifications, we store the FCM/APNs token so we can ping your phone when an order is ready. Tokens are deleted within 30 days of inactivity.</li>
        </ul>
        <h3>1.3 From payment partners</h3>
        <ul>
          <li><strong>Razorpay:</strong> we receive a <code>payment_id</code>, an order ID, the captured amount, and a status flag. We never receive card numbers, CVVs, UPI PINs or bank credentials.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>2. How We Use Your Information</h2>
        <ul>
          <li>Process orders, generate pickup OTPs, and assign bins.</li>
          <li>Send transactional notifications (order placed / preparing / ready / collected) via in-app push, SMS or WhatsApp.</li>
          <li>Calculate NoQx Pro savings on your behalf.</li>
          <li>Detect duplicate / fraudulent payments via the audit ledger.</li>
          <li>Help our support team investigate disputes (only the order in question is opened).</li>
          <li>Anonymous, aggregated analytics to improve menu placement and slot capacity.</li>
        </ul>
        <p>We will <strong>never</strong> use your data for AI model training, third-party advertising, or behavioural profiling without your explicit consent.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>3. Who We Share Your Data With (Data Processors)</h2>
        <p>Per Sec. 8 of the DPDP Act, here is the full list of processors that can technically access your data:</p>
        <ul>
          <li><strong>Supabase Inc.</strong> — Postgres database + authentication. Hosted on AWS Mumbai.</li>
          <li><strong>Razorpay Software Pvt. Ltd.</strong> — payment gateway and refund processing.</li>
          <li><strong>Twilio Inc.</strong> — SMS / WhatsApp OTP delivery.</li>
          <li><strong>Firebase Cloud Messaging / Apple Push Notification service</strong> — push notification delivery (token only, no payload contents persisted).</li>
          <li><strong>Railway Corp.</strong> — application hosting (no data stored at rest).</li>
          <li><strong>Canteen operators</strong> — receive your name, order items, slot, bin assignment and OTP only. They cannot access your payment details, phone number, or order history with other canteens.</li>
          <li><strong>Law-enforcement agencies</strong> — only on receipt of a legally valid summons under Indian law.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>4. Data Security Measures</h2>
        <ul>
          <li>TLS 1.3 in transit; AES-256 at rest (managed by Supabase).</li>
          <li>HSTS preload, CSP, X-Frame-Options, Permissions-Policy headers on every response.</li>
          <li>Row-Level-Security policies prevent cross-tenant reads (a canteen can never see another canteen's orders).</li>
          <li>HMAC-SHA256 signature verification on every Razorpay webhook with constant-time comparison.</li>
          <li>Per-user and per-IP rate limits on order placement, top-ups and payment-order creation.</li>
          <li>Idempotent payment ledger — duplicate webhooks cannot double-credit your account.</li>
          <li>Server-side recalculation of every order total — client-supplied prices are ignored.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>5. NoQx Pro Subscription Data</h2>
        <p>If you purchase NoQx Pro:</p>
        <ul>
          <li>We store: subscription start date, expiry date, payment ID, amount paid, and your derived savings (orders since start × ₹4).</li>
          <li>Your Pro status is visible only to you. Canteens see only that you are a Pro member at order time, not your billing history.</li>
          <li>Cancelling Pro stops auto-renewal; we retain the subscription record for 3 years for accounting (Companies Act).</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>6. Data Retention</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.75rem" }}>
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={{ padding: "0.6rem 0.75rem", textAlign: "left", borderBottom: "2px solid var(--border)" }}>Data type</th>
              <th style={{ padding: "0.6rem 0.75rem", textAlign: "left", borderBottom: "2px solid var(--border)" }}>Retention</th>
            </tr>
          </thead>
          <tbody>
            <tr><td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>Account profile</td><td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>Until you delete your account</td></tr>
            <tr><td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>Orders + payment ledger</td><td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>3 years (Companies Act / GST)</td></tr>
            <tr><td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>Push device tokens</td><td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>30 days after last use</td></tr>
            <tr><td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>SHA-256 IP hash</td><td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>90 days, then purged</td></tr>
            <tr><td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>Support tickets</td><td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>2 years</td></tr>
          </tbody>
        </table>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>7. Your Rights under the DPDP Act</h2>
        <ul>
          <li><strong>Right to access:</strong> request a downloadable copy of your data via the Profile page.</li>
          <li><strong>Right to correction:</strong> edit your profile or write to us for changes you cannot make in-app.</li>
          <li><strong>Right to erasure:</strong> request deletion via Profile → Delete Account. Order/payment records that we are legally required to retain will be anonymised after the legal period.</li>
          <li><strong>Right to grievance redressal:</strong> contact our Grievance Officer (below). We respond within 7 days as required by Section 14 of the DPDP Act.</li>
          <li><strong>Right to nominate:</strong> you may nominate another individual to exercise these rights on your behalf in the event of death or incapacity.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>8. Cookies & Local Storage</h2>
        <ul>
          <li>One Supabase auth cookie (HttpOnly, Secure, SameSite=Lax) to keep you logged in. This is <strong>strictly necessary</strong> for the service to function and is exempt from consent requirements under the DPDP Act and global cookie regulations.</li>
          <li>Local-storage entries: <code>noqx_pro_active</code>, <code>noqx_pro_expires</code> (fast-path Pro indicator), and <code>vendor_slots_configured</code> (vendor onboarding flag). All first-party, can be cleared from your browser settings without affecting your account.</li>
          <li>No third-party analytics cookies. No advertising cookies. No tracking pixels. Ever.</li>
          <li>Because we use only strictly-necessary first-party cookies and no trackers, we do <strong>not</strong> display a cookie consent banner — there is nothing non-essential to consent to.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>9. Children&apos;s Privacy</h2>
        <p>Our service is intended for users aged 13 and above. If you believe a child under 13 has created an account, contact us — we will delete it within 7 days.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>10. Changes to This Policy</h2>
        <p>Material changes will be announced via in-app notification and email at least 14 days before they take effect. Continued use of NoQx after that date constitutes acceptance.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>11. Grievance Officer & Contact</h2>
        <p>In compliance with Sec. 10 of the DPDP Act and the IT Rules 2011:</p>
        <p><strong>Grievance Officer:</strong> Operations Lead, NoQx</p>
        <p><strong>Privacy &amp; data requests:</strong> privacy@noqx.app</p>
        <p><strong>General support:</strong> support@noqx.app</p>
        <p><strong>Address:</strong> NoQx Technologies, Bengaluru, Karnataka, India</p>
        <p style={{ fontSize: "0.85rem", color: "var(--ink-3)" }}>We acknowledge every privacy request within 48 hours and respond fully within 7 working days.</p>
      </section>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", marginTop: "2rem", display: "flex", gap: "1.5rem", fontSize: "0.875rem" }}>
        <Link href="/terms" style={{ color: "var(--orange)", textDecoration: "none" }}>Terms of Service</Link>
        <Link href="/refund" style={{ color: "var(--orange)", textDecoration: "none" }}>Refund Policy</Link>
        <Link href="/" style={{ color: "var(--orange)", textDecoration: "none" }}>Home</Link>
      </div>
    </div>
  );
}
