import { describe, expect, it } from "vitest";
import { failure, success } from "@comity/primitives/result";
import type { Result } from "@comity/primitives/result";

import type { PaymentProviderBinding } from "../contracts/payment-capabilities.js";
import type {
  PaymentNotification,
  PaymentNotificationDelivery,
  PaymentNotificationSubject,
} from "../contracts/payment-notification.js";
import { PaymentError } from "../errors/payment.js";
import {
  isPaymentNotificationVerifierConformant,
  runPaymentNotificationVerifierConformance,
} from "../index.js";
import type {
  MemoryPaymentMatrixRow,
  PaymentVerifierConformanceHarness,
  PaymentVerifierConformanceRequirement,
  PaymentVerifierConformanceResult,
  PaymentVerifierFixture,
  PaymentVerifierScenario,
} from "../index.js";
import { MemoryPaymentProvider } from "../providers/memory.js";

type VerifyResult = Result<ReadonlyArray<PaymentNotification>, PaymentError>;

const AMOUNT = { minor: "10000", currency: "EUR" };
const UNUSABLE = { minor: "not-a-number", currency: "EUR" };

function body(...events: ReadonlyArray<Readonly<Record<string, unknown>>>): string {
  return JSON.stringify({ events });
}

/** One wire body (and its expectations) per scenario, in the memory provider's documented mapping. */
const SCENARIOS: Readonly<
  Record<PaymentVerifierScenario, { body: string } & Omit<PaymentVerifierFixture, "delivery">>
> = {
  valid: {
    body: body({ type: "payment", paymentId: "mem_pay_1", state: "captured", amount: AMOUNT }),
  },
  "unmapped-event-type": { body: body({ type: "memory.unknown", paymentId: "mem_pay_1" }) },
  "undeterminable-events": { body: JSON.stringify({ events: [{ noType: true }] }) },
  "state-unmapped-value": {
    body: body({
      type: "payment",
      paymentId: "mem_pay_1",
      state: "refunded",
      reference: "att_1",
    }),
    subject: { kind: "payment", paymentId: "mem_pay_1", reference: "att_1" },
  },
  "state-missing-optional-fields": {
    body: body({ type: "payment", paymentId: "mem_pay_1", state: "captured", amount: AMOUNT }),
    kind: "payment",
  },
  "state-missing-required-field": {
    body: body({ type: "refund", refundId: "mem_re_1", paymentId: "mem_pay_1" }),
    subject: { kind: "refund", refundId: "mem_re_1", paymentId: "mem_pay_1" },
  },
  "state-missing-identifiers": {
    body: body({ type: "payment", state: "failed", reference: "att_1" }),
  },
  "several-representable": {
    body: body(
      { type: "payment", paymentId: "mem_pay_1", state: "captured", amount: AMOUNT },
      {
        type: "refund",
        refundId: "mem_re_1",
        paymentId: "mem_pay_1",
        status: "succeeded",
        amount: AMOUNT,
      },
      {
        type: "operation",
        operation: "capture",
        paymentId: "mem_pay_1",
        operationId: "mem_op_1",
        status: "succeeded",
      }
    ),
    identifiers: ["mem_pay_1", "mem_re_1", "mem_pay_1"],
  },
  "mixed-with-unrepresentable": {
    body: body(
      { type: "payment", paymentId: "mem_pay_1", state: "captured", amount: AMOUNT },
      { type: "payment", paymentId: "mem_pay_2", state: "authorized" }
    ),
    paymentId: "mem_pay_2",
  },
  "two-unrepresentable": {
    body: body(
      { type: "payment", paymentId: "mem_pay_3", state: "authorized" },
      {
        type: "refund",
        refundId: "mem_re_2",
        paymentId: "mem_pay_4",
        status: "succeeded",
        amount: UNUSABLE,
      }
    ),
    paymentId: "mem_pay_3",
  },
  "undetermined-kind": {
    body: body({ type: "notice", objectId: "mem_obj_1", reference: "att_1" }),
    subject: { kind: "payment_or_refund", providerId: "mem_obj_1", reference: "att_1" },
  },
  "possibly-operation": { body: body({ type: "operation_notice", objectId: "mem_obj_1" }) },
  "unrepresentable-payment": {
    body: body({ type: "payment", paymentId: "mem_pay_5", state: "authorized", amount: UNUSABLE }),
    paymentId: "mem_pay_5",
  },
  "unrepresentable-refund": {
    body: body({
      type: "refund",
      refundId: "mem_re_3",
      paymentId: "mem_pay_6",
      status: "succeeded",
    }),
    paymentId: "mem_pay_6",
    refundId: "mem_re_3",
  },
  "payment-success-missing-payment-id": {
    body: body({ type: "payment", state: "captured", amount: AMOUNT, reference: "att_1" }),
  },
  "refund-success-missing-refund-id": {
    body: body({ type: "refund", paymentId: "mem_pay_7", status: "succeeded", amount: AMOUNT }),
    subject: { kind: "payment", paymentId: "mem_pay_7" },
  },
  "payment-success-missing-payment-id-unusable-amount": {
    body: body({ type: "payment", state: "captured", amount: UNUSABLE }),
  },
  "refund-success-missing-refund-id-unusable-amount": {
    body: body({ type: "refund", paymentId: "mem_pay_7", status: "succeeded", amount: UNUSABLE }),
    subject: { kind: "payment", paymentId: "mem_pay_7" },
  },
  "signal-with-amount-like-fields": {
    body: body({
      type: "notice",
      objectId: "mem_obj_2",
      amount: AMOUNT,
      minor: "10000",
      total: 100,
      currency: "EUR",
    }),
    subject: { kind: "payment_or_refund", providerId: "mem_obj_2" },
  },
  "failure-unusable-amount": {
    body: body({ type: "payment", paymentId: "mem_pay_8", state: "failed", amount: UNUSABLE }),
    kind: "payment",
  },
  "pending-refund-unusable-amount": {
    body: body({
      type: "refund",
      refundId: "mem_re_4",
      paymentId: "mem_pay_9",
      status: "pending",
      amount: UNUSABLE,
    }),
    kind: "refund",
  },
};

/** The memory provider as the adapter under test; its scripted provider seam is `issueRaw`. */
function harnessFor(
  provider: MemoryPaymentProvider,
  overrides: Partial<PaymentVerifierConformanceHarness> & {
    unsupported?: ReadonlyArray<PaymentVerifierScenario>;
  } = {}
): PaymentVerifierConformanceHarness {
  const { unsupported = [], ...rest } = overrides;
  return {
    binding: provider.binding,
    async issue(scenario) {
      if (unsupported.includes(scenario)) return undefined;
      const { body: text, ...expectations } = SCENARIOS[scenario];
      return { delivery: provider.issueRaw(text), ...expectations };
    },
    async breakAuthenticity(delivery) {
      return { ...delivery, body: new Uint8Array([...delivery.body, 0x20]) };
    },
    async withoutAuthenticity(delivery) {
      return { body: delivery.body, headers: {} };
    },
    ...rest,
  };
}

function withVerify(
  provider: MemoryPaymentProvider,
  verify: (delivery: PaymentNotificationDelivery) => Promise<VerifyResult>
): PaymentProviderBinding {
  return { ...provider.binding, notifications: { verify } };
}

function statusOf(
  results: ReadonlyArray<PaymentVerifierConformanceResult>,
  requirement: PaymentVerifierConformanceRequirement
): string | undefined {
  return results.find((r) => r.requirement === requirement)?.status;
}

const IDS: ReadonlyArray<PaymentVerifierConformanceRequirement> = [
  "VC-1",
  "VC-2",
  "VC-3",
  "VC-4",
  "VC-5",
  "VC-7",
  "VC-8",
  "VC-9",
  "VC-10",
  "VC-12",
  "VC-13",
  "VC-14",
  "VC-15",
  "VC-16",
  "VC-17",
  "VC-18",
  "VC-19",
];

function error(result: VerifyResult): PaymentError {
  if (result.success) throw new Error("expected a failure");
  return result.error;
}

function value(result: VerifyResult): ReadonlyArray<PaymentNotification> {
  if (!result.success) throw new Error(`unexpected ${result.error.code}`);
  return result.value;
}

describe("PaymentNotification contract (AMT-1, AMT-5)", () => {
  it("types an `other` notification without an eventId", () => {
    const notification: PaymentNotification = {
      kind: "other",
      provider: "p",
      providerEventType: "ORDER_COMPLETED",
    };

    expect(notification.eventId).toBeUndefined();
  });

  it("types every subject variant, each with an optional reference", () => {
    const subjects: ReadonlyArray<PaymentNotificationSubject> = [
      { kind: "payment", paymentId: "pay_1" },
      { kind: "payment", paymentId: "pay_1", reference: "att_1" },
      { kind: "refund", refundId: "re_1" },
      { kind: "refund", refundId: "re_1", paymentId: "pay_1", reference: "att_1" },
      { kind: "payment_or_refund", providerId: "obj_1" },
      { kind: "payment_or_refund", providerId: "obj_1", reference: "att_1" },
    ];
    const notifications: ReadonlyArray<PaymentNotification> = subjects.map((subject) => ({
      kind: "other",
      provider: "p",
      providerEventType: "event",
      subject,
    }));

    expect(notifications.map((n) => (n.kind === "other" ? n.subject?.kind : undefined))).toEqual([
      "payment",
      "payment",
      "refund",
      "refund",
      "payment_or_refund",
      "payment_or_refund",
    ]);
  });
});

describe("MemoryPaymentProvider: documented event mapping", () => {
  const provider = new MemoryPaymentProvider();

  async function verifyBody(text: string): Promise<VerifyResult> {
    return provider.verify(provider.issueRaw(text));
  }

  it("never sets eventId unless the event supplies a non-empty one, and copies it unchanged", async () => {
    const [bare, supplied, empty] = value(
      await verifyBody(
        body(
          { type: "memory.unknown" },
          { type: "memory.unknown", eventId: "evt-A b" },
          { type: "memory.unknown", eventId: "" }
        )
      )
    );

    expect(bare).toEqual({
      kind: "other",
      provider: "memory",
      providerEventType: "memory.unknown",
    });
    expect(supplied?.eventId).toBe("evt-A b");
    expect(empty).not.toHaveProperty("eventId");
  });

  it("keeps the order of events and the echoed reference", async () => {
    const notifications = value(
      await verifyBody(
        body(
          { type: "payment", paymentId: "p1", state: "failed", reference: "att_1" },
          { type: "refund", refundId: "r1", paymentId: "p1", status: "pending" }
        )
      )
    );

    expect(notifications).toEqual([
      { kind: "payment", provider: "memory", paymentId: "p1", reference: "att_1", state: "failed" },
      { kind: "refund", provider: "memory", paymentId: "p1", refundId: "r1", status: "pending" },
    ]);
  });

  it("returns an empty delivery as success with no notifications", async () => {
    expect(value(await verifyBody(body()))).toEqual([]);
  });

  it.each([
    ["not JSON", "{"],
    ["no events array", JSON.stringify({ events: "x" })],
    ["a non-object event", JSON.stringify({ events: [1] })],
    ["an event without a type", JSON.stringify({ events: [{ paymentId: "p" }] })],
    ["a non-string type", JSON.stringify({ events: [{ type: 3 }] })],
  ])("treats %s as malformed when authentic", async (_name, text) => {
    const failure = error(await verifyBody(text));

    expect(failure.meta.reason).toBe("invalid_notification");
    expect(failure.meta.details?.cause).toBe("malformed");
  });

  it("raises case B for a settled success whose schema-declared amount is absent or unusable", async () => {
    const absent = error(
      await verifyBody(body({ type: "payment", paymentId: "p1", state: "authorized" }))
    );
    const unusable = error(
      await verifyBody(
        body({
          type: "refund",
          refundId: "r1",
          paymentId: "p1",
          status: "succeeded",
          amount: { minor: "-1", currency: "EUR" },
          eventId: "evt-1",
          reference: "att_1",
        })
      )
    );

    expect(absent.meta.reason).toBe("unrepresentable_success");
    expect(absent.meta.details).toEqual({ scope: "payment", provider: "memory", paymentId: "p1" });
    expect(unusable.meta.details).toEqual({
      scope: "refund",
      provider: "memory",
      paymentId: "p1",
      refundId: "r1",
      reference: "att_1",
      eventId: "evt-1",
    });
    expect(unusable.cause).toBeDefined();
  });

  it("classifies an unusable amount on an unsettled event, and omits an absent one", async () => {
    const [unusable, absent] = value(
      await verifyBody(
        body(
          { type: "payment", paymentId: "p1", state: "cancelled", amount: UNUSABLE },
          { type: "payment", paymentId: "p1", state: "cancelled" }
        )
      )
    );

    expect(unusable).toMatchObject({ providerAmountUnusable: true });
    expect(unusable).not.toHaveProperty("amount");
    expect(absent).not.toHaveProperty("providerAmountUnusable");
  });

  it("builds the narrowest truthful subject and never from a reference alone", async () => {
    const notifications = value(
      await verifyBody(
        body(
          { type: "refund", refundId: "r1", status: "pending", reference: "att_2" },
          { type: "refund", paymentId: "p1", status: "pending" },
          { type: "operation", paymentId: "p1", operation: "capture" },
          { type: "operation", operationId: "op1", reference: "att_3" },
          { type: "payment", state: "failed", reference: "att_1" }
        )
      )
    );

    expect(
      notifications.map((n) => (n.kind === "other" ? (n.subject ?? null) : "not-other"))
    ).toEqual([
      { kind: "refund", refundId: "r1", reference: "att_2" },
      { kind: "payment", paymentId: "p1" },
      { kind: "payment", paymentId: "p1" },
      null,
      null,
    ]);
  });

  it("fails an authentic delivery as a whole at the first case B event, even after others", async () => {
    const failure = error(
      await verifyBody(
        body(
          { type: "payment", paymentId: "p1", state: "captured", amount: AMOUNT },
          { type: "payment", paymentId: "p2", state: "captured" },
          { type: "payment", paymentId: "p3", state: "captured" }
        )
      )
    );

    expect(failure.meta.details?.paymentId).toBe("p2");
  });

  it("lets malformed win over case B, and signature win over both", async () => {
    const mixed = body({ type: "payment", paymentId: "p2", state: "captured" });
    const malformed = JSON.stringify({
      events: [{ type: "payment", paymentId: "p2", state: "captured" }, { noType: true }],
    });

    expect(error(await verifyBody(malformed)).meta.details?.cause).toBe("malformed");
    expect(error(await verifyBody(mixed)).meta.reason).toBe("unrepresentable_success");
    const delivery = provider.issueRaw(malformed);
    const tampered = { ...delivery, body: new Uint8Array([...delivery.body, 0x20]) };
    expect(error(await provider.verify(tampered)).meta.details?.cause).toBe("signature");
  });
});

describe("MemoryPaymentProvider.issueMatrixRow: every row of the consolidated table", () => {
  async function run(row: MemoryPaymentMatrixRow): Promise<VerifyResult> {
    const provider = new MemoryPaymentProvider();
    return provider.verify(provider.issueMatrixRow(row));
  }

  it("row 1: authenticity not established is `signature`", async () => {
    const failure = error(await run(1));

    expect(failure.meta.reason).toBe("invalid_notification");
    expect(failure.meta.details?.cause).toBe("signature");
  });

  it("row 2: authentic, undeterminable events is `malformed`", async () => {
    expect(error(await run(2)).meta.details?.cause).toBe("malformed");
  });

  it("rows 3 and 13: a state event with optional fields missing keeps its kind, without an eventId", async () => {
    for (const row of [3, 13] as const) {
      const [notification] = value(await run(row));

      expect(notification).toMatchObject({ kind: "payment", state: "captured" });
      expect(notification).not.toHaveProperty("eventId");
    }
  });

  it("row 4: a confirmed failure with an unusable amount carries providerAmountUnusable", async () => {
    expect(value(await run(4))).toEqual([
      {
        kind: "payment",
        provider: "memory",
        paymentId: "mem_pay_row",
        state: "failed",
        providerAmountUnusable: true,
      },
    ]);
  });

  it("row 5: a signal event is `other` with its subject", async () => {
    expect(value(await run(5))).toEqual([
      {
        kind: "other",
        provider: "memory",
        providerEventType: "notice",
        subject: { kind: "payment_or_refund", providerId: "mem_obj_row", reference: "att-row" },
      },
    ]);
  });

  it("row 6: an unmapped event type is `other` without subject", async () => {
    expect(value(await run(6))).toEqual([
      { kind: "other", provider: "memory", providerEventType: "memory.unmapped" },
    ]);
  });

  it("row 7: a settled success missing its identifier is `other`, not `malformed`", async () => {
    expect(value(await run(7))).toEqual([
      { kind: "other", provider: "memory", providerEventType: "payment" },
    ]);
  });

  it("row 8: an identifier that may be an operation forms no subject", async () => {
    expect(value(await run(8))).toEqual([
      { kind: "other", provider: "memory", providerEventType: "operation_notice" },
    ]);
  });

  it("row 9: a settled success with an absent amount is `unrepresentable_success`", async () => {
    const failure = error(await run(9));

    expect(failure.meta.reason).toBe("unrepresentable_success");
    expect(failure.meta.details).toMatchObject({
      provider: "memory",
      scope: "payment",
      paymentId: "mem_pay_row",
    });
  });

  it("row 10: several representable events are all returned in order", async () => {
    expect(value(await run(10)).map((n) => n.kind)).toEqual(["payment", "refund"]);
  });

  it("row 11: one case B event fails the whole delivery", async () => {
    expect(error(await run(11)).meta.reason).toBe("unrepresentable_success");
  });

  it("row 12: a delivery verifying to a foreign provider (a deliberate fault)", async () => {
    const notifications = value(await run(12));

    expect(notifications.map((n) => n.provider)).toEqual(["mem_foreign"]);
  });
});

describe("runPaymentNotificationVerifierConformance", () => {
  it("passes VC-1 to VC-5, VC-7 to VC-10 and VC-12 to VC-19 on the memory provider", async () => {
    const results = await runPaymentNotificationVerifierConformance(
      harnessFor(new MemoryPaymentProvider())
    );

    expect(results.map((r) => r.requirement)).toEqual(IDS);
    expect(results.filter((r) => r.status !== "passed")).toEqual([]);
    expect(isPaymentNotificationVerifierConformant(results)).toBe(true);
  });

  it("reports every requirement `not_applicable`, and not conformant, without a notifications port", async () => {
    const provider = new MemoryPaymentProvider();
    const { notifications: _removed, ...rest } = provider.binding;
    const binding: PaymentProviderBinding = {
      ...rest,
      capabilities: { ...provider.binding.capabilities, notifications: false },
    };
    const results = await runPaymentNotificationVerifierConformance(
      harnessFor(provider, { binding })
    );

    expect(results.every((r) => r.status === "not_applicable")).toBe(true);
    expect(isPaymentNotificationVerifierConformant(results)).toBe(false);
  });

  it("marks requirements `not_applicable` when the mapping has no state events (a signal-only adapter)", async () => {
    const results = await runPaymentNotificationVerifierConformance(
      harnessFor(new MemoryPaymentProvider(), {
        unsupported: [
          "state-unmapped-value",
          "state-missing-optional-fields",
          "state-missing-required-field",
          "state-missing-identifiers",
          "several-representable",
          "mixed-with-unrepresentable",
          "two-unrepresentable",
          "unrepresentable-payment",
          "unrepresentable-refund",
          "payment-success-missing-payment-id",
          "refund-success-missing-refund-id",
          "payment-success-missing-payment-id-unusable-amount",
          "refund-success-missing-refund-id-unusable-amount",
          "failure-unusable-amount",
          "pending-refund-unusable-amount",
        ],
      })
    );

    for (const id of [
      "VC-7",
      "VC-8",
      "VC-9",
      "VC-10",
      "VC-12",
      "VC-13",
      "VC-15",
      "VC-17",
      "VC-19",
    ] as const) {
      expect(statusOf(results, id)).toBe("not_applicable");
    }
    for (const id of ["VC-1", "VC-2", "VC-3", "VC-4", "VC-5", "VC-14", "VC-16", "VC-18"] as const) {
      expect(statusOf(results, id)).toBe("passed");
    }
    expect(isPaymentNotificationVerifierConformant(results)).toBe(true);
  });

  it("fails VC-1 and VC-16 for a verifier that accepts a broken signature", async () => {
    const provider = new MemoryPaymentProvider();
    const results = await runPaymentNotificationVerifierConformance(
      harnessFor(provider, {
        binding: withVerify(provider, async (delivery) =>
          provider.verify(provider.issueRaw(new TextDecoder().decode(delivery.body)))
        ),
      })
    );

    expect(statusOf(results, "VC-1")).toBe("failed");
    expect(statusOf(results, "VC-3")).toBe("failed");
    expect(statusOf(results, "VC-16")).toBe("failed");
    expect(statusOf(results, "VC-4")).toBe("passed");
    expect(isPaymentNotificationVerifierConformant(results)).toBe(false);
  });

  it("fails VC-2 for a verifier that reports `signature` for an authentic undeterminable delivery", async () => {
    const provider = new MemoryPaymentProvider();
    const results = await runPaymentNotificationVerifierConformance(
      harnessFor(provider, {
        binding: withVerify(provider, async (delivery) => {
          const verified = await provider.verify(delivery);
          return !verified.success && verified.error.meta.details?.cause === "malformed"
            ? failure(new PaymentError("invalid_notification", { details: { cause: "signature" } }))
            : verified;
        }),
      })
    );

    expect(statusOf(results, "VC-2")).toBe("failed");
    expect(statusOf(results, "VC-1")).toBe("passed");
  });

  it("fails VC-17 for a verifier that reports `malformed` for an identifiable event missing its identifier", async () => {
    const provider = new MemoryPaymentProvider();
    const results = await runPaymentNotificationVerifierConformance(
      harnessFor(provider, {
        binding: withVerify(provider, async (delivery) => {
          const verified = await provider.verify(delivery);
          return verified.success && verified.value.some((n) => n.kind === "other" && !n.subject)
            ? failure(new PaymentError("invalid_notification", { details: { cause: "malformed" } }))
            : verified;
        }),
      })
    );

    expect(statusOf(results, "VC-17")).toBe("failed");
    expect(statusOf(results, "VC-10")).toBe("failed");
    expect(statusOf(results, "VC-12")).toBe("passed");
  });

  it("fails VC-5 for a verifier that makes an outbound call", async () => {
    const provider = new MemoryPaymentProvider();
    const results = await runPaymentNotificationVerifierConformance(
      harnessFor(provider, {
        binding: withVerify(provider, async (delivery) => {
          await fetch("https://provider.invalid/keys").catch(() => undefined);
          return provider.verify(delivery);
        }),
      })
    );

    expect(statusOf(results, "VC-5")).toBe("failed");
    expect(statusOf(results, "VC-4")).toBe("passed");
  });

  it("restores the global fetch after the run", async () => {
    const before = globalThis.fetch;
    await runPaymentNotificationVerifierConformance(harnessFor(new MemoryPaymentProvider()));

    expect(globalThis.fetch).toBe(before);
  });

  it("fails VC-13 and VC-15 for case B details of the wrong provider or event", async () => {
    const provider = new MemoryPaymentProvider();
    const results = await runPaymentNotificationVerifierConformance(
      harnessFor(provider, {
        binding: withVerify(provider, async (delivery) => {
          const verified = await provider.verify(delivery);
          return !verified.success && verified.error.meta.reason === "unrepresentable_success"
            ? failure(
                new PaymentError("unrepresentable_success", {
                  details: { scope: "payment", provider: "someone-else", paymentId: "mem_pay_1" },
                })
              )
            : verified;
        }),
      })
    );

    expect(statusOf(results, "VC-13")).toBe("failed");
    expect(statusOf(results, "VC-15")).toBe("failed");
    expect(statusOf(results, "VC-19")).toBe("passed");
  });

  it("fails VC-14 for a guessed payment subject and VC-18 for a state kind from a signal", async () => {
    const provider = new MemoryPaymentProvider();
    const results = await runPaymentNotificationVerifierConformance(
      harnessFor(provider, {
        binding: withVerify(provider, async (delivery) => {
          const verified = await provider.verify(delivery);
          if (!verified.success) return verified;
          return success(
            verified.value.map((n): PaymentNotification => {
              if (n.kind !== "other" || n.subject?.kind !== "payment_or_refund") return n;
              return {
                kind: "payment",
                provider: n.provider,
                paymentId: n.subject.providerId,
                state: "failed",
              };
            })
          );
        }),
      })
    );

    expect(statusOf(results, "VC-14")).toBe("failed");
    expect(statusOf(results, "VC-18")).toBe("failed");
  });

  it("fails VC-8 and VC-19 for a verifier that downgrades state events to `other`", async () => {
    const provider = new MemoryPaymentProvider();
    const results = await runPaymentNotificationVerifierConformance(
      harnessFor(provider, {
        binding: withVerify(provider, async (delivery) => {
          const verified = await provider.verify(delivery);
          return verified.success
            ? success(
                verified.value.map((n): PaymentNotification =>
                  n.kind === "operation" || n.kind === "other"
                    ? n
                    : { kind: "other", provider: n.provider, providerEventType: n.kind }
                )
              )
            : verified;
        }),
      })
    );

    expect(statusOf(results, "VC-8")).toBe("failed");
    expect(statusOf(results, "VC-19")).toBe("failed");
    expect(statusOf(results, "VC-12")).toBe("failed");
  });

  it("fails a requirement whose verifier throws instead of aborting the run", async () => {
    const provider = new MemoryPaymentProvider();
    const results = await runPaymentNotificationVerifierConformance(
      harnessFor(provider, {
        binding: withVerify(provider, async () => {
          throw new Error("boom");
        }),
      })
    );

    expect(results).toHaveLength(IDS.length);
    expect(statusOf(results, "VC-4")).toBe("failed");
    expect(results.find((r) => r.requirement === "VC-4")?.detail).toContain("boom");
  });
});
