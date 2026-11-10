import type { Money } from "@comity/pricing";

import type { PaymentProviderBinding } from "../contracts/payment-capabilities.js";
import type {
  PaymentNotification,
  PaymentNotificationDelivery,
} from "../contracts/payment-notification.js";
import type { PaymentOperationOutcome } from "../contracts/payment-outcome.js";
import type { PaymentBindingViolation } from "../validation/validate-binding.js";

import { getPaymentBindingViolations } from "../validation/validate-binding.js";

/**
 * Identifiers of the requirements reported by {@link runPaymentOperationConformance}.
 *
 * `binding-static-validation` is the precondition (ADR-037 §5 rules C-1 to C-9 and C-11, checked by the static
 * validator); every `C-10/...` identifier is one adapter conformance requirement of rule C-10.
 */
export type PaymentConformanceRequirement =
  | "binding-static-validation"
  | "C-10/capture-pending-has-operation-id"
  | "C-10/cancel-pending-has-operation-id"
  | "C-10/pending-operations-have-distinct-ids"
  | "C-10/operation-notification-has-operation-id"
  | "C-10/notification-correlates-to-operation"
  | "C-10/retrieve-operation-returns-operation"
  | "C-10/retrieve-operation-unknown-is-null"
  | "C-10/declared-asynchronous-operations-are-covered";

/**
 * Status of one requirement.
 *
 * - `passed` / `failed`: evaluated against the binding's real ports.
 * - `not_applicable`: the binding does not declare the capability the requirement concerns. Not a pass.
 * - `not_evaluated`: the binding is statically invalid, so no C-10 requirement was run. Not a pass.
 */
export type PaymentConformanceStatus = "passed" | "failed" | "not_applicable" | "not_evaluated";

/** Outcome of one requirement. */
export interface PaymentConformanceResult {
  /** The requirement. */
  readonly requirement: PaymentConformanceRequirement;

  /** Its status. */
  readonly status: PaymentConformanceStatus;

  /** What was observed. */
  readonly detail: string;

  /** For `binding-static-validation` when it fails: every violated static rule. */
  readonly violations?: ReadonlyArray<PaymentBindingViolation>;
}

/** A provider-side payment prepared by the harness for the runner to act on. */
export interface PaymentConformancePayment {
  /** Provider payment identifier, as the adapter reports it. */
  readonly paymentId: string;

  /** The full authorized amount, used as the capture amount (v1 captures the full amount). */
  readonly amount: Money;
}

/**
 * The seam between the conformance runner and the adapter under test.
 *
 * The runner invokes the binding's **real** command and lookup ports itself; the harness never supplies command
 * results. The harness only controls the deterministic provider **below** the adapter (recorded or fake provider
 * responses): it prepares provider-side state and makes the provider complete an operation. No network access,
 * credentials, timers or wall-clock time are involved, and the contract prescribes no transport, SDK or
 * persistence architecture.
 */
export interface PaymentOperationConformanceHarness {
  /** The binding under test, wired to the deterministic provider exactly as it would be composed. */
  readonly binding: PaymentProviderBinding;

  /**
   * Prepares a **new** authorized, manual-capture payment in the scripted provider, on which capture and cancel
   * commands for every operation the binding declares asynchronous are accepted but left pending. Each call must
   * return a distinct payment.
   *
   * @returns The payment to act on.
   */
  preparePayment(): Promise<PaymentConformancePayment>;

  /**
   * Makes the scripted provider complete the operation identified by a pending result that the runner obtained from
   * the real command port, and returns the raw delivery the provider sends for it. Required when the binding
   * declares `notifications`.
   *
   * @param operation - The pending result returned by the adapter's command port.
   *
   * @returns The raw provider delivery, passed unchanged to the binding's notification verifier.
   */
  completeOperation?(operation: PaymentOperationOutcome): Promise<PaymentNotificationDelivery>;
}

/** Operations C-10 concerns. */
type AsyncOperation = "capture" | "cancel";

/** The `operation` variant of a normalized notification. */
type OperationNotification = Extract<PaymentNotification, Record<"kind", "operation">>;

/** Result of one check before it becomes a {@link PaymentConformanceResult}. */
interface Verdict {
  /** Whether the requirement held. */
  readonly ok: boolean;

  /** What was observed. */
  readonly detail: string;
}

/** A pending result and the `operation` notifications its completion produced. */
interface ObservedNotifications {
  /** The pending result returned by the real command port. */
  readonly pending: PaymentOperationOutcome;

  /** The normalized `operation` notifications of the completion delivery. */
  readonly notifications: ReadonlyArray<OperationNotification>;
}

/** Verdicts of the two notification requirements. */
interface NotificationVerdicts {
  /** Every operation notification exposes a non-empty `operationId`. */
  readonly hasId: Verdict;

  /** Each notification carries the `operationId` returned by the command. */
  readonly correlates: Verdict;
}

/** Every C-10 requirement, in report order. */
const C10_REQUIREMENTS: ReadonlyArray<PaymentConformanceRequirement> = [
  "C-10/capture-pending-has-operation-id",
  "C-10/cancel-pending-has-operation-id",
  "C-10/pending-operations-have-distinct-ids",
  "C-10/operation-notification-has-operation-id",
  "C-10/notification-correlates-to-operation",
  "C-10/retrieve-operation-returns-operation",
  "C-10/retrieve-operation-unknown-is-null",
  "C-10/declared-asynchronous-operations-are-covered",
];

/** An operation identifier no adapter can know. */
const UNKNOWN_OPERATION_ID = "comity-conformance-unknown-operation-id";

/**
 * Whether a value is a non-empty string.
 *
 * @param value - The value.
 *
 * @returns `true` for a non-empty string.
 */
function nonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Message of a thrown value.
 *
 * @param error - The thrown value.
 *
 * @returns Its message.
 */
function describeThrown(error: unknown): string {
  return `threw: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Runs one check; an exception (from the adapter or the scripted provider) fails the check instead of the run.
 *
 * @param check - The check.
 *
 * @returns The verdict.
 */
async function attempt(check: () => Promise<Verdict>): Promise<Verdict> {
  try {
    return await check();
  } catch (error) {
    return { ok: false, detail: describeThrown(error) };
  }
}

/**
 * Operations the binding declares asynchronous.
 *
 * @param binding - The binding.
 *
 * @returns `capture` and / or `cancel`.
 */
function declaredAsynchronousOperations(
  binding: PaymentProviderBinding
): ReadonlyArray<AsyncOperation> {
  const { manualCapture, cancel } = binding.capabilities;
  const operations: AsyncOperation[] = [];
  if (manualCapture !== false && manualCapture.asynchronous) operations.push("capture");
  if (cancel !== false && cancel.asynchronous) operations.push("cancel");
  return operations;
}

/**
 * Invokes the binding's real command port and requires a `pending` result of the expected operation.
 *
 * @param binding - The binding under test.
 * @param operation - Which command.
 * @param payment - The prepared payment.
 * @param invocation - Invocation number on that payment, for a distinct idempotency key.
 *
 * @returns The pending result, or a description of why there is none.
 */
async function invokePending(
  binding: PaymentProviderBinding,
  operation: AsyncOperation,
  payment: PaymentConformancePayment,
  invocation: number
): Promise<PaymentOperationOutcome | string> {
  const idempotencyKey = `comity-conformance-${operation}-${invocation}-${payment.paymentId}`;
  let result;
  if (operation === "capture") {
    if (!binding.capture) return "the capture port is absent";
    result = await binding.capture.capture({
      paymentId: payment.paymentId,
      amount: payment.amount,
      idempotencyKey,
    });
  } else {
    if (!binding.cancel) return "the cancel port is absent";
    result = await binding.cancel.cancel({ paymentId: payment.paymentId, idempotencyKey });
  }

  if (!result.success) {
    return `${operation} returned ${result.error.code}`;
  }
  const value = result.value;
  if (value.operation !== operation || value.status !== "pending") {
    return `expected a pending ${operation}, the port returned ${value.operation} ${value.status}`;
  }
  return value;
}

/**
 * C-10: a pending result of the operation carries a non-empty `operationId`.
 *
 * @param harness - The harness.
 * @param operation - The operation.
 *
 * @returns The verdict.
 */
async function checkPendingHasId(
  harness: PaymentOperationConformanceHarness,
  operation: AsyncOperation
): Promise<Verdict> {
  const pending = await invokePending(
    harness.binding,
    operation,
    await harness.preparePayment(),
    1
  );
  if (typeof pending === "string") return { ok: false, detail: pending };
  return nonEmpty(pending.operationId)
    ? {
        ok: true,
        detail: `the pending ${operation} result exposes operationId ${pending.operationId}`,
      }
    : { ok: false, detail: `the pending ${operation} result has no non-empty operationId` };
}

/**
 * C-10: two pending operations on one payment carry different `operationId`s.
 *
 * @param harness - The harness.
 * @param operations - The declared asynchronous operations.
 *
 * @returns The verdict.
 */
async function checkDistinctIds(
  harness: PaymentOperationConformanceHarness,
  operations: ReadonlyArray<AsyncOperation>
): Promise<Verdict> {
  const [first, ...rest] = operations;
  if (first === undefined) return { ok: false, detail: "no asynchronous operation" };
  const second = rest[rest.length - 1] ?? first;
  const payment = await harness.preparePayment();
  const a = await invokePending(harness.binding, first, payment, 1);
  const b = await invokePending(harness.binding, second, payment, 2);
  if (typeof a === "string") return { ok: false, detail: a };
  if (typeof b === "string") return { ok: false, detail: b };
  if (!nonEmpty(a.operationId) || !nonEmpty(b.operationId)) {
    return { ok: false, detail: "an operation on the shared payment has no non-empty operationId" };
  }
  return a.operationId === b.operationId
    ? {
        ok: false,
        detail: `two pending operations on one payment share operationId ${a.operationId}`,
      }
    : { ok: true, detail: `${first} and ${second} on one payment have distinct operationIds` };
}

/**
 * Obtains the normalized `operation` notifications for a completed operation through the real verifier.
 *
 * @param harness - The harness.
 * @param operation - The operation.
 *
 * @returns The pending result and the notifications, or a description of why they could not be obtained.
 */
async function observeNotifications(
  harness: PaymentOperationConformanceHarness,
  operation: AsyncOperation
): Promise<ObservedNotifications | string> {
  const verifier = harness.binding.notifications;
  if (!verifier) return "the notifications port is absent";
  if (!harness.completeOperation)
    return "notifications are declared but the harness cannot complete an operation";

  const pending = await invokePending(
    harness.binding,
    operation,
    await harness.preparePayment(),
    1
  );
  if (typeof pending === "string") return pending;

  const verified = await verifier.verify(await harness.completeOperation(pending));
  if (!verified.success) return `verify returned ${verified.error.code}`;

  const notifications = verified.value.filter(
    (n): n is OperationNotification => n.kind === "operation"
  );
  if (notifications.length === 0)
    return `the ${operation} completion produced no operation notification`;
  return { pending, notifications };
}

/**
 * C-10: every normalized `operation` notification carries a non-empty `operationId` equal to the command's.
 *
 * @param harness - The harness.
 * @param operations - The declared asynchronous operations.
 *
 * @returns One verdict for the identifier and one for correlation.
 */
async function checkNotifications(
  harness: PaymentOperationConformanceHarness,
  operations: ReadonlyArray<AsyncOperation>
): Promise<NotificationVerdicts> {
  const missing: string[] = [];
  const uncorrelated: string[] = [];
  for (const operation of operations) {
    let observed;
    try {
      observed = await observeNotifications(harness, operation);
    } catch (error) {
      observed = describeThrown(error);
    }
    if (typeof observed === "string") {
      missing.push(`${operation}: ${observed}`);
      uncorrelated.push(`${operation}: ${observed}`);
      continue;
    }
    const { pending, notifications } = observed;
    if (notifications.some((n) => !nonEmpty(n.operationId))) {
      missing.push(`${operation}: an operation notification has no non-empty operationId`);
    }
    const matches = notifications.every(
      (n) =>
        n.operationId === pending.operationId &&
        n.operation === pending.operation &&
        n.paymentId === pending.paymentId
    );
    if (!matches) {
      uncorrelated.push(
        `${operation}: the notification does not identify operation ${String(pending.operationId)}`
      );
    }
  }
  return {
    hasId:
      missing.length === 0
        ? { ok: true, detail: "every operation notification exposes a non-empty operationId" }
        : { ok: false, detail: missing.join("; ") },
    correlates:
      uncorrelated.length === 0
        ? { ok: true, detail: "each notification carries the operationId returned by the command" }
        : { ok: false, detail: uncorrelated.join("; ") },
  };
}

/**
 * C-10: `retrieveOperation(operationId)` returns the operation the identifier designates.
 *
 * @param harness - The harness.
 * @param operations - The declared asynchronous operations.
 *
 * @returns The verdict.
 */
async function checkLookupRoundTrip(
  harness: PaymentOperationConformanceHarness,
  operations: ReadonlyArray<AsyncOperation>
): Promise<Verdict> {
  const lookup = harness.binding.operations;
  if (!lookup) return { ok: false, detail: "the operations port is absent" };
  const failures: string[] = [];
  for (const operation of operations) {
    const pending = await invokePending(
      harness.binding,
      operation,
      await harness.preparePayment(),
      1
    );
    if (typeof pending === "string") {
      failures.push(`${operation}: ${pending}`);
      continue;
    }
    if (!nonEmpty(pending.operationId)) {
      failures.push(`${operation}: the pending result has no operationId to look up`);
      continue;
    }
    const found = await lookup.retrieveOperation(pending.operationId);
    if (!found.success) {
      failures.push(`${operation}: retrieveOperation returned ${found.error.code}`);
    } else if (found.value === null) {
      failures.push(`${operation}: retrieveOperation returned null for a known operationId`);
    } else if (
      found.value.operationId !== pending.operationId ||
      found.value.operation !== pending.operation ||
      found.value.paymentId !== pending.paymentId
    ) {
      failures.push(`${operation}: retrieveOperation returned a different operation`);
    }
  }
  return failures.length === 0
    ? { ok: true, detail: "retrieveOperation returns the operation each identifier designates" }
    : { ok: false, detail: failures.join("; ") };
}

/**
 * C-10: `retrieveOperation` returns `null` for an unknown identifier.
 *
 * @param binding - The binding under test.
 *
 * @returns The verdict.
 */
async function checkUnknownLookup(binding: PaymentProviderBinding): Promise<Verdict> {
  if (!binding.operations) return { ok: false, detail: "the operations port is absent" };
  const found = await binding.operations.retrieveOperation(UNKNOWN_OPERATION_ID);
  if (!found.success)
    return { ok: false, detail: `retrieveOperation returned ${found.error.code}` };
  return found.value === null
    ? { ok: true, detail: "retrieveOperation returns null for an unknown operationId" }
    : { ok: false, detail: "retrieveOperation returned an operation for an unknown operationId" };
}

/**
 * Adapter conformance for rule C-10 (ADR-037 §5): operation identity and correlation.
 *
 * 1. The binding is first checked with the static validator. A statically invalid binding fails
 *    `binding-static-validation`, listing every violated rule, and no C-10 requirement is evaluated
 *    (`not_evaluated`). Static validation stays distinct: it is a precondition here, never a substitute.
 * 2. For every operation the binding declares asynchronous (`manualCapture.asynchronous`, `cancel.asynchronous`),
 *    the runner invokes the binding's **real** `capture` / `cancel` ports on payments prepared by the harness, then
 *    exercises the real `retrieveOperation` and, when `notifications` is declared, the real `verify` with the
 *    provider's raw completion delivery.
 *
 * Every requirement reports separately, so a failure is attributable to one rule. Exceptions from the adapter or the
 * scripted provider fail the affected requirement. Passing proves the adapter's behaviour against the deterministic
 * provider responses only: it proves nothing about the external guarantees of a real PSP.
 *
 * @param harness - The adapter's binding and its deterministic provider seam.
 *
 * @returns One result per requirement, in a stable order.
 */
export async function runPaymentOperationConformance(
  harness: PaymentOperationConformanceHarness
): Promise<ReadonlyArray<PaymentConformanceResult>> {
  const { binding } = harness;

  const violations = getPaymentBindingViolations(binding);
  if (violations.length > 0) {
    return [
      {
        requirement: "binding-static-validation",
        status: "failed",
        detail: violations.map((v) => `${v.rule}: ${v.message}`).join("; "),
        violations,
      },
      ...C10_REQUIREMENTS.map((requirement): PaymentConformanceResult => ({
        requirement,
        status: "not_evaluated",
        detail: "not evaluated: the binding is statically invalid",
      })),
    ];
  }

  const results: PaymentConformanceResult[] = [
    {
      requirement: "binding-static-validation",
      status: "passed",
      detail: "the binding satisfies the static rules C-1 to C-9 and C-11",
    },
  ];

  /**
   * Records one result.
   *
   * @param requirement - The requirement.
   * @param verdict - Its verdict, or `null` when not applicable.
   * @param reason - Why it is not applicable.
   */
  function record(
    requirement: PaymentConformanceRequirement,
    verdict: Verdict | null,
    reason = ""
  ): void {
    results.push(
      verdict === null
        ? { requirement, status: "not_applicable", detail: reason }
        : { requirement, status: verdict.ok ? "passed" : "failed", detail: verdict.detail }
    );
  }

  const operations = declaredAsynchronousOperations(binding);
  const none = "no asynchronous capture or cancel is declared";

  for (const operation of ["capture", "cancel"] as const) {
    record(
      `C-10/${operation}-pending-has-operation-id`,
      operations.includes(operation)
        ? await attempt(() => checkPendingHasId(harness, operation))
        : null,
      `${operation} is not declared asynchronous`
    );
  }

  record(
    "C-10/pending-operations-have-distinct-ids",
    operations.length > 0 ? await attempt(() => checkDistinctIds(harness, operations)) : null,
    none
  );

  if (operations.length === 0 || !binding.capabilities.notifications) {
    const reason = operations.length === 0 ? none : "notifications are not declared";
    record("C-10/operation-notification-has-operation-id", null, reason);
    record("C-10/notification-correlates-to-operation", null, reason);
  } else {
    const { hasId, correlates } = await checkNotifications(harness, operations);
    record("C-10/operation-notification-has-operation-id", hasId);
    record("C-10/notification-correlates-to-operation", correlates);
  }

  record(
    "C-10/retrieve-operation-returns-operation",
    operations.length > 0 ? await attempt(() => checkLookupRoundTrip(harness, operations)) : null,
    none
  );
  record(
    "C-10/retrieve-operation-unknown-is-null",
    operations.length > 0 ? await attempt(() => checkUnknownLookup(binding)) : null,
    none
  );

  const failed = results.filter((r) => r.status === "failed").map((r) => r.requirement);
  record(
    "C-10/declared-asynchronous-operations-are-covered",
    operations.length === 0
      ? null
      : failed.length === 0
        ? {
            ok: true,
            detail: `declared asynchronous ${operations.join(" and ")} satisfy every requirement`,
          }
        : { ok: false, detail: `failed: ${failed.join(", ")}` },
    none
  );

  return results;
}

/**
 * Whether a conformance run passed: static validation passed and no requirement failed. `not_applicable` results
 * neither pass nor fail; any `not_evaluated` result means the run is not conformant.
 *
 * @param results - The results of {@link runPaymentOperationConformance}.
 *
 * @returns Whether the adapter is conformant for C-10.
 */
export function isPaymentOperationConformant(
  results: ReadonlyArray<PaymentConformanceResult>
): boolean {
  return results.every((r) => r.status === "passed" || r.status === "not_applicable");
}
