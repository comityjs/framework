import type { Result } from "@comity/primitives/result";
import type { Instant } from "@comity/primitives/time";
import type { Money } from "@comity/pricing";

import type { PaymentError } from "../errors/payment.js";
import type { ReportedAmount } from "./payment-outcome.js";

/** Fields common to every {@link PaymentNotification}. */
interface NotificationBase {
  /** Binding identifier the delivery arrived on. */
  readonly provider: string;

  /** Provider event identifier. Identifies a delivery event, never a payment, operation or refund. */
  readonly eventId: string;

  /** Informational only: ordering is never derived from timestamps. */
  readonly occurredAt?: Instant;
}

/** A settled successful payment event, with a provider-confirmed amount. */
type SettledPaymentNotification = NotificationBase & {
  /** Notification kind. */
  readonly kind: "payment";

  /** Provider payment identifier. */
  readonly paymentId: string;

  /** Echoed `PaymentAttemptId`, when supplied. */
  readonly reference?: string;

  /** Settled success state. */
  readonly state: "authorized" | "captured";

  /** Provider-confirmed amount. */
  readonly amount: Money;
};

/** A confirmed payment failure or cancellation event. */
type FailedPaymentNotification = NotificationBase &
  ReportedAmount & {
    /** Notification kind. */
    readonly kind: "payment";

    /** Provider payment identifier. */
    readonly paymentId: string;

    /** Echoed `PaymentAttemptId`, when supplied. */
    readonly reference?: string;

    /** Confirmed failure state. */
    readonly state: "failed" | "cancelled";
  };

/** A succeeded refund event, with a provider-confirmed amount. */
type SucceededRefundNotification = NotificationBase & {
  /** Notification kind. */
  readonly kind: "refund";

  /** The refunded payment. */
  readonly paymentId: string;

  /** Provider refund identifier. */
  readonly refundId: string;

  /** Echoed `RefundAttemptId`, when supplied. */
  readonly reference?: string;

  /** Refund operation status. */
  readonly status: "succeeded";

  /** Provider-confirmed refunded amount. */
  readonly amount: Money;
};

/** A pending or failed refund event. */
type UnsettledRefundNotification = NotificationBase &
  ReportedAmount & {
    /** Notification kind. */
    readonly kind: "refund";

    /** The refunded payment. */
    readonly paymentId: string;

    /** Provider refund identifier. */
    readonly refundId: string;

    /** Echoed `RefundAttemptId`, when supplied. */
    readonly reference?: string;

    /** Refund operation status. */
    readonly status: "pending" | "failed";
  };

/** Completion of a capture or cancel operation. Carries no amount. */
type OperationNotification = NotificationBase & {
  /** Notification kind. */
  readonly kind: "operation";

  /** Operation kind. */
  readonly operation: "capture" | "cancel";

  /** The payment the operation acts on. */
  readonly paymentId: string;

  /** Provider operation identifier; required by rule C-10 and verified by adapter conformance. */
  readonly operationId: string;

  /** Final operation status. */
  readonly status: "succeeded" | "failed";
};

/** Any other provider event (disputes, non-terminal payment events, ...). */
type OtherNotification = NotificationBase & {
  /** Notification kind. */
  readonly kind: "other";

  /** The provider's own event type. */
  readonly providerEventType: string;
};

/**
 * Normalized, already verified provider notification (ADR-037 §3, §7).
 *
 * Verification happens before this type exists. A verified notification is authoritative that the transition it
 * reports occurred, not that it is the current state.
 */
export type PaymentNotification =
  | SettledPaymentNotification
  | FailedPaymentNotification
  | SucceededRefundNotification
  | UnsettledRefundNotification
  | OperationNotification
  | OtherNotification;

/** A raw provider delivery, passed through unchanged by the application's HTTP layer. */
export interface PaymentNotificationDelivery {
  /** The raw request body: signatures cover raw bytes. */
  readonly body: Uint8Array;

  /** The raw request headers. */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Verifies a raw provider delivery and translates it into normalized notifications (ADR-037 §7).
 *
 * Signature verification, secrets and parsing belong to the adapter. One `Result` per delivery: a delivery that
 * fails authenticity is `invalid_notification` (cause `signature`), an unparseable one `invalid_notification`
 * (cause `malformed`).
 */
export interface PaymentNotificationVerifier {
  /**
   * Verifies and normalizes one delivery.
   *
   * @param input - The raw delivery.
   *
   * @returns The normalized notifications of the delivery, or a `PaymentError`.
   */
  verify(
    input: PaymentNotificationDelivery
  ): Promise<Result<ReadonlyArray<PaymentNotification>, PaymentError>>;
}
