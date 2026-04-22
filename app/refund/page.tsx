import Link from "next/link";

export default function RefundPolicyPage() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "2rem 1.25rem", fontFamily: "inherit" }}>
      <Link href="/" style={{ color: "var(--orange)", textDecoration: "none", fontSize: "0.875rem" }}>← Back to Home</Link>
      <h1 style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>Cancellation &amp; Refund Policy</h1>
      <p style={{ color: "var(--ink-3)", fontSize: "0.875rem", marginBottom: "2rem" }}>Last updated: {new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}</p>

      <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: "2rem" }}>
        <strong>⚡ Quick Summary</strong>
        <ul style={{ marginTop: "0.5rem", marginBottom: 0 }}>
          <li>Cancel <strong>before preparation begins</strong> → full refund</li>
          <li>Cancel after preparation → no refund</li>
          <li>Payment errors (duplicate charges) → full refund within 7 days</li>
          <li>Refunds go to original payment method or NoQx Cash wallet</li>
        </ul>
      </div>

      <section style={{ marginBottom: "2rem" }}>
        <h2>1. Order Cancellation</h2>
        <h3>1.1 Cancellation by User</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.75rem" }}>
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={{ padding: "0.6rem 0.75rem", textAlign: "left", borderBottom: "2px solid var(--border)" }}>Order Status at Cancellation</th>
              <th style={{ padding: "0.6rem 0.75rem", textAlign: "left", borderBottom: "2px solid var(--border)" }}>Refund Eligibility</th>
              <th style={{ padding: "0.6rem 0.75rem", textAlign: "left", borderBottom: "2px solid var(--border)" }}>Processing Time</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>Placed (awaiting confirmation)</td>
              <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)", color: "var(--green)", fontWeight: 600 }}>✅ Full refund</td>
              <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>5–7 business days</td>
            </tr>
            <tr>
              <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>Confirmed (not yet preparing)</td>
              <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)", color: "var(--green)", fontWeight: 600 }}>✅ Full refund</td>
              <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>5–7 business days</td>
            </tr>
            <tr>
              <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>Preparing</td>
              <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)", color: "var(--red)", fontWeight: 600 }}>❌ No refund</td>
              <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>—</td>
            </tr>
            <tr>
              <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>Ready / Placed in bin / Collected</td>
              <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)", color: "var(--red)", fontWeight: 600 }}>❌ No refund</td>
              <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>—</td>
            </tr>
          </tbody>
        </table>

        <h3 style={{ marginTop: "1.25rem" }}>1.2 Cancellation by Canteen</h3>
        <p>If a canteen cancels your order (e.g. item unavailable, canteen closure, equipment failure):</p>
        <ul>
          <li>You will receive a <strong>full refund</strong> regardless of order status.</li>
          <li>You will also receive <strong>NoQx Cash compensation</strong> (₹5–₹20 depending on inconvenience level).</li>
          <li>You will be notified immediately via app notification and SMS.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>2. Refund Methods</h2>
        <h3>2.1 Original Payment Method</h3>
        <ul>
          <li><strong>UPI payments:</strong> Refunded to the source UPI ID within 5–7 business days.</li>
          <li><strong>Debit/Credit Card:</strong> Refunded to the card within 7–10 business days (depending on your bank).</li>
          <li><strong>Net Banking:</strong> Refunded to your bank account within 5–7 business days.</li>
          <li><strong>PhonePe Wallet:</strong> Refunded to PhonePe wallet within 24 hours.</li>
        </ul>
        <h3>2.2 NoQx Cash Wallet</h3>
        <p>You may opt to receive refunds as NoQx Cash instead of reverting to original payment method. NoQx Cash:</p>
        <ul>
          <li>Is credited instantly to your wallet.</li>
          <li>Expires 7 days from the date of credit.</li>
          <li>Can be used on any future order at any NoQx-enabled canteen.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>3. Non-Pickup & Grace Period</h2>
        <p>If you do not collect your order within the grace period after your pickup slot:</p>
        <ul>
          <li>The canteen will attempt to hold your order for an additional 15 minutes.</li>
          <li>After the grace period, the order may be disposed of by the canteen.</li>
          <li><strong>No refund is applicable</strong> for orders not collected during the grace period, as the food has been freshly prepared for you.</li>
          <li>Exception: If you raise a dispute with valid reasons (e.g. emergency, canteen delay), the case will be reviewed and resolved within 48 hours.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>4. Payment Errors & Duplicate Charges</h2>
        <p>If you are charged incorrectly (duplicate payment, charge without order confirmation):</p>
        <ul>
          <li>Raise a dispute within 48 hours via the Support page.</li>
          <li>We will investigate and process a full refund within 7 business days.</li>
          <li>In case of PhonePe payment failures where money is deducted but order is not confirmed — the amount is automatically reversed within 3–5 business days by PhonePe. If not, contact us.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>5. OTP Disputes</h2>
        <p>If someone else collected your order using your OTP without your knowledge:</p>
        <ul>
          <li>Report immediately via the Support page or the dispute option on the order page.</li>
          <li>We take OTP fraud seriously. The case will be investigated using logs and OTP verification records.</li>
          <li>If fraud is confirmed, a full refund or replacement order will be provided.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>6. How to Request a Refund</h2>
        <ol>
          <li>Go to <strong>My Orders</strong> in the app.</li>
          <li>Tap on the order and select <strong>Cancel Order</strong> or <strong>Raise Dispute</strong>.</li>
          <li>Select the reason for cancellation/refund.</li>
          <li>You will receive a confirmation notification and email within 1 hour.</li>
          <li>Refund will be processed as per the timelines above.</li>
        </ol>
        <p>Alternatively, email us at: <strong>support@noqx.in</strong></p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>7. Policy Updates</h2>
        <p>This policy may be updated to reflect changes in operations or applicable law. Users will be notified of material changes via email. Continued use of the service constitutes acceptance of the updated policy.</p>
      </section>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", marginTop: "2rem", display: "flex", gap: "1.5rem", fontSize: "0.875rem" }}>
        <Link href="/privacy" style={{ color: "var(--orange)", textDecoration: "none" }}>Privacy Policy</Link>
        <Link href="/terms" style={{ color: "var(--orange)", textDecoration: "none" }}>Terms of Service</Link>
        <Link href="/" style={{ color: "var(--orange)", textDecoration: "none" }}>Home</Link>
      </div>
    </div>
  );
}
