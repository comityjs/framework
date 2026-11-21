import type { Result } from "@comity/primitives/result";
import type { Instant } from "@comity/primitives/time";
import type { Money } from "@comity/pricing";

import type { PaymentError } from "../errors/payment.js";
import type { ReportedAmount } from "./payment-outcome.js";

/**
 * What a verified `other` notification concerns (ADR-037 §3, AMD-SIG). Identifies what to look up; never a state.
 *
 * An adapter uses the narrowest variant the delivery itself establishes and never guesses the kind.
 */
export type PaymentNotificationSubject =
  | {
      /** The delivery identifies a provider payment. */
      readonly kind: "payment";

      /** Provider payment identifier. */
      readonly paymentId: string;

      /** The application reference the provider echoed, copied as supplied: a correlation fallback only. */
      readonly reference?: string;
    }
  | {
      /** The delivery identifies a provider refund. */
      readonly kind: "refund";

      /** Provider refund identifier. */
      readonly refundId: string;

      /** The refunded payment, when the delivery states it. */
      readonly paymentId?: string;

      /** The application reference the provider echoed, copied as supplied: a correlation fallback only. */
      readonly reference?: string;
    }
  | {
      /** The delivery identifies a provider object of the binding that is a payment or a refund, without saying which. */
      readonly kind: "payment_or_refund";

      /** Provider identifier of that object. */
      readonly providerId: string;

      /** The application reference the provider echoed, copied as supplied: a correlation fallback only. */
      readonly reference?: string;
    };

/** Fields common to every {@link PaymentNotification}. */
interface NotificationBase {
  /** Binding identifier the delivery arrived on. */
  readonly provider: string;

  /**
   * Provider event identifier, present only when the provider's delivery carries one (ADR-037 §4 rule 5).
   * Never synthesized by an adapter. Identifies a provider event, never a payment, operation, refund or delivery.
   */
  readonly eventId?: string;

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

  /** What the event concerns, when the delivery identifies it; a lookup trigger with no authority. */
  readonly subject?: PaymentNotificationSubject;
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
 * Authenticity is established before any content is trusted, without any network call; events are classified through
 * the adapter's documented event mapping. One `Result` per delivery:
 * - success: authentic, with every event in delivery order. An unknown event type, a signal event, or an event that
 *   cannot be normalized into a state kind is `other`;
 * - `invalid_notification` cause `signature`: authenticity not positively established;
 * - `invalid_notification` cause `malformed`: authentic, but its event boundaries or types cannot be determined;
 * - `unrepresentable_success`: authentic, with a settled success whose identifiers are present and whose
 *   schema-declared financial data is absent or unusable; the delivery fails as a whole.
 *
 * No other reason is returned.
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
