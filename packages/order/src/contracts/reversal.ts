import type { Instant } from "@comity/primitives/time";
import type { Money } from "@comity/pricing";

/**
 * Kind of an order reversal fact.
 *
 * Version 1 supports refunds only (ADR-032 Amendment 4, D4-1). Credits and
 * adjustments are deferred and have no representation here.
 */
export type OrderReversalKind = "refund";

/**
 * Immutable, append-only historical fact about a confirmed refund of a captured
 * payment (ADR-032 Amendment 4).
 *
 * A reversal is a fact in its own collection: it is NOT a mutation of a payment
 * snapshot and NOT a payment status. Recording it changes neither the order
 * status nor the order total. The order records the fact only; it never
 * executes, initiates or confirms a refund.
 */
export interface OrderReversal {
  /**
   * Caller-supplied identity of the reversal; for a refund it equals the
   * application `RefundAttemptId`. It is the deduplication key. A plain string:
   * it is stored exactly as supplied, never trimmed or normalized.
   */
  readonly reversalId: string;

  /**
   * The reversal kind. Only `"refund"` exists in version 1; the aggregate also
   * rejects any other runtime value for a new reversal.
   */
  readonly kind: OrderReversalKind;

  /** The provider-confirmed refunded amount. Must be strictly positive. */
  readonly amount: Money;

  /** The reference of the captured payment fact being reversed (`OrderPaymentSnapshot.paymentId`). */
  readonly paymentId: string;

  /**
   * When the fact was recorded, supplied by the caller: the aggregate never
   * reads a clock for it. Excluded from idempotency content equality. The
   * application must supply a valid `Instant`; the aggregate additionally
   * rejects, on the append path only, a value that is not finite or whose
   * absolute value exceeds the ECMAScript date range (`8.64e15` ms).
   */
  readonly recordedAt: Instant;
}
