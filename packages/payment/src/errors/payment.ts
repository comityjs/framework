import type { ErrorMeta } from "@comity/primitives/errors";

import { BaseError } from "@comity/primitives/errors";

/**
 * Reasons for payment contract errors (ADR-030, ADR-037 §3).
 *
 * Provider declines (e.g., insufficient funds) are NOT errors — they are
 * represented as {@link PaymentOutcome} with state "failed". Consumers branch
 * on the reason; each reason has its own recovery:
 *
 * - `invalid_request`: caller defect or undeclared option. Never retried as is.
 * - `internal_error`: from a command, the **outcome is unknown**, never "failed".
 * - `idempotency_conflict`: same key, different request or still in flight (ADR-030 §5).
 * - `invalid_notification`: a rejected delivery. Reject and alert; never retried.
 * - `invalid_configuration`: the binding or adapter configuration is unusable; composition fails.
 * - `unrepresentable_success`: a provider-confirmed success whose financial data cannot be
 *   represented (ADR-037 §8b, case B). Never an unknown outcome and never a normal outcome.
 */
export type PaymentErrorReason =
  | "invalid_request"
  | "internal_error"
  | "idempotency_conflict"
  | "invalid_notification"
  | "invalid_configuration"
  | "unrepresentable_success";

/** Discriminator of `invalid_request`: a malformed request, or an option the binding does not declare. */
export type PaymentInvalidRequestCause = "malformed" | "unsupported";

/**
 * Discriminator of `idempotency_conflict` (ADR-030 §5): `request_mismatch` is a caller bug and MUST NOT be
 * retried; `in_progress` MAY be retried later with the same key.
 */
export type PaymentIdempotencyConflictCause = "request_mismatch" | "in_progress";

/** Discriminator of `invalid_notification`: failed authenticity verification, or an unparseable delivery. */
export type PaymentInvalidNotificationCause = "signature" | "malformed";

/** One violated static binding rule reported with `invalid_configuration` (ADR-037 §5). */
export type PaymentConfigurationViolation = Readonly<{
  /** Rule identifier, for example `C-11`. */
  rule: string;

  /** Human-readable description of the violation. */
  message: string;
}>;

/** Identifiers common to every {@link UnrepresentableSuccessDetails} variant. */
type UnrepresentableSuccessCommon = Readonly<{
  /** The {@link PaymentProviderBinding.id} that scopes every provider identifier below. */
  provider: string;

  /** The provider payment identifier. Mandatory on every path (ADR-037 §8b). */
  paymentId: string;

  /** Echoed `PaymentAttemptId` or `RefundAttemptId`: a fallback only, never a substitute for an available identifier. */
  reference?: string;

  /** The provider event identifier. Mandatory when the anomaly comes from a verified notification. */
  eventId?: string;
}>;

/**
 * Typed details of `unrepresentable_success` (ADR-037 §3, §8b, OD-F9): the minimum for exact correlation of the
 * anomaly with one binding and one application record. The underlying error (for example the Pricing error that
 * rejected the amount) is the error `cause`, not part of the details.
 *
 * A cancel cannot produce this error. Mandatory identifiers per path:
 * - `payment`: `provider`, `paymentId`;
 * - `capture`: `provider`, `paymentId`, and `operationId` when the provider returned one (always, for an `operation` notification);
 * - `refund`: `provider`, `paymentId`, `refundId`.
 */
export type UnrepresentableSuccessDetails =
  | (UnrepresentableSuccessCommon &
      Readonly<{
        /** A payment outcome: initiation, `retrieve`, or a `payment` notification. */
        scope: "payment";
      }>)
  | (UnrepresentableSuccessCommon &
      Readonly<{
        /** A capture operation result, lookup or notification. */
        scope: "capture";

        /** The provider operation identifier, when the provider returned one. */
        operationId?: string;
      }>)
  | (UnrepresentableSuccessCommon &
      Readonly<{
        /** A refund result, lookup or notification. */
        scope: "refund";

        /** The provider refund identifier. */
        refundId: string;
      }>);

/**
 * Metadata attached to payment errors.
 *
 * `details` is one flat object for every reason (the Comity error convention); the constructor overloads of
 * {@link PaymentError} enforce which fields each reason carries.
 */
export interface PaymentErrorMeta extends ErrorMeta {
  /** Error reason. */
  readonly reason: PaymentErrorReason;

  /** Optional diagnostic details. */
  readonly details?: Readonly<{
    /** Opaque caller reference from the failed request, if any. */
    reference?: string;

    /** Reason-specific discriminator: `invalid_request`, `idempotency_conflict` or `invalid_notification`. */
    cause?:
      | PaymentInvalidRequestCause
      | PaymentIdempotencyConflictCause
      | PaymentInvalidNotificationCause;

    /** Violated static binding rules, for `invalid_configuration` (ADR-037 §5). */
    violations?: ReadonlyArray<PaymentConfigurationViolation>;

    /** Binding identifier, for `unrepresentable_success`. */
    provider?: string;

    /** Affected scope, for `unrepresentable_success`. */
    scope?: UnrepresentableSuccessDetails["scope"];

    /** Provider payment identifier, for `unrepresentable_success`. */
    paymentId?: string;

    /** Provider operation identifier, for `unrepresentable_success` with scope `capture`. */
    operationId?: string;

    /** Provider refund identifier, for `unrepresentable_success` with scope `refund`. */
    refundId?: string;

    /** Provider event identifier, for `unrepresentable_success` raised from a notification. */
    eventId?: string;
  }>;
}

/** Details of `invalid_request`. */
type InvalidRequestDetails = Readonly<{
  /** Malformed request, or an option the binding does not declare. */
  cause?: PaymentInvalidRequestCause;

  /** Opaque caller reference from the failed request, if any. */
  reference?: string;
}>;

/** Details of `internal_error`. */
type InternalErrorDetails = Readonly<{
  /** Opaque caller reference from the failed request, if any. */
  reference?: string;
}>;

/** Details of `idempotency_conflict`: the cause is required (ADR-030 §5). */
type IdempotencyConflictDetails = Readonly<{
  /** Whether the request differs or the original is still in flight. */
  cause: PaymentIdempotencyConflictCause;

  /** Opaque caller reference from the conflicting request, if any. */
  reference?: string;
}>;

/** Details of `invalid_notification`: the cause is required. */
type InvalidNotificationDetails = Readonly<{
  /** Failed authenticity, or an unparseable delivery. */
  cause: PaymentInvalidNotificationCause;
}>;

/** Details of `invalid_configuration`. */
type InvalidConfigurationDetails = Readonly<{
  /** Violated static binding rules, when the failure comes from binding validation. */
  violations?: ReadonlyArray<PaymentConfigurationViolation>;
}>;

/** Constructor metadata of a reason whose details are optional. */
type OptionalDetails<Details> = Omit<ErrorMeta, "reason" | "details"> & {
  /** Reason-specific details. */
  readonly details?: Details;
};

/** Constructor metadata of a reason whose details are required. */
type RequiredDetails<Details> = Omit<ErrorMeta, "reason" | "details"> & {
  /** Reason-specific details. */
  readonly details: Details;
};

/**
 * Human-friendly messages mapped by reason.
 */
const REASON_MESSAGES: Record<PaymentErrorReason, string> = {
  invalid_request: "Invalid payment request",
  internal_error: "Payment infrastructure error",
  idempotency_conflict: "Payment idempotency key conflict",
  invalid_notification: "Invalid payment notification",
  invalid_configuration: "Invalid payment provider configuration",
  unrepresentable_success: "Provider-confirmed payment success with unrepresentable financial data",
};

/**
 * Default HTTP status mapped by reason.
 */
const REASON_HTTP_STATUS: Record<PaymentErrorReason, number> = {
  invalid_request: 400,
  internal_error: 500,
  idempotency_conflict: 409,
  invalid_notification: 400,
  invalid_configuration: 500,
  unrepresentable_success: 500,
};

/**
 * Payment contract error.
 *
 * Represents a failure at the payment contract boundary — not a provider
 * decline, which is represented as a {@link PaymentOutcome} with state "failed".
 *
 * This is a Core Module error, following the single-error-class pattern
 * per {@link errors.md} §6. The constructor overloads pair each reason with its details.
 */
export class PaymentError extends BaseError<PaymentErrorMeta> {
  /** Namespaced error code. */
  readonly code: `payment:${PaymentErrorReason}`;

  constructor(reason: "invalid_request", meta?: OptionalDetails<InvalidRequestDetails>);
  constructor(reason: "internal_error", meta?: OptionalDetails<InternalErrorDetails>);
  constructor(reason: "idempotency_conflict", meta: RequiredDetails<IdempotencyConflictDetails>);
  constructor(reason: "invalid_notification", meta: RequiredDetails<InvalidNotificationDetails>);
  constructor(reason: "invalid_configuration", meta?: OptionalDetails<InvalidConfigurationDetails>);
  constructor(
    reason: "unrepresentable_success",
    meta: RequiredDetails<UnrepresentableSuccessDetails>
  );
  /**
   * @param reason - The reason for the payment error.
   * @param meta - Additional metadata for the error; required where the reason has required details.
   */
  constructor(reason: PaymentErrorReason, meta?: Omit<PaymentErrorMeta, "reason">) {
    super(REASON_MESSAGES[reason], {
      httpStatus: REASON_HTTP_STATUS[reason],
      ...meta,
      reason,
    });

    this.code = `payment:${reason}`;
  }
}
