# GST Flag Audit — Where, Why, and What to Set for Launch

Audit date: 2026-05-21. Closes [[launch-readiness]] §1 "DISABLE_GST flag —
verify default behavior".

---

## Summary

Two env vars control whether 5% food GST is added to orders:

| Var | Where read | What it controls |
|---|---|---|
| `DISABLE_GST` | `app/api/orders/place/route.ts:278` (server) | Whether the order total INCLUDES the 5% GST charge |
| `NEXT_PUBLIC_DISABLE_GST` | `app/dashboard/order-status/page.tsx:330` (client) | Whether the order receipt SHOWS a GST line breakdown |

Both must be set to the same value (`true` or `false`) — otherwise the
receipt will lie about whether GST was charged.

**Default (env unset) → GST APPLIED.** Production safety: if you forget
to set anything, you charge GST. This is the safer default than the
opposite for a launching business.

---

## When to ship with GST ENABLED (env var = `false` or unset)

You MUST charge GST if any of:
- ✅ You have an active GSTIN (GST registration certificate)
- ✅ Your annual turnover is projected above ₹20 lakh (₹10 lakh for
  special-category states)
- ✅ Razorpay KYC mandates a GSTIN on your merchant profile

In that case set `DISABLE_GST=false` (or leave both env vars unset).

The order math then becomes:
```
subtotal       = sum(item.price × qty)
gst            = subtotal × 0.05      // 2.5% CGST + 2.5% SGST
extra_bin_fee  = (rupees from slot_control.extra_bin_fee_paise)
total          = subtotal + gst + extra_bin_fee
```

Razorpay charges the full `total`. The GST portion is remitted to the
GST department monthly via GSTR-3B filings.

---

## When to ship with GST DISABLED (env var = `true`)

You may legally ship without GST if ALL of:
- ✅ Annual turnover under ₹20 lakh (₹10 lakh for special-category states)
- ✅ You have NOT registered for GST (no GSTIN yet)
- ✅ Razorpay has NOT required a GSTIN in your KYC

This is the typical pre-launch / very-early-stage state.

Math then:
```
subtotal       = sum(item.price × qty)
extra_bin_fee  = (rupees from slot_control.extra_bin_fee_paise)
total          = subtotal + extra_bin_fee   // no GST line
```

---

## Current state on Railway

`.env.local` (used for local dev pointing at production Supabase) has
`DISABLE_GST=true`. **Railway production env vars** are NOT visible
from this audit — you must check directly:

1. Open https://railway.com → noqx project → production env → Variables
2. Look for `DISABLE_GST` and `NEXT_PUBLIC_DISABLE_GST`
3. Confirm both are set to the same value (or both absent)

Likely state given context: not set on Railway, which means **GST IS
currently being applied in production**. If the operator is not yet
GST-registered, this is wrong and could cause invoice disputes.

---

## How to flip it for launch

In Railway → production env → Variables:

```
DISABLE_GST=true            # or false
NEXT_PUBLIC_DISABLE_GST=true   # MUST match
```

Click Deploy after saving. Restart-triggered redeploy ~60 sec.

⚠️ Both vars must be set to the SAME value:
- Server (`DISABLE_GST=true`) computes total WITHOUT GST
- Client (`NEXT_PUBLIC_DISABLE_GST=false`) would show a GST line on
  the receipt that the server didn't actually charge
- Mismatch = customer sees GST on receipt, total is wrong, dispute

---

## Recommended launch action

**If you're not yet GST-registered:**
1. Set both env vars to `true` in Railway production
2. Verify by placing a ₹100 test order — receipt should show:
   - Items subtotal: ₹100.00
   - (no GST line)
   - Extra bin fee: ₹X.XX (if applicable)
   - Total: ₹100.00 + bin fee
3. Update launch_readiness §5 "GST registration" — note that GST is
   disabled until registration is complete

**Once GST registration arrives:**
1. Flip both env vars to `false` (or delete them — default behavior
   is GST enabled)
2. Update the FOOTER of /privacy + /refund + /contact to mention GSTIN
3. Place a ₹100 test order — receipt should show:
   - Items subtotal: ₹100.00
   - CGST (2.5%): ₹2.50
   - SGST (2.5%): ₹2.50
   - Total: ₹105.00
4. Update the static `platform_charges.gst_pct` row in Supabase if
   you're charging GST on the platform commission too (default is 18%)

---

## Related: GST on platform commission

Separate from order GST is the GST on the platform's commission fee
(the ~2% NoQx takes from each order). This is configured in the
`platform_charges` table:

```sql
SELECT charge_pct, flat_charge, gst_pct, extra_bin_fee_paise
FROM platform_charges;
```

Default seed:
- `charge_pct` = 2.00 (NoQx takes 2%)
- `flat_charge` = 0.00
- `gst_pct` = 18.00 (18% GST on the platform's commission)

This GST is what NoQx owes to the GST department on its own commission
revenue. It is independent of the DISABLE_GST flag (which only affects
the 5% food GST charged TO the student).

For pre-GST-registration launch: leave `gst_pct` at 18 in the DB but
note that NoQx itself can't actually charge platform commission until
it's GST-registered. The simplest pre-registration model is `charge_pct
= 0` (no platform fee) until you're set up.

---

## Verification checklist

- [ ] Railway production has `DISABLE_GST` set (or explicitly unset)
- [ ] Railway production has `NEXT_PUBLIC_DISABLE_GST` matching it
- [ ] Test order placed against production shows correct receipt math
- [ ] Razorpay test mode is OK with the GST setting (no merchant errors)
- [ ] launch_readiness §5 "GST registration confirmed; GST flag in the
      order route enabled" reflects the actual chosen value
