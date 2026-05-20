/**
 * /cancellation-policy → permanent redirect to /refund.
 *
 * The Refund Policy page is actually titled "Cancellation & Refund Policy" and
 * covers both topics fully. Some external systems (Razorpay KYC, App/Play store
 * compliance forms) expect a distinct /cancellation-policy URL; this stub
 * satisfies that requirement without duplicating content.
 */
import { redirect } from "next/navigation";

export default function CancellationPolicyPage(): never {
  redirect("/refund");
}
