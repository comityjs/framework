import type { Money } from "@comity/pricing";

/**
 * Input required to initiate a payment.
 *
 * Minimal by design: no order, customer, address, or provider-specific data.
 * The Application owns orchestration and maps its context to this shape.
 */
export interface PaymentRequest {
  /** The amount to charge. Currency is embedded in the Money value object. */
  readonly amount: Money;

  /**
   * Opaque caller-owned correlation reference. In the approved design (ADR-037) it is the application-owned payment-attempt
   * identity, echoed back by the provider where it can. It is neither an idempotency key (a separate identifier, ADR-030)
   * nor a provider identifier (`paymentId`).
   */
  readonly reference?: string;
}
