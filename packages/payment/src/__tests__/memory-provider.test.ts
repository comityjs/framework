import { describe, expect, it } from "vitest";
import type { Result } from "@comity/primitives/result";
import { Instant } from "@comity/primitives/time";
import { Currency, Money } from "@comity/pricing";

import type { PaymentRequest } from "../contracts/payment-request.js";
import type { PaymentError } from "../errors/payment.js";
import { MemoryPaymentProvider } from "../providers/memory.js";
import type { MemoryPaymentProviderOptions } from "../providers/memory.js";
import { validatePaymentProviderBinding } from "../validation/validate-binding.js";

function value<T>(result: Result<T, PaymentError>): T {
  if (!result.success) throw new Error(`unexpected ${result.error.code}`);
  return result.value;
}

function error<T>(result: Result<T, PaymentError>): PaymentError {
  if (result.success) throw new Error("unexpected success");
  return result.error;
}

function pricing<T>(result: { success: true; value: T } | { success: false; error: unknown }): T {
  if (!result.success) throw new Error("invalid pricing fixture");
  return result.value;
}

const eur = pricing(Currency.create("EUR"));
const usd = pricing(Currency.create("USD"));
const money = (amount: bigint, currency = eur): Money => pricing(Money.create(amount, currency));
const at = Instant.fromEpochMilliseconds(1_000);

function memory(options: MemoryPaymentProviderOptions = {}): MemoryPaymentProvider {
  return new MemoryPaymentProvider({ clock: () => at, ...options });
}

function request(overrides: Partial<PaymentRequest> = {}): PaymentRequest {
  return {
    amount: money(10_000n),
    idempotencyKey: "pay:att_1",
    reference: "att_1",
    capture: "manual",
    ...overrides,
  };
}

async function authorized(provider: MemoryPaymentProvider, n = 1): Promise<string> {
  const outcome = value(
    await provider.initiate(request({ idempotencyKey: `pay:att_${n}`, reference: `att_${n}` }))
  );
  if (outcome.state !== "authorized") throw new Error("fixture is not authorized");
  return outcome.paymentId;
}

async function captured(provider: MemoryPaymentProvider, n = 1): Promise<string> {
  const outcome = value(
    await provider.initiate(
      request({ idempotencyKey: `pay:att_${n}`, reference: `att_${n}`, capture: "automatic" })
    )
  );
  if (outcome.state !== "captured") throw new Error("fixture is not captured");
  return outcome.paymentId;
}

describe("MemoryPaymentProvider binding", () => {
  it("declares every port it implements, and the binding is statically valid", () => {
    const provider = memory();
    const { binding } = provider;

    expect(validatePaymentProviderBinding(binding).success).toBe(true);
    expect(binding.id).toBe("memory");
    expect(binding.capabilities).toEqual({
      asynchronousInitiation: true,
      customerActions: ["redirect"],
      statusLookup: true,
      notifications: true,
      operationLookup: true,
      manualCapture: { asynchronous: false },
      cancel: { incomplete: true, authorized: true, asynchronous: false },
      refund: { partial: true, multiple: true, asynchronous: false },
      incompleteResolution: { kind: "cancel" },
      idempotencyRetentionSeconds: 86_400,
    });
    for (const port of [
      "provider",
      "status",
      "capture",
      "cancel",
      "operations",
      "refund",
      "notifications",
    ] as const) {
      expect(binding[port]).toBe(provider);
    }
  });

  it("declares the configured asynchronous operations and stays valid", () => {
    const { binding } = memory({
      asynchronousCapture: true,
      asynchronousCancel: true,
      asynchronousRefund: true,
    });

    expect(binding.capabilities.manualCapture).toEqual({ asynchronous: true });
    expect(binding.capabilities.cancel).toEqual({
      incomplete: true,
      authorized: true,
      asynchronous: true,
    });
    expect(binding.capabilities.refund).toEqual({
      partial: true,
      multiple: true,
      asynchronous: true,
    });
    expect(validatePaymentProviderBinding(binding).success).toBe(true);
  });

  it("omits the capture port when manual capture is disabled", () => {
    const { binding } = memory({ manualCapture: false });

    expect(binding.capabilities.manualCapture).toBe(false);
    expect(binding.capture).toBeUndefined();
    expect(validatePaymentProviderBinding(binding).success).toBe(true);
  });

  it("does not weaken C-8: a non-positive retention is an invalid binding", () => {
    const result = validatePaymentProviderBinding(
      memory({ idempotencyRetentionSeconds: 0 }).binding
    );

    expect(result.success).toBe(false);
  });

  it("uses the configured binding id as provider", async () => {
    const provider = memory({ id: "memory-eu" });
    const outcome = value(await provider.initiate(request()));

    expect(provider.binding.id).toBe("memory-eu");
    expect(outcome.provider).toBe("memory-eu");
  });
});

describe("MemoryPaymentProvider initiation", () => {
  it("captures an automatic-capture payment with a simulated provider-confirmed amount", async () => {
    const outcome = value(await memory().initiate(request({ capture: "automatic" })));

    expect(outcome).toEqual({
      provider: "memory",
      paymentId: "mem_pay_1",
      reference: "att_1",
      state: "captured",
      amount: money(10_000n),
      authorizedAt: at,
      capturedAt: at,
    });
  });

  it("authorizes a manual-capture payment", async () => {
    const outcome = value(await memory().initiate(request()));

    expect(outcome.state).toBe("authorized");
    expect(outcome.amount).toEqual(money(10_000n));
    expect(outcome.capturedAt).toBeUndefined();
  });

  it.each([
    ["fail:att", "failed"],
    ["cancel:att", "cancelled"],
    ["pending:att", "pending"],
  ] as const)("scripts %s as %s without echoing the requested amount", async (reference, state) => {
    const outcome = value(await memory().initiate(request({ reference })));

    expect(outcome.state).toBe(state);
    expect(outcome.paymentId).toBe("mem_pay_1");
    expect(outcome.amount).toBeUndefined();
    expect("providerAmountUnusable" in outcome).toBe(false);
  });

  it("scripts action: as requires_action with a redirect, and requires a return URL", async () => {
    const provider = memory();
    const outcome = value(
      await provider.initiate(
        request({ reference: "action:att", returnUrl: "https://shop.example/return" })
      )
    );

    expect(outcome.state).toBe("requires_action");
    if (outcome.state === "requires_action") {
      expect(outcome.action).toEqual({
        kind: "redirect",
        url: "https://memory.invalid/redirect/mem_pay_1",
      });
    }
    expect(outcome.amount).toBeUndefined();

    const missing = error(
      await provider.initiate(request({ reference: "action:att2", idempotencyKey: "k2" }))
    );
    expect(missing.meta.reason).toBe("invalid_request");
    expect(missing.meta.details?.cause).toBe("malformed");
  });

  it("rejects a zero amount as malformed", async () => {
    const failure = error(await memory().initiate(request({ amount: money(0n) })));

    expect(failure.meta.reason).toBe("invalid_request");
    expect(failure.meta.details).toEqual({ cause: "malformed", reference: "att_1" });
  });

  it.each(["", " pay", "pay key", "pay\u0000", "x".repeat(256)])(
    "rejects the malformed idempotency key %j",
    async (idempotencyKey) => {
      const failure = error(await memory().initiate(request({ idempotencyKey })));

      expect(failure.meta.reason).toBe("invalid_request");
      expect(failure.meta.details?.cause).toBe("malformed");
    }
  );

  it("accepts a 255-character key", async () => {
    expect((await memory().initiate(request({ idempotencyKey: "x".repeat(255) }))).success).toBe(
      true
    );
  });

  it("rejects an empty reference as malformed", async () => {
    expect(error(await memory().initiate(request({ reference: "" }))).meta.details?.cause).toBe(
      "malformed"
    );
  });

  it("rejects a manual-capture request when manual capture is not supported, without consuming the key", async () => {
    const provider = memory({ manualCapture: false });

    const failure = error(await provider.initiate(request({ capture: "manual" })));
    expect(failure.meta.reason).toBe("invalid_request");
    expect(failure.meta.details).toEqual({ cause: "unsupported", reference: "att_1" });

    expect(
      value(await provider.initiate(request({ capture: "automatic", idempotencyKey: "pay:att_1" })))
        .state
    ).toBe("captured");
  });

  it("returns null when looking up an unknown payment", async () => {
    expect(value(await memory().retrieve("mem_pay_404"))).toBeNull();
  });
});

describe("MemoryPaymentProvider idempotency (ADR-030 §5)", () => {
  it("replays the first result for the same key and request, with no second payment", async () => {
    const provider = memory();
    const first = value(await provider.initiate(request()));
    const second = value(await provider.initiate(request()));

    expect(second).toBe(first);
    expect(value(await provider.retrieve("mem_pay_2"))).toBeNull();
  });

  it.each([
    ["amount", { amount: money(9_999n) }],
    ["currency", { amount: money(10_000n, usd) }],
    ["reference", { reference: "att_other" }],
    ["capture mode", { capture: "automatic" }],
    ["return URL", { returnUrl: "https://shop.example/return" }],
  ] as const)(
    "rejects the same key with a different %s as request_mismatch",
    async (_field, change) => {
      const provider = memory();
      value(await provider.initiate(request()));

      const conflict = error(await provider.initiate(request(change)));
      expect(conflict.meta.reason).toBe("idempotency_conflict");
      expect(conflict.meta.details?.cause).toBe("request_mismatch");
      expect(value(await provider.retrieve("mem_pay_2"))).toBeNull();
    }
  );

  it("rejects an initiation key reused for another command kind", async () => {
    const provider = memory();
    const paymentId = await authorized(provider);

    const conflict = error(
      await provider.capture({ paymentId, amount: money(10_000n), idempotencyKey: "pay:att_1" })
    );
    expect(conflict.meta.reason).toBe("idempotency_conflict");
    expect(conflict.meta.details?.cause).toBe("request_mismatch");
  });

  it("replays the original state, while lookup reports the current one", async () => {
    const provider = memory();
    const pending = value(await provider.initiate(request({ reference: "pending:att" })));
    value(provider.settlePayment("mem_pay_1", "authorized"));

    expect(value(await provider.initiate(request({ reference: "pending:att" })))).toBe(pending);
    expect(value(await provider.retrieve("mem_pay_1"))?.state).toBe("authorized");
  });

  it("replays a decline; a new attempt needs a new key", async () => {
    const provider = memory();
    const declined = value(await provider.initiate(request({ reference: "fail:att" })));

    expect(value(await provider.initiate(request({ reference: "fail:att" })))).toBe(declined);
    const retry = value(
      await provider.initiate(request({ reference: "att_2", idempotencyKey: "pay:att_2" }))
    );
    expect(retry.paymentId).toBe("mem_pay_2");
  });

  it("treats a new key with the same amount as an independent payment", async () => {
    const provider = memory();
    const a = value(await provider.initiate(request()));
    const b = value(await provider.initiate(request({ idempotencyKey: "pay:att_1b" })));

    expect(a.paymentId).not.toBe(b.paymentId);
  });
});

describe("MemoryPaymentProvider capture", () => {
  it("captures synchronously with a simulated provider-confirmed amount", async () => {
    const provider = memory();
    const paymentId = await authorized(provider);

    const result = value(
      await provider.capture({
        paymentId,
        amount: money(10_000n),
        idempotencyKey: "capture:att_1:1",
      })
    );
    expect(result).toEqual({
      provider: "memory",
      paymentId,
      operationId: "mem_op_1",
      operation: "capture",
      status: "succeeded",
      amount: money(10_000n),
      completedAt: at,
    });
    expect(value(await provider.retrieve(paymentId))?.state).toBe("captured");
    expect(value(await provider.retrieveOperation("mem_op_1"))).toEqual(result);
  });

  it("captures the full amount only", async () => {
    const provider = memory();
    const paymentId = await authorized(provider);

    const partial = error(
      await provider.capture({ paymentId, amount: money(5_000n), idempotencyKey: "c1" })
    );
    expect(partial.meta.details?.cause).toBe("unsupported");
    const currency = error(
      await provider.capture({ paymentId, amount: money(10_000n, usd), idempotencyKey: "c2" })
    );
    expect(currency.meta.details?.cause).toBe("malformed");
    const unknown = error(
      await provider.capture({ paymentId: "nope", amount: money(1n), idempotencyKey: "c3" })
    );
    expect(unknown.meta.reason).toBe("invalid_request");
  });

  it("reports a failed operation for a payment that cannot be captured", async () => {
    const provider = memory();
    const paymentId = await captured(provider);

    const result = value(
      await provider.capture({ paymentId, amount: money(10_000n), idempotencyKey: "c1" })
    );
    expect(result.status).toBe("failed");
    expect(result.amount).toBeUndefined();
  });

  it("is unsupported when manual capture is disabled", async () => {
    const provider = memory({ manualCapture: false });

    const failure = error(
      await provider.capture({ paymentId: "p", amount: money(1n), idempotencyKey: "c1" })
    );
    expect(failure.meta.details?.cause).toBe("unsupported");
  });

  it("completes an asynchronous capture only through a scripted transition", async () => {
    const provider = memory({ asynchronousCapture: true });
    const paymentId = await authorized(provider);

    const pending = value(
      await provider.capture({ paymentId, amount: money(10_000n), idempotencyKey: "c1" })
    );
    expect(pending).toEqual({
      provider: "memory",
      paymentId,
      operationId: "mem_op_1",
      operation: "capture",
      status: "pending",
    });
    expect(value(await provider.retrieve(paymentId))?.state).toBe("authorized");

    const delivery = value(provider.settleOperation("mem_op_1", "succeeded"));
    const notifications = value(await provider.verify(delivery));
    expect(notifications).toEqual([
      {
        kind: "operation",
        provider: "memory",
        eventId: "mem_evt_1",
        operation: "capture",
        paymentId,
        operationId: "mem_op_1",
        status: "succeeded",
      },
      {
        kind: "payment",
        provider: "memory",
        eventId: "mem_evt_2",
        paymentId,
        reference: "att_1",
        state: "captured",
        amount: money(10_000n),
      },
    ]);
    expect(value(await provider.retrieveOperation("mem_op_1"))).toMatchObject({
      status: "succeeded",
      amount: money(10_000n),
    });
    expect(value(await provider.retrieve(paymentId))?.state).toBe("captured");
  });

  it("replays a capture for the same key and rejects a different request", async () => {
    const provider = memory({ asynchronousCapture: true });
    const paymentId = await authorized(provider);
    const first = value(
      await provider.capture({ paymentId, amount: money(10_000n), idempotencyKey: "c1" })
    );

    expect(
      value(await provider.capture({ paymentId, amount: money(10_000n), idempotencyKey: "c1" }))
    ).toBe(first);
    expect(
      error(
        await provider.capture({ paymentId: "other", amount: money(10_000n), idempotencyKey: "c1" })
      ).meta.reason
    ).toBe("idempotency_conflict");
  });
});

describe("MemoryPaymentProvider cancel", () => {
  it("voids an authorization synchronously", async () => {
    const provider = memory();
    const paymentId = await authorized(provider);

    const result = value(await provider.cancel({ paymentId, idempotencyKey: "cancel:att_1:1" }));
    expect(result).toEqual({
      provider: "memory",
      paymentId,
      operationId: "mem_op_1",
      operation: "cancel",
      status: "succeeded",
      completedAt: at,
    });
    expect(value(await provider.retrieve(paymentId))?.state).toBe("cancelled");
  });

  it("cancels an incomplete payment (incompleteResolution: cancel)", async () => {
    const provider = memory();
    value(
      await provider.initiate(
        request({ reference: "action:att", returnUrl: "https://shop.example/return" })
      )
    );

    expect(
      value(await provider.cancel({ paymentId: "mem_pay_1", idempotencyKey: "k" })).status
    ).toBe("succeeded");
    expect(value(await provider.retrieve("mem_pay_1"))?.state).toBe("cancelled");
  });

  it("reports a failed operation for a captured payment, which stays captured", async () => {
    const provider = memory();
    const paymentId = await captured(provider);

    expect(value(await provider.cancel({ paymentId, idempotencyKey: "k" })).status).toBe("failed");
    expect(value(await provider.retrieve(paymentId))?.state).toBe("captured");
  });

  it("does not resolve the payment while an asynchronous cancel is pending", async () => {
    const provider = memory({ asynchronousCancel: true });
    value(await provider.initiate(request({ reference: "pending:att" })));

    const pending = value(await provider.cancel({ paymentId: "mem_pay_1", idempotencyKey: "k" }));
    expect(pending.status).toBe("pending");
    expect(value(await provider.retrieve("mem_pay_1"))?.state).toBe("pending");

    const delivery = value(provider.settleOperation("mem_op_1", "failed"));
    expect(value(await provider.verify(delivery))).toEqual([
      {
        kind: "operation",
        provider: "memory",
        eventId: "mem_evt_1",
        operation: "cancel",
        paymentId: "mem_pay_1",
        operationId: "mem_op_1",
        status: "failed",
      },
    ]);
    expect(value(await provider.retrieve("mem_pay_1"))?.state).toBe("pending");
  });

  it("correlates each pending operation of one payment individually", async () => {
    const provider = memory({ asynchronousCapture: true, asynchronousCancel: true });
    const paymentId = await authorized(provider);

    const capture = value(
      await provider.capture({ paymentId, amount: money(10_000n), idempotencyKey: "c1" })
    );
    const cancel = value(await provider.cancel({ paymentId, idempotencyKey: "x1" }));
    expect(capture.operationId).not.toBe(cancel.operationId);

    const delivery = value(provider.settleOperation(String(cancel.operationId), "succeeded"));
    const [notification] = value(await provider.verify(delivery));
    expect(notification).toMatchObject({
      kind: "operation",
      operationId: cancel.operationId,
      operation: "cancel",
    });
    expect(value(await provider.retrieveOperation(String(capture.operationId)))?.status).toBe(
      "pending"
    );

    expect(
      error(provider.settleOperation(String(capture.operationId), "succeeded")).meta.reason
    ).toBe("invalid_request");
    expect(value(provider.settleOperation(String(capture.operationId), "failed"))).toBeDefined();
    expect(value(await provider.retrieveOperation(String(capture.operationId)))?.status).toBe(
      "failed"
    );
  });

  it("returns null when looking up an unknown operation", async () => {
    expect(value(await memory().retrieveOperation("mem_op_404"))).toBeNull();
  });
});

describe("MemoryPaymentProvider refund", () => {
  it("refunds partially and repeatedly, then declines an over-refund", async () => {
    const provider = memory();
    const paymentId = await captured(provider);

    const first = value(
      await provider.refund({
        paymentId,
        amount: money(4_000n),
        idempotencyKey: "refund:r1",
        reference: "r1",
      })
    );
    expect(first).toEqual({
      provider: "memory",
      paymentId,
      refundId: "mem_re_1",
      reference: "r1",
      status: "succeeded",
      amount: money(4_000n),
      refundedAt: at,
    });
    expect(
      value(
        await provider.refund({
          paymentId,
          amount: money(4_000n),
          idempotencyKey: "refund:r2",
          reference: "r2",
        })
      ).status
    ).toBe("succeeded");

    const over = value(
      await provider.refund({
        paymentId,
        amount: money(4_000n),
        idempotencyKey: "refund:r3",
        reference: "r3",
      })
    );
    expect(over).toEqual({ provider: "memory", paymentId, reference: "r3", status: "failed" });
  });

  it("declines a refund of a payment that is not captured", async () => {
    const provider = memory();
    const paymentId = await authorized(provider);

    expect(
      value(
        await provider.refund({ paymentId, amount: money(1n), idempotencyKey: "k", reference: "r" })
      ).status
    ).toBe("failed");
  });

  it("rejects malformed refund requests", async () => {
    const provider = memory();
    const paymentId = await captured(provider);

    expect(
      error(
        await provider.refund({
          paymentId,
          amount: money(0n),
          idempotencyKey: "k1",
          reference: "r",
        })
      ).meta.details?.cause
    ).toBe("malformed");
    expect(
      error(
        await provider.refund({
          paymentId,
          amount: money(1n, usd),
          idempotencyKey: "k2",
          reference: "r",
        })
      ).meta.details?.cause
    ).toBe("malformed");
    expect(
      error(
        await provider.refund({ paymentId, amount: money(1n), idempotencyKey: "k3", reference: "" })
      ).meta.details?.cause
    ).toBe("malformed");
    expect(
      error(
        await provider.refund({
          paymentId: "nope",
          amount: money(1n),
          idempotencyKey: "k4",
          reference: "r",
        })
      ).meta.reason
    ).toBe("invalid_request");
  });

  it("replays the same key, conflicts on a different request, and treats a new key as a new refund", async () => {
    const provider = memory();
    const paymentId = await captured(provider);
    const refund = {
      paymentId,
      amount: money(1_000n),
      idempotencyKey: "refund:r1",
      reference: "r1",
    };

    const first = value(await provider.refund(refund));
    expect(value(await provider.refund({ ...refund, reason: "ignored for equivalence" }))).toBe(
      first
    );
    expect(
      error(await provider.refund({ ...refund, amount: money(2_000n) })).meta.details?.cause
    ).toBe("request_mismatch");

    const second = value(
      await provider.refund({ ...refund, idempotencyKey: "refund:r2", reference: "r2" })
    );
    expect(second.refundId).toBe("mem_re_2");
  });

  it("completes an asynchronous refund only through a scripted transition", async () => {
    const provider = memory({ asynchronousRefund: true });
    const paymentId = await captured(provider);

    const pending = value(
      await provider.refund({
        paymentId,
        amount: money(10_000n),
        idempotencyKey: "k1",
        reference: "r1",
      })
    );
    expect(pending).toEqual({
      provider: "memory",
      paymentId,
      refundId: "mem_re_1",
      reference: "r1",
      status: "pending",
    });

    const blocked = value(
      await provider.refund({ paymentId, amount: money(1n), idempotencyKey: "k2", reference: "r2" })
    );
    expect(blocked.status).toBe("failed");

    const delivery = value(provider.settleRefund("mem_re_1", "succeeded"));
    expect(value(await provider.verify(delivery))).toEqual([
      {
        kind: "refund",
        provider: "memory",
        eventId: "mem_evt_1",
        paymentId,
        refundId: "mem_re_1",
        reference: "r1",
        status: "succeeded",
        amount: money(10_000n),
      },
    ]);
    expect(value(await provider.retrieveRefund("mem_re_1"))).toMatchObject({
      status: "succeeded",
      amount: money(10_000n),
    });
    expect(error(provider.settleRefund("mem_re_1", "failed")).meta.reason).toBe("invalid_request");
  });

  it("reports a failed asynchronous refund without an amount", async () => {
    const provider = memory({ asynchronousRefund: true });
    const paymentId = await captured(provider);
    value(
      await provider.refund({
        paymentId,
        amount: money(10_000n),
        idempotencyKey: "k1",
        reference: "r1",
      })
    );

    const [notification] = value(
      await provider.verify(value(provider.settleRefund("mem_re_1", "failed")))
    );
    expect(notification).toEqual({
      kind: "refund",
      provider: "memory",
      eventId: "mem_evt_1",
      paymentId,
      refundId: "mem_re_1",
      reference: "r1",
      status: "failed",
    });
    expect(value(await provider.retrieveRefund("mem_re_1"))).toEqual({
      provider: "memory",
      paymentId,
      refundId: "mem_re_1",
      reference: "r1",
      status: "failed",
    });
  });

  it("returns null when looking up an unknown refund", async () => {
    expect(value(await memory().retrieveRefund("mem_re_404"))).toBeNull();
  });
});

describe("MemoryPaymentProvider notifications and scripted payment transitions", () => {
  it("completes an incomplete payment and announces it", async () => {
    const provider = memory();
    value(await provider.initiate(request({ reference: "pending:att" })));

    const [notification] = value(
      await provider.verify(value(provider.settlePayment("mem_pay_1", "authorized")))
    );
    expect(notification).toEqual({
      kind: "payment",
      provider: "memory",
      eventId: "mem_evt_1",
      paymentId: "mem_pay_1",
      reference: "pending:att",
      state: "authorized",
      amount: money(10_000n),
    });
    expect(value(await provider.retrieve("mem_pay_1"))).toMatchObject({
      state: "authorized",
      authorizedAt: at,
    });
  });

  it("announces a failed payment without an amount", async () => {
    const provider = memory();
    value(await provider.initiate(request({ reference: "pending:att" })));

    const [notification] = value(
      await provider.verify(value(provider.settlePayment("mem_pay_1", "failed")))
    );
    expect(notification).toEqual({
      kind: "payment",
      provider: "memory",
      eventId: "mem_evt_1",
      paymentId: "mem_pay_1",
      reference: "pending:att",
      state: "failed",
    });
  });

  it("moves an automatic-capture authorization to captured", async () => {
    const provider = memory();
    value(await provider.initiate(request({ reference: "pending:att", capture: "automatic" })));
    value(provider.settlePayment("mem_pay_1", "authorized"));

    value(provider.settlePayment("mem_pay_1", "captured"));
    expect(value(await provider.retrieve("mem_pay_1"))).toMatchObject({
      state: "captured",
      capturedAt: at,
    });
  });

  it("refuses transitions the script does not allow", async () => {
    const provider = memory();
    const paymentId = await authorized(provider);

    expect(error(provider.settlePayment(paymentId, "captured")).meta.reason).toBe(
      "invalid_request"
    );
    expect(error(provider.settlePayment("nope", "failed")).meta.reason).toBe("invalid_request");
    expect(error(provider.settleOperation("nope", "failed")).meta.reason).toBe("invalid_request");
    expect(error(provider.settleRefund("nope", "failed")).meta.reason).toBe("invalid_request");
  });

  it("rejects a tampered, foreign or unsigned delivery as a signature failure", async () => {
    const provider = memory();
    value(await provider.initiate(request({ reference: "pending:att" })));
    const delivery = value(provider.settlePayment("mem_pay_1", "failed"));

    const tampered = new Uint8Array(delivery.body);
    tampered[0] = 0;
    const other = memory({ id: "memory-other" });
    value(await other.initiate(request({ reference: "pending:att" })));
    const foreign = value(other.settlePayment("mem_pay_1", "failed"));

    for (const input of [
      { body: tampered, headers: delivery.headers },
      { body: delivery.body, headers: {} },
      { body: delivery.body, headers: { "x-memory-delivery": "mem_dlv_404" } },
    ]) {
      const failure = error(await provider.verify(input));
      expect(failure.meta.reason).toBe("invalid_notification");
      expect(failure.meta.details?.cause).toBe("signature");
    }
    expect(error(await provider.verify(foreign)).meta.details?.cause).toBe("signature");
  });

  it("is deterministic: the same script yields the same identifiers and results", async () => {
    async function script(): Promise<unknown[]> {
      const provider = memory({ asynchronousCapture: true });
      const paymentId = await authorized(provider);
      const capture = value(
        await provider.capture({ paymentId, amount: money(10_000n), idempotencyKey: "c1" })
      );
      const delivery = value(provider.settleOperation("mem_op_1", "succeeded"));
      return [
        paymentId,
        capture,
        value(await provider.verify(delivery)),
        value(await provider.retrieve(paymentId)),
      ];
    }

    expect(await script()).toEqual(await script());
  });
});
