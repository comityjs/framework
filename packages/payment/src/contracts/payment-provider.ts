import type { Money } from "@comity/pricing";
import type { Result } from "@comity/primitives/result";

import type { PaymentError } from "../errors/payment.js";
import type { PaymentOperationOutcome, PaymentOutcome } from "./payment-outcome.js";
import type { PaymentRequest } from "./payment-request.js";

/**
 * Provider-agnostic contract for initiating payments.
 *
 * The Application composes this capability, through a {@link PaymentProviderBinding}, to orchestrate checkout
 * without depending on any specific payment provider (Stripe, Adyen, etc.).
 *
 * Implementations belong to Adapters (e.g., {@link @comity/payment-stripe}).
 */
export interface PaymentProvider {
  /**
   * Initiates a payment.
   *
   * @param request - The payment request: amount, idempotency key, attempt reference and capture mode.
   *
   * @returns A Result containing the PaymentOutcome on success, or a PaymentError
   * on contract-level failure (invalid request, idempotency conflict, infrastructure failure).
   *
   * Provider declines (e.g., insufficient funds) are represented as
   * {@link PaymentOutcome} with state "failed", not as errors. `internal_error` means the outcome is unknown.
   */
  initiate(request: PaymentRequest): Promise<Result<PaymentOutcome, PaymentError>>;
}

/** Payment-level lookup. Declared by the `statusLookup` capability. */
export interface PaymentStatusProvider {
  /**
   * Looks up the current state of a payment.
   *
   * @param paymentId - The provider payment identifier.
   *
   * @returns The current payment outcome, or `null` when the payment is unknown to the provider.
   */
  retrieve(paymentId: string): Promise<Result<PaymentOutcome | null, PaymentError>>;
}

/** Input of one capture invocation (full authorized amount in v1). */
export interface PaymentCaptureRequest {
  /** The authorized payment to capture. */
  readonly paymentId: string;

  /** The amount to capture: the full authorized amount in v1. */
  readonly amount: Money;

  /** Idempotency key of this capture invocation (ADR-030). */
  readonly idempotencyKey: string;
}

/** Input of one cancel invocation. */
export interface PaymentCancelRequest {
  /** The payment to cancel: an authorization to void, or an incomplete payment to abandon. */
  readonly paymentId: string;

  /** Idempotency key of this cancel invocation (ADR-030). */
  readonly idempotencyKey: string;
}

/** Capture of an authorized payment. Declared by the `manualCapture` capability. */
export interface PaymentCaptureProvider {
  /**
   * Captures an authorized payment.
   *
   * @param request - The capture request.
   *
   * @returns The operation outcome; a `pending` result carries an `operationId` (C-10).
   */
  capture(request: PaymentCaptureRequest): Promise<Result<PaymentOperationOutcome, PaymentError>>;
}

/** Cancellation of an authorization or of an incomplete payment. Declared by the `cancel` capability. */
export interface PaymentCancelProvider {
  /**
   * Cancels a payment. A request alone resolves nothing: only a `succeeded` result, or a lookup showing
   * `cancelled`, establishes cancellation (ADR-037 §6).
   *
   * @param request - The cancel request.
   *
   * @returns The operation outcome; a `pending` result carries an `operationId` (C-10).
   */
  cancel(request: PaymentCancelRequest): Promise<Result<PaymentOperationOutcome, PaymentError>>;
}

/** Operation-level lookup. Declared by the `operationLookup` capability. */
export interface PaymentOperationLookup {
  /**
   * Looks up the current state of one capture or cancel operation.
   *
   * @param operationId - The provider operation identifier.
   *
   * @returns The current operation outcome, or `null` for an unknown operation identifier.
   */
  retrieveOperation(
    operationId: string
  ): Promise<Result<PaymentOperationOutcome | null, PaymentError>>;
}
