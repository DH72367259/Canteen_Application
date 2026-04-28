import Link from "next/link";

export default function RefundPolicyPage() {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "2rem 1.25rem", fontFamily: "inherit" }}>
      <Link href="/" style={{ color: "var(--orange)", textDecoration: "none", fontSize: "0.875rem" }}>← Back to Home</Link>
      <h1 style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>Cancellation &amp; Refund Policy</h1>
      <p style={{ color: "var(--ink-3)", fontSize: "0.875rem", marginBottom: "2rem" }}>
        Last updated: {new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}
        &nbsp;·&nbsp; NoQx Technologies, India
      </p>

      <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: "2rem" }}>
        <strong>⚡ Quick Summary</strong>
        <ul style={{ marginTop: "0.5rem", marginBottom: 0 }}>
          <li>Order cut-off: orders close <strong>one slot-duration before slot start</strong> (e.g. for a 1:00 PM slot with 15-min slots, ordering closes at 12:45 PM).</li>
          <li>Cancellation while status is <strong>Placed</strong> (not yet preparing) → full refund.</li>
          <li>Once preparation has started → no refund (food has been made for you).</li>
          <li>Canteen-side cancellation → full refund + Canteen Cash compensation.</li>
          <li>Duplicate / failed payments → full refund within 7 working days.</li>
          <li>NoQx Pro: 7-day cooling-off refund if you have not used Pro savings.</li>
        </ul>
      </div>

      <section style={{ marginBottom: "2rem" }}>
        <h2>1. How to Request a Cancellation or Refund</h2>
        <p>NoQx does <strong>not</strong> currently expose a self-service "Cancel Order" button — this is intentional, because the order moves into the canteen's prep queue within seconds and we want a real human to confirm it can still be pulled.</p>
        <ol>
          <li>Open the order from <strong>My Orders</strong>.</li>
          <li>Tap <strong>Raise a Concern</strong> on the order detail page.</li>
          <li>Pick a reason (cancellation, duplicate payment, OTP dispute, food quality, late preparation, etc.).</li>
          <li>Our support team responds within 4 working hours during canteen operating hours.</li>
        </ol>
        <p>Or write directly to <strong>support@noqx.app</strong> with your order ID and Razorpay payment ID (visible in the order receipt).</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>2. Cancellation Eligibility (User-Initiated)</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.75rem" }}>
          <thead>
            <tr style={{ background: "#f3f4f6" }}>
              <th style={{ padding: "0.6rem 0.75rem", textAlign: "left", borderBottom: "2px solid var(--border)" }}>Order status when you ask to cancel</th>
              <th style={{ padding: "0.6rem 0.75rem", textAlign: "left", borderBottom: "2px solid var(--border)" }}>Refund</th>
              <th style={{ padding: "0.6rem 0.75rem", textAlign: "left", borderBottom: "2px solid var(--border)" }}>Processing time</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>Placed (canteen has not yet pulled it)</td>
              <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)", color: "var(--green)", fontWeight: 600 }}>✅ Full refund</td>
              <td style={{ padding: "0.6rem 0.75rem", borderBottom: "1px solid var(--border)" }}>5–7 working days</td>
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
        <p style={{ fontSize: "0.85rem", color: "var(--ink-3)", marginTop: "0.75rem" }}>
          Refunds always go back to the original payment instrument by default. You may opt for Canteen Cash (instant credit) instead — see Section 4.
        </p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>3. Cancellation by the Canteen</h2>
        <p>If a canteen cancels your order (item run-out, equipment failure, sudden closure, etc.):</p>
        <ul>
          <li><strong>100% refund</strong> regardless of order status, processed automatically.</li>
          <li>Plus <strong>₹5–₹20 of Canteen Cash</strong> as inconvenience compensation, decided by the support team.</li>
          <li>You receive an in-app + push notification within seconds of the cancellation.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>4. Refund Methods &amp; Timelines</h2>
        <h3>4.1 Original payment method</h3>
        <ul>
          <li><strong>UPI:</strong> 5–7 working days, refunded to the same UPI ID.</li>
          <li><strong>Debit / Credit card:</strong> 7–10 working days (bank-dependent).</li>
          <li><strong>Net banking:</strong> 5–7 working days.</li>
          <li><strong>Wallet (Razorpay):</strong> within 24 hours.</li>
        </ul>
        <h3>4.2 Canteen Cash (instant)</h3>
        <ul>
          <li>Credited to your in-app wallet within seconds.</li>
          <li>Expires <strong>30 days</strong> from the credit date.</li>
          <li>Usable at any NoQx canteen on any future order.</li>
          <li>Cannot be transferred or withdrawn as cash.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>5. Order Cut-off &amp; Missed Slots</h2>
        <ul>
          <li>Each canteen sets a slot duration (10 / 15 / 20 minutes). Orders for a slot must arrive at least <em>one slot-duration before</em> the slot start. Example: a 1:00 PM slot with 15-minute slots closes for new orders at 12:45 PM.</li>
          <li>If you place an order after cut-off you will see a 400 error and no money is debited.</li>
          <li>If you do not collect within the canteen's grace period (default 15 minutes after slot end), the order is marked as not-collected and the food is disposed of. <strong>No refund</strong> applies — the food was prepared for you.</li>
          <li>Exception: if the canteen itself caused the delay, raise a concern within 24 hours; we review pickup-bin logs and refund if the canteen was at fault.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>6. Payment Errors &amp; Duplicate Charges</h2>
        <ul>
          <li>If money is debited but no order is created, Razorpay automatically reverses the charge within 3–5 working days.</li>
          <li>If the auto-reversal does not happen, raise a concern within 7 days with your Razorpay payment ID — we refund within 7 working days using the admin refund tool.</li>
          <li>Every payment is logged in our audit ledger (idempotent on payment ID), so duplicate webhooks cannot result in duplicate charges on our side.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>7. OTP Disputes</h2>
        <p>OTPs are 4-digit, single-use, and only valid for the assigned bin. If someone collected your order using your OTP without your consent:</p>
        <ul>
          <li>Raise a concern within 24 hours of the order time.</li>
          <li>We pull bin-pickup logs (worker ID + timestamp + OTP attempts) and resolve within 48 hours.</li>
          <li>Confirmed fraud → full refund or replacement order, plus a security review of the affected canteen.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>8. NoQx Pro Subscription Refunds</h2>
        <ul>
          <li><strong>7-day cooling-off:</strong> if you cancel within 7 days of buying NoQx Pro <em>and have not used the Pro savings on any order</em>, we refund the full ₹69.</li>
          <li>After 7 days <em>or</em> after using Pro savings even once, the subscription is non-refundable for that monthly cycle.</li>
          <li>Cancelling stops auto-renewal at the end of the current cycle. You keep all Pro benefits until the expiry date shown on your Pro page.</li>
          <li>If we suspend or terminate Pro for a reason that is our fault (extended outage, etc.), we issue a pro-rata refund automatically.</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>9. Force Majeure</h2>
        <p>NoQx is not liable for delays or cancellations caused by events beyond reasonable control (natural disasters, government orders, internet outages, payment-gateway downtime). In such cases we issue full refunds at the earliest reasonable date.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>10. Policy Updates</h2>
        <p>Material changes are announced via in-app notification and email at least 14 days before they take effect. Continued use of NoQx after that date constitutes acceptance of the updated policy.</p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2>11. Contact</h2>
        <p><strong>Support:</strong> support@noqx.app</p>
        <p><strong>Grievance Officer (DPDP Act compliance):</strong> grievance@noqx.app</p>
        <p><strong>Address:</strong> NoQx Technologies, Bengaluru, Karnataka, India</p>
        <p style={{ fontSize: "0.85rem", color: "var(--ink-3)" }}>We acknowledge refund requests within 4 working hours and resolve within 7 working days.</p>
      </section>

      <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", marginTop: "2rem", display: "flex", gap: "1.5rem", fontSize: "0.875rem" }}>
        <Link href="/privacy" style={{ color: "var(--orange)", textDecoration: "none" }}>Privacy Policy</Link>
        <Link href="/terms" style={{ color: "var(--orange)", textDecoration: "none" }}>Terms of Service</Link>
        <Link href="/" style={{ color: "var(--orange)", textDecoration: "none" }}>Home</Link>
      </div>
    </div>
  );
}
