import { describe, expect, it } from "vitest";
import { Currency, Money } from "@comity/pricing";
import { Instant } from "@comity/primitives/time";
import type { PaymentRequest } from "../contracts/payment-request.js";
import type { PaymentOutcome, PaymentStatus } from "../contracts/payment-outcome.js";

function unwrap<T>(result: { success: true; value: T } | { success: false }): T {
  if (result.success === false) {
    throw new Error("Unexpected failure");
  }
  return result.value;
}

const eur = unwrap(Currency.create("EUR"));
const money = (amount: bigint) => unwrap(Money.create(amount, eur));

describe("PaymentRequest", () => {
  it("carries amount, idempotency key, attempt reference, capture mode and optional return URL", () => {
    const request: PaymentRequest = {
      amount: money(10000n),
      idempotencyKey: "pay:att_1",
      reference: "att_1",
      capture: "manual",
      returnUrl: "https://shop.example/return",
    };

    expect(request.idempotencyKey).toBe("pay:att_1");
    expect(request.reference).toBe("att_1");
    expect(request.capture).toBe("manual");
    expect(request.returnUrl).toBe("https://shop.example/return");
  });

  it("keeps returnUrl optional", () => {
    const request: PaymentRequest = {
      amount: money(5000n),
      idempotencyKey: "pay:att_2",
      reference: "att_2",
      capture: "automatic",
    };

    expect(request.returnUrl).toBeUndefined();
  });

  it("requires the idempotency key, the reference and the capture mode", () => {
    // @ts-expect-error idempotencyKey is required (ADR-030 §1)
    const withoutKey: PaymentRequest = {
      amount: money(1n),
      reference: "att",
      capture: "automatic",
    };
    // @ts-expect-error reference is required (ADR-030 §2a)
    const withoutReference: PaymentRequest = {
      amount: money(1n),
      idempotencyKey: "k",
      capture: "automatic",
    };
    // @ts-expect-error capture mode is required (ADR-037 §3)
    const withoutCapture: PaymentRequest = {
      amount: money(1n),
      idempotencyKey: "k",
      reference: "att",
    };
    const later = "later";
    // @ts-expect-error the capture mode is a closed union
    const badCapture: PaymentRequest = { ...withoutCapture, capture: later };

    expect([withoutKey, withoutReference, withoutCapture, badCapture]).toHaveLength(4);
  });
});

describe("PaymentOutcome", () => {
  it("accepts a settled outcome with a provider-confirmed amount", () => {
    const outcome: PaymentOutcome = {
      state: "authorized",
      paymentId: "pay_123",
      amount: money(10000n),
      provider: "stripe",
      reference: "order-123",
      authorizedAt: Instant.fromEpochMilliseconds(0),
    };

    expect(outcome.paymentId).toBe("pay_123");
    expect(outcome.state).toBe("authorized");
  });

  it("accepts a minimal non-settled outcome with no amount and no paymentId", () => {
    const outcome: PaymentOutcome = { state: "pending", provider: "stripe" };

    expect(outcome.paymentId).toBeUndefined();
    expect(outcome.amount).toBeUndefined();
    expect(outcome.reference).toBeUndefined();
  });

  it("represents a provider amount that could not be used", () => {
    const outcome: PaymentOutcome = {
      state: "failed",
      provider: "stripe",
      providerAmountUnusable: true,
    };

    expect(outcome.providerAmountUnusable).toBe(true);
  });

  it("requires an action for requires_action", () => {
    const outcome: PaymentOutcome = {
      state: "requires_action",
      provider: "stripe",
      action: { kind: "redirect", url: "https://pay.example/redirect" },
    };

    expect(outcome.action.kind).toBe("redirect");
  });

  it("only allows valid PaymentStatus values", () => {
    const statuses: PaymentStatus[] = ["authorized", "captured", "failed", "cancelled"];

    for (const status of statuses) {
      expect(["authorized", "captured", "failed", "cancelled"]).toContain(status);
    }
  });
});
