/**
 * Commission math: pure function, no side-effects — easiest thing to lock down.
 * Kept narrow because the heavy I/O (fetching platform_charges, idempotent
 * insert against razorpay_payment_id) is exercised end-to-end by Razorpay
 * itself in the dummy/sandbox environment.
 */
import { computeCommission } from "../lib/paymentLedger";

describe("payment ledger — commission math", () => {
  it("default tariff (2% + 0 flat + 18% GST on charge) for a ₹100 order", () => {
    const b = computeCommission(100, 2.0, 0, 18.0);
    expect(b.platform_earnings).toBe(2.0);    // 2% of 100
    expect(b.gst_on_charge).toBe(0.36);       // 18% of 2.00
    expect(b.net_to_canteen).toBe(97.64);     // 100 − 2.00 − 0.36
  });

  it("flat fee added on top of the percentage", () => {
    const b = computeCommission(200, 1.5, 5, 18.0);
    // 1.5% of 200 = 3, + flat 5 = 8 platform_earnings
    expect(b.platform_earnings).toBe(8);
    // 18% of 8 = 1.44
    expect(b.gst_on_charge).toBe(1.44);
    expect(b.net_to_canteen).toBe(190.56);
  });

  it("never returns a negative net_to_canteen even on tiny orders with big flat fees", () => {
    const b = computeCommission(1, 0, 50, 18.0);
    expect(b.net_to_canteen).toBe(0);
  });

  it("zero gross => zero everything (refund / wallet edge case)", () => {
    const b = computeCommission(0, 2.0, 0, 18.0);
    expect(b.platform_earnings).toBe(0);
    expect(b.gst_on_charge).toBe(0);
    expect(b.net_to_canteen).toBe(0);
  });

  it("rounds to 2 decimal places (no float dust in payouts)", () => {
    const b = computeCommission(99.99, 2.0, 0, 18.0);
    expect(Number.isInteger(b.platform_earnings * 100)).toBe(true);
    expect(Number.isInteger(b.gst_on_charge * 100)).toBe(true);
    expect(Number.isInteger(b.net_to_canteen * 100)).toBe(true);
  });
});
