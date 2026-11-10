import { describe, expect, it } from "vitest";
import { PaymentError } from "../errors/payment.js";
import type { UnrepresentableSuccessDetails } from "../errors/payment.js";

describe("PaymentError", () => {
  it("creates an error with the invalid_request reason", () => {
    const error = new PaymentError("invalid_request");

    expect(error.code).toBe("payment:invalid_request");
    expect(error.message).toBe("Invalid payment request");
    expect(error.meta.reason).toBe("invalid_request");
    expect(error.meta.httpStatus).toBe(400);
  });

  it("creates an error with the internal_error reason", () => {
    const error = new PaymentError("internal_error");

    expect(error.code).toBe("payment:internal_error");
    expect(error.message).toBe("Payment infrastructure error");
    expect(error.meta.reason).toBe("internal_error");
    expect(error.meta.httpStatus).toBe(500);
  });

  it("merges contextual details", () => {
    const error = new PaymentError("invalid_request", {
      details: { reference: "order-123" },
    });

    expect(error.meta.details).toEqual({ reference: "order-123" });
  });

  it("overrides httpStatus with custom metadata", () => {
    const error = new PaymentError("invalid_request", { httpStatus: 503 });

    expect(error.meta.httpStatus).toBe(503);
  });

  it("is an instance of Error", () => {
    const error = new PaymentError("invalid_request");

    expect(error).toBeInstanceOf(Error);
  });
});

describe("PaymentError: reasons and details (ADR-030, ADR-037 §3, §8b)", () => {
  it("maps every reason to its code, message and HTTP hint", () => {
    const cases = [
      [new PaymentError("idempotency_conflict", { details: { cause: "request_mismatch" } }), 409],
      [new PaymentError("invalid_notification", { details: { cause: "signature" } }), 400],
      [new PaymentError("invalid_configuration"), 500],
      [
        new PaymentError("unrepresentable_success", {
          details: { provider: "b", scope: "payment", paymentId: "p" },
        }),
        500,
      ],
    ] as const;

    for (const [error, status] of cases) {
      expect(error.code).toBe(`payment:${error.meta.reason}`);
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.meta.httpStatus).toBe(status);
    }
  });

  it("carries the invalid_request causes", () => {
    for (const cause of ["malformed", "unsupported"] as const) {
      expect(new PaymentError("invalid_request", { details: { cause } }).meta.details?.cause).toBe(
        cause
      );
    }
  });

  it("carries the idempotency_conflict causes, which are required", () => {
    for (const cause of ["request_mismatch", "in_progress"] as const) {
      const error = new PaymentError("idempotency_conflict", {
        details: { cause, reference: "att" },
      });
      expect(error.meta.details).toEqual({ cause, reference: "att" });
    }
    // @ts-expect-error idempotency_conflict requires details with a cause
    expect(new PaymentError("idempotency_conflict").meta.reason).toBe("idempotency_conflict");
  });

  it("carries the invalid_notification causes, which are required", () => {
    for (const cause of ["signature", "malformed"] as const) {
      expect(
        new PaymentError("invalid_notification", { details: { cause } }).meta.details?.cause
      ).toBe(cause);
    }
    const inProgress = { cause: "in_progress" } as const;
    // @ts-expect-error a notification cause is not an idempotency cause
    const wrongCause = () => new PaymentError("invalid_notification", { details: inProgress });
    expect(wrongCause()).toBeInstanceOf(PaymentError);
  });

  it("lists violated rules for invalid_configuration", () => {
    const error = new PaymentError("invalid_configuration", {
      details: { violations: [{ rule: "C-11", message: "no mechanism" }] },
    });

    expect(error.meta.details?.violations).toEqual([{ rule: "C-11", message: "no mechanism" }]);
  });

  describe("unrepresentable_success", () => {
    const variants: ReadonlyArray<UnrepresentableSuccessDetails> = [
      { provider: "b", scope: "payment", paymentId: "p", reference: "att" },
      { provider: "b", scope: "capture", paymentId: "p", operationId: "op" },
      { provider: "b", scope: "capture", paymentId: "p" },
      { provider: "b", scope: "refund", paymentId: "p", refundId: "re", reference: "ratt" },
      { provider: "b", scope: "refund", paymentId: "p", refundId: "re", eventId: "evt" },
    ];

    for (const details of variants) {
      it(`carries the ${details.scope} details ${JSON.stringify(details)}`, () => {
        const error = new PaymentError("unrepresentable_success", { details });

        expect(error.meta.reason).toBe("unrepresentable_success");
        expect(error.meta.details).toEqual(details);
      });
    }

    it("keeps the underlying error as the error cause, not in the details", () => {
      const underlying = new Error("pricing rejected the amount");
      const error = new PaymentError("unrepresentable_success", {
        details: { provider: "b", scope: "payment", paymentId: "p" },
        cause: underlying,
      });

      expect(error.cause).toBe(underlying);
      expect(error.meta.details).not.toHaveProperty("cause");
    });

    it("requires the identifiers of each scope", () => {
      const noPaymentId = { provider: "b", scope: "payment" } as const;
      const noRefundId = { provider: "b", scope: "refund", paymentId: "p" } as const;
      const cancelScope = { provider: "b", scope: "cancel", paymentId: "p" } as const;
      // @ts-expect-error details are required
      const noDetails = () => new PaymentError("unrepresentable_success");
      // @ts-expect-error paymentId is mandatory on every path
      const a = () => new PaymentError("unrepresentable_success", { details: noPaymentId });
      // @ts-expect-error refundId is mandatory for scope refund
      const b = () => new PaymentError("unrepresentable_success", { details: noRefundId });
      // @ts-expect-error a cancel cannot produce this error
      const c = () => new PaymentError("unrepresentable_success", { details: cancelScope });

      for (const build of [noDetails, a, b, c]) expect(build()).toBeInstanceOf(PaymentError);
    });

    it("is distinct from internal_error (unknown outcome)", () => {
      const unknown = new PaymentError("internal_error");
      const anomaly = new PaymentError("unrepresentable_success", {
        details: { provider: "b", scope: "payment", paymentId: "p" },
      });

      expect(unknown.code).not.toBe(anomaly.code);
      expect(unknown.meta.details).toBeUndefined();
    });
  });
});
