import type { Result } from "@comity/primitives/result";
import type { Instant } from "@comity/primitives/time";
import type { Money } from "@comity/pricing";

import type { PaymentError } from "../errors/payment.js";
import type { ReportedAmount } from "./payment-outcome.js";

/** Input of one refund command (ADR-031 §3). */
export interface RefundRequest {
  /** Provider payment identifier returned by `initiate`. */
  readonly paymentId: string;

  /** Strictly positive, in the payment currency. A full refund is a refund of the whole remaining amount. */
  readonly amount: Money;

  /** Idempotency key of this refund invocation (ADR-030). One key per refund attempt. */
  readonly idempotencyKey: string;

  /** The application `RefundAttemptId`: the stable identity of this refund. */
  readonly reference: string;

  /** Opaque, informational; not part of request equivalence. */
  readonly reason?: string;
}

/** Fields common to every {@link RefundOutcome}. */
interface RefundOutcomeFields {
  /** Binding identifier. */
  readonly provider: string;

  /** The original payment, echoed. */
  readonly paymentId: string;

  /** Echoed `RefundAttemptId`, when the provider returns it. */
  readonly reference?: string;

  /** When the refund succeeded, if known. */
  readonly refundedAt?: Instant;
}

/** A confirmed refund: money has been returned. */
type SucceededRefundOutcome = RefundOutcomeFields & {
  /** Refund operation status. */
  readonly status: "succeeded";

  /** Provider refund identifier. */
  readonly refundId: string;

  /** Provider-confirmed refunded amount: mandatory and valid. */
  readonly amount: Money;
};

/** A refund accepted but not completed. Never confirmation. */
type PendingRefundOutcome = RefundOutcomeFields &
  ReportedAmount & {
    /** Refund operation status. */
    readonly status: "pending";

    /** Provider refund identifier: required to resolve the refund through `retrieveRefund`. */
    readonly refundId: string;
  };

/** A provider decline of the refund. */
type FailedRefundOutcome = RefundOutcomeFields &
  ReportedAmount & {
    /** Refund operation status. */
    readonly status: "failed";

    /** Provider refund identifier, when the provider created a refund object. */
    readonly refundId?: string;
  };

/** Outcome of a refund (ADR-031 §4). A refund status is an operation status, never a payment state. */
export type RefundOutcome = SucceededRefundOutcome | PendingRefundOutcome | FailedRefundOutcome;

/** Optional refund port (ADR-031 §1). Declared by the `refund` capability; `retrieveRefund` is mandatory in the port. */
export interface PaymentRefundProvider {
  /**
   * Requests one refund of a captured payment.
   *
   * @param request - The refund request.
   *
   * @returns The refund outcome, or a `PaymentError` (`internal_error` means the outcome is unknown).
   */
  refund(request: RefundRequest): Promise<Result<RefundOutcome, PaymentError>>;

  /**
   * Looks up the current state of a refund.
   *
   * @param refundId - The provider refund identifier.
   *
   * @returns The current refund outcome, or `null` when the refund is unknown to the provider.
   */
  retrieveRefund(refundId: string): Promise<Result<RefundOutcome | null, PaymentError>>;
}
