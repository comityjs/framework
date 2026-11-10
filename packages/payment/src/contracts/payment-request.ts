import type { Money } from "@comity/pricing";

/**
 * Input required to initiate a payment (ADR-030, ADR-037 §3).
 *
 * Minimal by design: no order, customer, address, or provider-specific data.
 * The Application owns orchestration and maps its context to this shape.
 *
 * Three identities stay distinct: `reference` is the application `PaymentAttemptId`, `idempotencyKey`
 * identifies this one initiation invocation, and the provider payment identity (`paymentId`) is assigned
 * by the provider and returned in the {@link PaymentOutcome}.
 */
export interface PaymentRequest {
  /** The amount to charge. Currency is embedded in the Money value object. */
  readonly amount: Money;

  /**
   * Idempotency key of this initiation invocation (ADR-030). Required: an opaque string of 1–255 characters
   * without whitespace or control characters. A retry reuses the same key with an identical request; a new
   * attempt uses a new key. Never the `reference` and never a provider identifier.
   */
  readonly idempotencyKey: string;

  /**
   * The application `PaymentAttemptId` (ADR-030 §2a, ADR-037 §4), sent to the provider as the payment reference.
   * Required. It is neither an Order identifier, nor an idempotency key, nor a provider identifier.
   */
  readonly reference: string;

  /**
   * Capture mode. `"manual"` requires a binding that declares `manualCapture`; otherwise the adapter returns
   * `invalid_request` with cause `unsupported`.
   */
  readonly capture: "automatic" | "manual";

  /** Where the customer returns after a redirect. Required when the provider may return a redirect action. */
  readonly returnUrl?: string;
}
