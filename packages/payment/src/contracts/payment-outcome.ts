import type { Instant } from "@comity/primitives/time";
import type { Money } from "@comity/pricing";

/**
 * Payment status recorded as a commercial fact.
 *
 * Mirrors {@link OrderPaymentStatus} from {@link @comity/order} to ensure
 * mechanical mapping between payment outcomes and order snapshots. Unchanged by
 * ADR-037: `pending` and `requires_action` are payment states, never Order facts.
 */
export type PaymentStatus = "authorized" | "captured" | "failed" | "cancelled";

/**
 * Provider-side state of one payment at the moment it was observed (ADR-037 §1).
 *
 * Distinct from {@link OperationStatus} and from the application's attempt resolution.
 */
export type PaymentState = PaymentStatus | "pending" | "requires_action";

/**
 * Status of one command (capture, cancel, refund) against a payment (ADR-037 §1).
 *
 * Not a payment state: `pending` here means the command was accepted but has not completed.
 */
export type OperationStatus = "pending" | "succeeded" | "failed";

/** Customer action required to continue a payment. Closed union (ADR-037 §3). */
export interface PaymentAction {
  /** Action kind. v1 supports only a redirect. */
  readonly kind: "redirect";

  /** Where the customer must be sent. */
  readonly url: string;
}

/**
 * What the provider reported about an amount (ADR-037 §3, §8b, OD-F9).
 *
 * Either a valid `amount`, or none supplied (no amount, no flag), or supplied but unusable
 * (`providerAmountUnusable: true`). Contradictory combinations cannot be constructed. The requested
 * amount is never echoed into an outcome.
 */
export type ReportedAmount =
  | {
      /** A valid amount supplied by the provider. */
      readonly amount: Money;

      /** Never present together with an amount. */
      readonly providerAmountUnusable?: never;
    }
  | {
      /** Absent: the provider supplied none, or supplied one that is unusable. */
      readonly amount?: never;

      /** `true` only when the provider supplied an amount that cannot be represented or validated. */
      readonly providerAmountUnusable?: true;
    };

/** Fields common to every {@link PaymentOutcome}. */
interface PaymentOutcomeFields {
  /** Binding identifier ({@link PaymentProviderBinding.id}). */
  readonly provider: string;

  /** Echoed `PaymentAttemptId`, when the provider supplies it. */
  readonly reference?: string;

  /** When the payment was authorized, if known. */
  readonly authorizedAt?: Instant;

  /** When the payment was captured, if known. */
  readonly capturedAt?: Instant;
}

/** A settled successful payment: provider-confirmed amount and `paymentId` are mandatory. */
interface SettledPaymentOutcome extends PaymentOutcomeFields {
  /** Settled success state. */
  readonly state: "authorized" | "captured";

  /** Provider payment identifier. */
  readonly paymentId: string;

  /** Provider-confirmed amount: mandatory and valid. */
  readonly amount: Money;
}

/** A confirmed failure, cancellation, or a known pending state. */
type UnsettledPaymentOutcome = PaymentOutcomeFields &
  ReportedAmount & {
    /** Payment state. */
    readonly state: "failed" | "cancelled" | "pending";

    /** Provider payment identifier, when the provider created a payment object. */
    readonly paymentId?: string;
  };

/** A known state that needs a customer action. */
type ActionPaymentOutcome = PaymentOutcomeFields &
  ReportedAmount & {
    /** Payment state. */
    readonly state: "requires_action";

    /** Provider payment identifier, when the provider created a payment object. */
    readonly paymentId?: string;

    /** The action the customer must perform. */
    readonly action: PaymentAction;
  };

/**
 * Outcome of a payment initiation or lookup (ADR-037 §3).
 *
 * `amount` is never the requested amount echoed back: it is provider-reported or provider-confirmed only.
 * `authorized` and `captured` require a valid provider-confirmed amount and a `paymentId`.
 */
export type PaymentOutcome = SettledPaymentOutcome | UnsettledPaymentOutcome | ActionPaymentOutcome;

/** Fields common to every {@link PaymentOperationOutcome}. */
interface PaymentOperationFields {
  /** Binding identifier. */
  readonly provider: string;

  /** The payment the operation acts on. */
  readonly paymentId: string;

  /**
   * Provider operation identifier (`ProviderOperationId`). Required at runtime when `status` is `pending`
   * (rule C-10, verified by adapter conformance, not by the type).
   */
  readonly operationId?: string;

  /** When the operation completed, if known. */
  readonly completedAt?: Instant;
}

/** A cancel operation result: it never carries an amount. */
type CancelOperationOutcome = PaymentOperationFields & {
  /** Operation kind. */
  readonly operation: "cancel";

  /** Operation status. */
  readonly status: OperationStatus;

  /** A cancel carries no amount. */
  readonly amount?: never;

  /** A cancel never carries the flag. */
  readonly providerAmountUnusable?: never;
};

/** A succeeded capture: an optional provider-confirmed amount; an unusable one is `unrepresentable_success`. */
type SucceededCaptureOutcome = PaymentOperationFields & {
  /** Operation kind. */
  readonly operation: "capture";

  /** Operation status. */
  readonly status: "succeeded";

  /** Provider-confirmed captured amount, when returned. Absent is permitted but is not Order-fact evidence. */
  readonly amount?: Money;

  /** Never set on a success. */
  readonly providerAmountUnusable?: never;
};

/** A pending or failed capture with a reported amount. */
type UnsettledCaptureOutcome = PaymentOperationFields &
  ReportedAmount & {
    /** Operation kind. */
    readonly operation: "capture";

    /** Operation status. */
    readonly status: "pending" | "failed";
  };

/**
 * Result of one capture or cancel command, or of `retrieveOperation` (ADR-037 §2, §3).
 *
 * Operation completion is not a payment outcome: a `succeeded` capture is not by itself
 * evidence of an Order `captured` fact (ADR-037 §2, "Capture success semantics").
 */
export type PaymentOperationOutcome =
  CancelOperationOutcome | SucceededCaptureOutcome | UnsettledCaptureOutcome;
