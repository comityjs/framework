import { describe, expect, it } from "vitest";
import type { Result } from "@comity/primitives/result";
import { success } from "@comity/primitives/result";
import { Currency, Money } from "@comity/pricing";

import type { PaymentProviderBinding } from "../contracts/payment-capabilities.js";
import type { PaymentNotification } from "../contracts/payment-notification.js";
import type { PaymentOperationOutcome } from "../contracts/payment-outcome.js";
import type { PaymentError } from "../errors/payment.js";
import {
  isPaymentOperationConformant,
  runPaymentOperationConformance,
  validatePaymentProviderBinding,
} from "../index.js";
import type {
  PaymentConformanceRequirement,
  PaymentConformanceResult,
  PaymentOperationConformanceHarness,
} from "../index.js";
import { MemoryPaymentProvider } from "../providers/memory.js";
import type { MemoryPaymentProviderOptions } from "../providers/memory.js";

function value<T>(result: Result<T, PaymentError>): T {
  if (!result.success) throw new Error(`unexpected ${result.error.code}`);
  return result.value;
}

function pricing<T>(result: { success: true; value: T } | { success: false; error: unknown }): T {
  if (!result.success) throw new Error("invalid pricing fixture");
  return result.value;
}

const amount = pricing(Money.create(10_000n, pricing(Currency.create("EUR"))));

const C10: ReadonlyArray<PaymentConformanceRequirement> = [
  "C-10/capture-pending-has-operation-id",
  "C-10/cancel-pending-has-operation-id",
  "C-10/pending-operations-have-distinct-ids",
  "C-10/operation-notification-has-operation-id",
  "C-10/notification-correlates-to-operation",
  "C-10/retrieve-operation-returns-operation",
  "C-10/retrieve-operation-unknown-is-null",
  "C-10/declared-asynchronous-operations-are-covered",
];

/**
 * The real adapter under test is the in-memory provider; the scripted provider seam is its own `settleOperation`.
 * `preparePayment` and `completeOperation` only drive provider-side state: every command result comes from the
 * binding's ports, invoked by the runner.
 */
function harnessFor(
  provider: MemoryPaymentProvider,
  binding: PaymentProviderBinding = provider.binding
): PaymentOperationConformanceHarness {
  let prepared = 0;
  return {
    binding,
    async preparePayment() {
      prepared += 1;
      const outcome = value(
        await provider.initiate({
          amount,
          idempotencyKey: `prepare-${prepared}`,
          reference: `att-${prepared}`,
          capture: "manual",
        })
      );
      if (outcome.state !== "authorized")
        throw new Error("the scripted provider did not authorize");
      return { paymentId: outcome.paymentId, amount: outcome.amount };
    },
    async completeOperation(operation) {
      return value(provider.settleOperation(String(operation.operationId), "succeeded"));
    },
  };
}

const asyncBoth: MemoryPaymentProviderOptions = {
  asynchronousCapture: true,
  asynchronousCancel: true,
};

function statusOf(
  results: ReadonlyArray<PaymentConformanceResult>,
  requirement: PaymentConformanceRequirement
) {
  return results.find((r) => r.requirement === requirement)?.status;
}

function failedOf(
  results: ReadonlyArray<PaymentConformanceResult>
): PaymentConformanceRequirement[] {
  return results.filter((r) => r.status === "failed").map((r) => r.requirement);
}

/** Rebuilds an operation result without its operation identifier (exactOptionalPropertyTypes forbids `undefined`). */
function withoutOperationId(outcome: PaymentOperationOutcome): PaymentOperationOutcome {
  const base = { provider: outcome.provider, paymentId: outcome.paymentId };
  if (outcome.operation === "cancel")
    return { ...base, operation: "cancel", status: outcome.status };
  return outcome.status === "succeeded"
    ? { ...base, operation: "capture", status: "succeeded" }
    : { ...base, operation: "capture", status: outcome.status };
}

type Transform = (outcome: PaymentOperationOutcome) => PaymentOperationOutcome;

function mapResult(
  result: Result<PaymentOperationOutcome, PaymentError>,
  transform: Transform
): Result<PaymentOperationOutcome, PaymentError> {
  return result.success ? success(transform(result.value)) : result;
}

/** A defective adapter: the real command ports with their results altered. */
function alterCommands(
  binding: PaymentProviderBinding,
  transform: Transform
): PaymentProviderBinding {
  const { capture, cancel } = binding;
  return {
    ...binding,
    ...(capture
      ? { capture: { capture: async (r) => mapResult(await capture.capture(r), transform) } }
      : {}),
    ...(cancel
      ? { cancel: { cancel: async (r) => mapResult(await cancel.cancel(r), transform) } }
      : {}),
  };
}

/** A defective adapter: the real verifier with its operation notifications altered. */
function alterNotifications(
  binding: PaymentProviderBinding,
  transform: (n: Extract<PaymentNotification, { kind: "operation" }>) => PaymentNotification
): PaymentProviderBinding {
  const verifier = binding.notifications;
  if (!verifier) throw new Error("fixture has no verifier");
  return {
    ...binding,
    notifications: {
      async verify(input) {
        const result = await verifier.verify(input);
        return result.success
          ? success(result.value.map((n) => (n.kind === "operation" ? transform(n) : n)))
          : result;
      },
    },
  };
}

/** A defective adapter: the real operation lookup replaced. */
function alterLookup(
  binding: PaymentProviderBinding,
  retrieveOperation: (
    operationId: string
  ) => Promise<Result<PaymentOperationOutcome | null, PaymentError>>
): PaymentProviderBinding {
  return { ...binding, operations: { retrieveOperation } };
}

describe("runPaymentOperationConformance: conformant adapters", () => {
  it("reports static validation, then every C-10 requirement in a stable order", async () => {
    const results = await runPaymentOperationConformance(
      harnessFor(new MemoryPaymentProvider(asyncBoth))
    );

    expect(results.map((r) => r.requirement)).toEqual(["binding-static-validation", ...C10]);
    expect(results.every((r) => r.status === "passed")).toBe(true);
    expect(isPaymentOperationConformant(results)).toBe(true);
  });

  it("treats a valid synchronous binding as not applicable, never as passed", async () => {
    const results = await runPaymentOperationConformance(harnessFor(new MemoryPaymentProvider()));

    expect(statusOf(results, "binding-static-validation")).toBe("passed");
    for (const requirement of C10) expect(statusOf(results, requirement)).toBe("not_applicable");
    expect(isPaymentOperationConformant(results)).toBe(true);
  });

  it("covers an adapter with asynchronous capture only", async () => {
    const results = await runPaymentOperationConformance(
      harnessFor(new MemoryPaymentProvider({ asynchronousCapture: true }))
    );

    expect(statusOf(results, "C-10/capture-pending-has-operation-id")).toBe("passed");
    expect(statusOf(results, "C-10/cancel-pending-has-operation-id")).toBe("not_applicable");
    expect(failedOf(results)).toEqual([]);
    expect(statusOf(results, "C-10/declared-asynchronous-operations-are-covered")).toBe("passed");
  });

  it("covers an adapter with asynchronous cancellation only", async () => {
    const results = await runPaymentOperationConformance(
      harnessFor(new MemoryPaymentProvider({ asynchronousCancel: true }))
    );

    expect(statusOf(results, "C-10/capture-pending-has-operation-id")).toBe("not_applicable");
    expect(statusOf(results, "C-10/cancel-pending-has-operation-id")).toBe("passed");
    expect(failedOf(results)).toEqual([]);
  });

  it("marks the notification requirements not applicable when notifications are not declared", async () => {
    const provider = new MemoryPaymentProvider(asyncBoth);
    const { notifications: _omitted, ...rest } = provider.binding;
    const binding: PaymentProviderBinding = {
      ...rest,
      capabilities: { ...provider.binding.capabilities, notifications: false },
    };
    const results = await runPaymentOperationConformance(harnessFor(provider, binding));

    expect(statusOf(results, "C-10/operation-notification-has-operation-id")).toBe(
      "not_applicable"
    );
    expect(statusOf(results, "C-10/notification-correlates-to-operation")).toBe("not_applicable");
    expect(isPaymentOperationConformant(results)).toBe(true);
  });

  it("is deterministic", async () => {
    const first = await runPaymentOperationConformance(
      harnessFor(new MemoryPaymentProvider(asyncBoth))
    );
    const second = await runPaymentOperationConformance(
      harnessFor(new MemoryPaymentProvider(asyncBoth))
    );

    expect(second).toEqual(first);
  });
});

describe("runPaymentOperationConformance: static validation first (F-05)", () => {
  it("fails a statically invalid binding with its rules and evaluates no C-10 requirement", async () => {
    const provider = new MemoryPaymentProvider(asyncBoth);
    const { operations: _omitted, ...rest } = provider.binding;
    const results = await runPaymentOperationConformance(harnessFor(provider, rest));

    const [first, ...others] = results;
    expect(first?.requirement).toBe("binding-static-validation");
    expect(first?.status).toBe("failed");
    expect(first?.violations?.map((v) => v.rule)).toEqual(["C-1"]);
    expect(first?.detail).toContain("C-1");
    expect(others.map((r) => r.requirement)).toEqual(C10);
    expect(others.every((r) => r.status === "not_evaluated")).toBe(true);
    expect(isPaymentOperationConformant(results)).toBe(false);
  });

  it("reports every violated rule, including C-4 and C-11", async () => {
    const provider = new MemoryPaymentProvider(asyncBoth);
    const { operations: _omitted, ...rest } = provider.binding;
    const binding: PaymentProviderBinding = {
      ...rest,
      capabilities: {
        ...provider.binding.capabilities,
        operationLookup: false,
        incompleteResolution: false,
      },
    };
    const [first] = await runPaymentOperationConformance(harnessFor(provider, binding));

    expect(first?.violations?.map((v) => v.rule)).toEqual(["C-4", "C-11"]);
  });

  it("never runs the command ports of an invalid binding", async () => {
    const provider = new MemoryPaymentProvider(asyncBoth);
    let invoked = 0;
    const binding: PaymentProviderBinding = {
      ...alterCommands(provider.binding, (o) => {
        invoked += 1;
        return o;
      }),
      capabilities: { ...provider.binding.capabilities, idempotencyRetentionSeconds: 0 },
    };
    await runPaymentOperationConformance(harnessFor(provider, binding));

    expect(invoked).toBe(0);
  });
});

describe("runPaymentOperationConformance: defects are attributed to the requirement they break", () => {
  it("fails a pending capture without operationId", async () => {
    const provider = new MemoryPaymentProvider(asyncBoth);
    const binding = alterCommands(provider.binding, (o) =>
      o.operation === "capture" ? withoutOperationId(o) : o
    );
    const results = await runPaymentOperationConformance(harnessFor(provider, binding));

    expect(statusOf(results, "C-10/capture-pending-has-operation-id")).toBe("failed");
    expect(statusOf(results, "C-10/cancel-pending-has-operation-id")).toBe("passed");
    expect(statusOf(results, "C-10/declared-asynchronous-operations-are-covered")).toBe("failed");
    expect(isPaymentOperationConformant(results)).toBe(false);
  });

  it("fails a pending cancel with an empty operationId", async () => {
    const provider = new MemoryPaymentProvider(asyncBoth);
    const binding = alterCommands(provider.binding, (o) =>
      o.operation === "cancel" ? { ...o, operationId: "" } : o
    );
    const results = await runPaymentOperationConformance(harnessFor(provider, binding));

    expect(statusOf(results, "C-10/cancel-pending-has-operation-id")).toBe("failed");
    expect(statusOf(results, "C-10/capture-pending-has-operation-id")).toBe("passed");
  });

  it("fails duplicate operation identifiers on one payment", async () => {
    const provider = new MemoryPaymentProvider(asyncBoth);
    const binding = alterCommands(provider.binding, (o) => ({
      ...o,
      operationId: `dup-${o.paymentId}`,
    }));
    const results = await runPaymentOperationConformance(harnessFor(provider, binding));

    expect(statusOf(results, "C-10/pending-operations-have-distinct-ids")).toBe("failed");
    expect(statusOf(results, "C-10/capture-pending-has-operation-id")).toBe("passed");
  });

  it("fails an operation notification without operationId", async () => {
    const provider = new MemoryPaymentProvider(asyncBoth);
    const binding = alterNotifications(provider.binding, (n) => ({ ...n, operationId: "" }));
    const results = await runPaymentOperationConformance(harnessFor(provider, binding));

    expect(statusOf(results, "C-10/operation-notification-has-operation-id")).toBe("failed");
    expect(statusOf(results, "C-10/notification-correlates-to-operation")).toBe("failed");
    expect(statusOf(results, "C-10/retrieve-operation-returns-operation")).toBe("passed");
  });

  it("fails a notification that identifies another operation", async () => {
    const provider = new MemoryPaymentProvider(asyncBoth);
    const binding = alterNotifications(provider.binding, (n) => ({
      ...n,
      operationId: "mem_op_other",
    }));
    const results = await runPaymentOperationConformance(harnessFor(provider, binding));

    expect(statusOf(results, "C-10/operation-notification-has-operation-id")).toBe("passed");
    expect(statusOf(results, "C-10/notification-correlates-to-operation")).toBe("failed");
  });

  it("fails when the verified delivery contains no operation notification", async () => {
    const provider = new MemoryPaymentProvider(asyncBoth);
    const binding = alterNotifications(provider.binding, (n) => ({
      kind: "other",
      provider: n.provider,
      eventId: n.eventId,
      providerEventType: "operation",
    }));
    const results = await runPaymentOperationConformance(harnessFor(provider, binding));

    expect(statusOf(results, "C-10/operation-notification-has-operation-id")).toBe("failed");
  });

  it("fails a lookup that returns another operation", async () => {
    const provider = new MemoryPaymentProvider(asyncBoth);
    const binding = alterLookup(provider.binding, async (id) => {
      const found = await provider.retrieveOperation(id);
      return found.success && found.value
        ? success({ ...found.value, paymentId: "mem_pay_other" })
        : found;
    });
    const results = await runPaymentOperationConformance(harnessFor(provider, binding));

    expect(statusOf(results, "C-10/retrieve-operation-returns-operation")).toBe("failed");
    expect(statusOf(results, "C-10/retrieve-operation-unknown-is-null")).toBe("passed");
  });

  it("fails a lookup that returns null for a known operation", async () => {
    const provider = new MemoryPaymentProvider(asyncBoth);
    const binding = alterLookup(provider.binding, async () => success(null));
    const results = await runPaymentOperationConformance(harnessFor(provider, binding));

    expect(statusOf(results, "C-10/retrieve-operation-returns-operation")).toBe("failed");
    expect(statusOf(results, "C-10/retrieve-operation-unknown-is-null")).toBe("passed");
  });

  it("fails a lookup that answers for an unknown operation", async () => {
    const provider = new MemoryPaymentProvider(asyncBoth);
    const binding = alterLookup(provider.binding, async (id) => {
      const found = await provider.retrieveOperation(id);
      return found.success && found.value === null ? provider.retrieveOperation("mem_op_1") : found;
    });
    const results = await runPaymentOperationConformance(harnessFor(provider, binding));

    expect(statusOf(results, "C-10/retrieve-operation-unknown-is-null")).toBe("failed");
    expect(statusOf(results, "C-10/retrieve-operation-returns-operation")).toBe("passed");
  });

  it("fails, rather than skips, a declared notification path the harness cannot exercise", async () => {
    const provider = new MemoryPaymentProvider(asyncBoth);
    const { completeOperation: _omitted, ...harness } = harnessFor(provider);
    const results = await runPaymentOperationConformance(harness);

    expect(statusOf(results, "C-10/operation-notification-has-operation-id")).toBe("failed");
    expect(statusOf(results, "C-10/notification-correlates-to-operation")).toBe("failed");
    expect(isPaymentOperationConformant(results)).toBe(false);
  });

  it("fails a command port that returns an error instead of a pending result", async () => {
    const provider = new MemoryPaymentProvider({ asynchronousCapture: true });
    const results = await runPaymentOperationConformance({
      ...harnessFor(provider),
      async preparePayment() {
        return { paymentId: "mem_pay_unknown", amount };
      },
    });

    const capture = results.find((r) => r.requirement === "C-10/capture-pending-has-operation-id");
    expect(capture?.status).toBe("failed");
    expect(capture?.detail).toContain("payment:invalid_request");
  });

  it("fails a synchronous result from an operation declared asynchronous", async () => {
    const provider = new MemoryPaymentProvider();
    const binding: PaymentProviderBinding = {
      ...provider.binding,
      capabilities: { ...provider.binding.capabilities, manualCapture: { asynchronous: true } },
    };
    const results = await runPaymentOperationConformance(harnessFor(provider, binding));

    const capture = results.find((r) => r.requirement === "C-10/capture-pending-has-operation-id");
    expect(capture?.status).toBe("failed");
    expect(capture?.detail).toContain("capture succeeded");
  });
});

describe("runPaymentOperationConformance: exceptions and evidence", () => {
  it("records an exception from the scripted provider as a failure of the affected requirement", async () => {
    const provider = new MemoryPaymentProvider(asyncBoth);
    const results = await runPaymentOperationConformance({
      ...harnessFor(provider),
      async preparePayment() {
        throw new Error("scripted provider unavailable");
      },
    });

    for (const requirement of C10.filter((r) => r !== "C-10/retrieve-operation-unknown-is-null")) {
      expect(statusOf(results, requirement)).toBe("failed");
    }
    expect(
      results.find((r) => r.requirement === "C-10/capture-pending-has-operation-id")?.detail
    ).toBe("threw: scripted provider unavailable");
  });

  it("records an exception from a command port", async () => {
    const provider = new MemoryPaymentProvider(asyncBoth);
    const binding: PaymentProviderBinding = {
      ...provider.binding,
      cancel: {
        async cancel() {
          throw new Error("transport reset");
        },
      },
    };
    const results = await runPaymentOperationConformance(harnessFor(provider, binding));

    expect(statusOf(results, "C-10/cancel-pending-has-operation-id")).toBe("failed");
    expect(statusOf(results, "C-10/capture-pending-has-operation-id")).toBe("passed");
  });

  it("records an exception from the completion of an operation", async () => {
    const provider = new MemoryPaymentProvider(asyncBoth);
    const results = await runPaymentOperationConformance({
      ...harnessFor(provider),
      async completeOperation() {
        throw new Error("no recorded delivery");
      },
    });

    expect(statusOf(results, "C-10/operation-notification-has-operation-id")).toBe("failed");
    expect(statusOf(results, "C-10/retrieve-operation-returns-operation")).toBe("passed");
  });

  it("judges the real command port, never a result claimed by the harness", async () => {
    const provider = new MemoryPaymentProvider(asyncBoth);
    const binding = alterCommands(provider.binding, withoutOperationId);
    const claimsConformance = {
      ...harnessFor(provider, binding),
      async startPendingOperation(): Promise<Result<PaymentOperationOutcome, PaymentError>> {
        return success({
          provider: "memory",
          paymentId: "p",
          operationId: "op_1",
          operation: "capture",
          status: "pending",
        });
      },
    };
    const results = await runPaymentOperationConformance(claimsConformance);

    expect(statusOf(results, "C-10/capture-pending-has-operation-id")).toBe("failed");
    expect(statusOf(results, "C-10/cancel-pending-has-operation-id")).toBe("failed");
    expect(isPaymentOperationConformant(results)).toBe(false);
  });

  it("is distinct from static validation: a defective adapter still validates", async () => {
    const provider = new MemoryPaymentProvider(asyncBoth);
    const binding = alterCommands(provider.binding, withoutOperationId);

    expect(validatePaymentProviderBinding(binding).success).toBe(true);
    expect(
      isPaymentOperationConformant(
        await runPaymentOperationConformance(harnessFor(provider, binding))
      )
    ).toBe(false);
  });
});
