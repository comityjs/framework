import type { Result } from "@comity/primitives/result";

import type { PaymentProviderBinding } from "../contracts/payment-capabilities.js";
import type {
  PaymentNotification,
  PaymentNotificationDelivery,
  PaymentNotificationSubject,
} from "../contracts/payment-notification.js";
import type { PaymentError } from "../errors/payment.js";
import type { PaymentConformanceStatus } from "./operations.js";

/**
 * Identifiers of the requirements reported by {@link runPaymentNotificationVerifierConformance}. They are the
 * verifier conformance IDs of the consolidated conformance matrix (assessment AP11.12). VC-6 was absorbed into VC-4
 * and VC-11 into VC-2; VC-5 is the "no network" requirement.
 */
export type PaymentVerifierConformanceRequirement =
  | "VC-1"
  | "VC-2"
  | "VC-3"
  | "VC-4"
  | "VC-5"
  | "VC-7"
  | "VC-8"
  | "VC-9"
  | "VC-10"
  | "VC-12"
  | "VC-13"
  | "VC-14"
  | "VC-15"
  | "VC-16"
  | "VC-17"
  | "VC-18"
  | "VC-19";

/**
 * Deliveries the harness is asked to issue. The adapter's documented event mapping decides how each scenario is
 * expressed on the wire; a scenario its mapping cannot express (for example a state event under a mapping with no
 * state events) is answered with `undefined` and its requirements are `not_applicable`.
 *
 * - `valid`: a well-formed, authentic delivery that verifies successfully;
 * - `unmapped-event-type`: one event of a type the mapping does not know;
 * - `undeterminable-events`: authentic, but its event boundaries or types cannot be determined;
 * - `state-unmapped-value`: a state event whose state value is not mapped;
 * - `state-missing-optional-fields`: a state event missing only optional fields;
 * - `state-missing-required-field`: a non-success state event missing a required field, identifiers present;
 * - `state-missing-identifiers`: as above, with every identifier missing;
 * - `several-representable`: several events, none under VR-9;
 * - `mixed-with-unrepresentable`: a representable event, then a VR-9 event;
 * - `two-unrepresentable`: two VR-9 events;
 * - `undetermined-kind`: an identifier that is a payment or a refund, without saying which;
 * - `possibly-operation`: an identifier that may also be an operation;
 * - `unrepresentable-payment` and `unrepresentable-refund`: a settled success with its identifiers and an absent or
 *   unusable amount;
 * - `payment-success-missing-payment-id` and `refund-success-missing-refund-id`: settled successes missing their
 *   mandatory identifier (a refund with its `paymentId`), with a usable amount;
 * - `payment-success-missing-payment-id-unusable-amount` and `refund-success-missing-refund-id-unusable-amount`:
 *   the same, also with an unusable amount;
 * - `signal-with-amount-like-fields`: a signal event carrying extra, undocumented amount-like fields;
 * - `failure-unusable-amount`: a confirmed payment failure with an unusable amount;
 * - `pending-refund-unusable-amount`: a pending refund with an unusable amount.
 */
export type PaymentVerifierScenario =
  | "valid"
  | "unmapped-event-type"
  | "undeterminable-events"
  | "state-unmapped-value"
  | "state-missing-optional-fields"
  | "state-missing-required-field"
  | "state-missing-identifiers"
  | "several-representable"
  | "mixed-with-unrepresentable"
  | "two-unrepresentable"
  | "undetermined-kind"
  | "possibly-operation"
  | "unrepresentable-payment"
  | "unrepresentable-refund"
  | "payment-success-missing-payment-id"
  | "refund-success-missing-refund-id"
  | "payment-success-missing-payment-id-unusable-amount"
  | "refund-success-missing-refund-id-unusable-amount"
  | "signal-with-amount-like-fields"
  | "failure-unusable-amount"
  | "pending-refund-unusable-amount";

/** A delivery issued for a scenario, with what the runner must find when the adapter verifies it. */
export interface PaymentVerifierFixture {
  /** The raw delivery, passed unchanged to the verifier. */
  readonly delivery: PaymentNotificationDelivery;

  /**
   * For a scenario that must produce `other`: the narrowest truthful `subject` of every `other` notification.
   * Absent when the scenario must produce no `subject`.
   */
  readonly subject?: PaymentNotificationSubject;

  /** For a scenario that must produce a state kind: that kind (`payment`, `refund` or `operation`). */
  readonly kind?: PaymentNotification["kind"];

  /**
   * For `several-representable`: the primary provider identifier (`paymentId`, `refundId` or subject identifier) of
   * each event, in delivery order.
   */
  readonly identifiers?: ReadonlyArray<string>;

  /** For a scenario that must fail with `unrepresentable_success`: `paymentId` of the first VR-9 event. */
  readonly paymentId?: string;

  /** For a refund-scoped `unrepresentable_success`: `refundId` of the first VR-9 event. */
  readonly refundId?: string;
}

/**
 * The seam between the verifier runner and the adapter under test.
 *
 * The runner calls the binding's **real** `verify` itself; the harness only plays the provider below the adapter:
 * it issues raw deliveries for named scenarios and alters their authenticity material. No network access,
 * credentials or timers are involved.
 */
export interface PaymentVerifierConformanceHarness {
  /** The binding under test, wired to the deterministic provider exactly as it would be composed. */
  readonly binding: PaymentProviderBinding;

  /**
   * Issues the authentic delivery of a scenario.
   *
   * @param scenario - The scenario.
   *
   * @returns The fixture, or `undefined` when the adapter's documented mapping cannot express the scenario.
   */
  issue(scenario: PaymentVerifierScenario): Promise<PaymentVerifierFixture | undefined>;

  /**
   * Returns the same body with its authenticity broken (for example, an altered signature), everything else equal.
   *
   * @param delivery - An authentic delivery.
   *
   * @returns The delivery whose authenticity is invalid.
   */
  breakAuthenticity(delivery: PaymentNotificationDelivery): Promise<PaymentNotificationDelivery>;

  /**
   * Returns the same body with its authenticity material missing (for example, the signature header removed).
   *
   * @param delivery - An authentic delivery.
   *
   * @returns The delivery without authenticity material.
   */
  withoutAuthenticity(delivery: PaymentNotificationDelivery): Promise<PaymentNotificationDelivery>;
}

/** Outcome of one requirement. */
export interface PaymentVerifierConformanceResult {
  /** The requirement. */
  readonly requirement: PaymentVerifierConformanceRequirement;

  /** Its status. `not_applicable`: the binding or its mapping cannot express the scenario. Not a pass. */
  readonly status: Extract<PaymentConformanceStatus, "passed" | "failed" | "not_applicable">;

  /** What was observed. */
  readonly detail: string;
}

/** Result of one `verify` invocation. */
type VerifyOutcome = Result<ReadonlyArray<PaymentNotification>, PaymentError>;

/** A check of one fixture's outcome: a description of the defect, or `undefined` when it holds. */
type Check = (fixture: PaymentVerifierFixture, outcome: VerifyOutcome) => string | undefined;

/** Result of `verify` run with the network denied. */
interface NetworklessRun {
  /** The outcome, or a description of an exception. */
  readonly outcome: VerifyOutcome | string;

  /** Outbound calls the verifier attempted. */
  readonly attempts: number;
}

/** The `other` variant of a notification. */
type OtherNotification = Extract<PaymentNotification, Record<"kind", "other">>;

/** Every requirement, in report order. */
const REQUIREMENTS: ReadonlyArray<PaymentVerifierConformanceRequirement> = [
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

/**
 * Describes an outcome for a report.
 *
 * @param outcome - The outcome.
 *
 * @returns A short description.
 */
function describeOutcome(outcome: VerifyOutcome): string {
  if (outcome.success) {
    return `success with ${outcome.value.map((n) => n.kind).join(", ") || "no notifications"}`;
  }
  const cause = outcome.error.meta.details?.cause;
  return `${outcome.error.code}${cause ? ` (${cause})` : ""}`;
}

/**
 * Whether the outcome is `invalid_notification` with the given cause.
 *
 * @param outcome - The outcome.
 * @param cause - The cause.
 *
 * @returns `true` when it is.
 */
function isInvalid(outcome: VerifyOutcome, cause: "signature" | "malformed"): boolean {
  return (
    !outcome.success &&
    outcome.error.meta.reason === "invalid_notification" &&
    outcome.error.meta.details?.cause === cause
  );
}

/**
 * Whether the outcome is a failure of the whole delivery by `unrepresentable_success`.
 *
 * @param outcome - The outcome.
 *
 * @returns `true` when it is.
 */
function isCaseB(outcome: VerifyOutcome): boolean {
  return !outcome.success && outcome.error.meta.reason === "unrepresentable_success";
}

/**
 * The primary provider identifier of a notification.
 *
 * @param notification - The notification.
 *
 * @returns Its `refundId`, `paymentId`, subject identifier or `operationId`; `undefined` for a bare `other`.
 */
function primaryIdentifier(notification: PaymentNotification): string | undefined {
  switch (notification.kind) {
    case "refund":
      return notification.refundId;
    case "payment":
    case "operation":
      return notification.paymentId;
    case "other": {
      const { subject } = notification;
      if (!subject) return undefined;
      if (subject.kind === "payment") return subject.paymentId;
      return subject.kind === "refund" ? subject.refundId : subject.providerId;
    }
  }
}

/**
 * Structural equality of two optional subjects.
 *
 * @param a - A subject.
 * @param b - Another subject.
 *
 * @returns Whether both are absent or have the same fields.
 */
function sameSubject(
  a: PaymentNotificationSubject | undefined,
  b: PaymentNotificationSubject | undefined
): boolean {
  return (
    JSON.stringify(a === undefined ? null : sortKeys(a)) ===
    JSON.stringify(b === undefined ? null : sortKeys(b))
  );
}

/**
 * A copy of a subject with its keys in a stable order.
 *
 * @param subject - The subject.
 *
 * @returns The copy.
 */
function sortKeys(subject: PaymentNotificationSubject): Record<string, unknown> {
  return Object.fromEntries(Object.entries(subject).sort(([x], [y]) => x.localeCompare(y)));
}

/**
 * The `other` check: success, every notification `other`, with exactly the fixture's subject.
 *
 * @param fixture - The fixture.
 * @param outcome - The outcome.
 *
 * @returns A defect description, or `undefined`.
 */
const expectOther: Check = (fixture, outcome) => {
  if (!outcome.success) return `expected \`other\`, got ${describeOutcome(outcome)}`;
  if (outcome.value.length === 0) return "expected an `other` notification, got none";
  for (const notification of outcome.value) {
    if (notification.kind !== "other") return `expected \`other\`, got kind ${notification.kind}`;
    if (!sameSubject(notification.subject, fixture.subject)) {
      return `subject ${JSON.stringify(notification.subject ?? null)} differs from the expected ${JSON.stringify(
        fixture.subject ?? null
      )}`;
    }
  }
  return undefined;
};

/**
 * Message of a thrown value.
 *
 * @param error - The thrown value.
 *
 * @returns Its description.
 */
function describeThrown(error: unknown): string {
  return `threw: ${error instanceof Error ? error.message : String(error)}`;
}

/**
 * Runs the verifier on a delivery; an exception becomes a described defect.
 *
 * @param binding - The binding under test.
 * @param delivery - The delivery.
 *
 * @returns The outcome, or a description of the exception.
 */
async function verify(
  binding: PaymentProviderBinding,
  delivery: PaymentNotificationDelivery
): Promise<VerifyOutcome | string> {
  if (!binding.notifications) return "the notifications port is absent";
  try {
    return await binding.notifications.verify(delivery);
  } catch (error) {
    return describeThrown(error);
  }
}

/**
 * Runs `verify` with the global `fetch` replaced by a function that refuses and counts every call (AMT-16, VC-5).
 * Only the global `fetch` is intercepted: other transports are outside what the runner can deny.
 *
 * @param binding - The binding under test.
 * @param delivery - The delivery.
 *
 * @returns The outcome and the number of denied outbound calls.
 */
async function verifyWithoutNetwork(
  binding: PaymentProviderBinding,
  delivery: PaymentNotificationDelivery
): Promise<NetworklessRun> {
  const original = globalThis.fetch;
  let attempts = 0;
  /**
   * Refuses and counts an outbound call.
   *
   * @returns A promise rejected with a denial error.
   */
  const denied: typeof fetch = () => {
    attempts += 1;
    return Promise.reject(new TypeError("outbound network denied by the conformance runner"));
  };
  globalThis.fetch = denied;
  try {
    return { outcome: await verify(binding, delivery), attempts };
  } finally {
    globalThis.fetch = original;
  }
}

/**
 * Verifier conformance for the consolidated conformance matrix VC-1 to VC-19 (assessment AP11.12), as far as the
 * matrix assigns them to the Core package: VC-1 to VC-5, VC-7 to VC-10 and VC-12 to VC-19.
 *
 * The runner invokes the binding's **real** `verify` on deliveries the harness issues from the provider below the
 * adapter. Every requirement reports separately:
 * - `passed` / `failed`: evaluated against the real verifier;
 * - `not_applicable`: the binding does not declare `notifications`, or the adapter's documented mapping cannot express
 *   any scenario of the requirement (for example, no state events). Not a pass.
 *
 * An exception from the verifier or the harness fails the affected requirement. Passing proves the adapter's
 * behaviour against the harness's deliveries only; it proves nothing about a real provider's guarantees.
 *
 * @param harness - The adapter's binding and its deterministic provider seam.
 *
 * @returns One result per requirement, in a stable order.
 */
export async function runPaymentNotificationVerifierConformance(
  harness: PaymentVerifierConformanceHarness
): Promise<ReadonlyArray<PaymentVerifierConformanceResult>> {
  const { binding } = harness;

  if (!binding.capabilities.notifications || !binding.notifications) {
    return REQUIREMENTS.map((requirement): PaymentVerifierConformanceResult => ({
      requirement,
      status: "not_applicable",
      detail: "notifications are not declared",
    }));
  }

  const results: PaymentVerifierConformanceResult[] = [];

  /**
   * Records one result.
   *
   * @param requirement - The requirement.
   * @param problems - The defects found.
   * @param evaluated - How many scenarios were evaluated; none makes it `not_applicable`.
   * @param passed - What held, when nothing failed.
   */
  function record(
    requirement: PaymentVerifierConformanceRequirement,
    problems: ReadonlyArray<string>,
    evaluated: number,
    passed: string
  ): void {
    if (evaluated === 0) {
      results.push({
        requirement,
        status: "not_applicable",
        detail: "the adapter's documented mapping cannot express any scenario of this requirement",
      });
    } else if (problems.length > 0) {
      results.push({ requirement, status: "failed", detail: problems.join("; ") });
    } else {
      results.push({ requirement, status: "passed", detail: passed });
    }
  }

  /**
   * Issues a scenario, tolerating a harness exception.
   *
   * @param scenario - The scenario.
   *
   * @returns The fixture, `undefined` when not expressible, or a description of the exception.
   */
  async function issue(
    scenario: PaymentVerifierScenario
  ): Promise<PaymentVerifierFixture | undefined | string> {
    try {
      return await harness.issue(scenario);
    } catch (error) {
      return describeThrown(error);
    }
  }

  /**
   * Evaluates scenarios of one requirement with a check on the real verifier's outcome.
   *
   * @param requirement - The requirement.
   * @param scenarios - Its scenarios.
   * @param check - The check on each outcome.
   * @param passed - What held.
   */
  async function evaluate(
    requirement: PaymentVerifierConformanceRequirement,
    scenarios: ReadonlyArray<PaymentVerifierScenario>,
    check: Check,
    passed: string
  ): Promise<void> {
    const problems: string[] = [];
    let evaluated = 0;
    for (const scenario of scenarios) {
      const fixture = await issue(scenario);
      if (fixture === undefined) continue;
      evaluated += 1;
      if (typeof fixture === "string") {
        problems.push(`${scenario}: ${fixture}`);
        continue;
      }
      const outcome = await verify(binding, fixture.delivery);
      if (typeof outcome === "string") {
        problems.push(`${scenario}: ${outcome}`);
        continue;
      }
      const defect = check(fixture, outcome);
      if (defect !== undefined) problems.push(`${scenario}: ${defect}`);
    }
    record(requirement, problems, evaluated, passed);
  }

  /**
   * Evaluates a requirement on altered authenticity of scenarios' deliveries.
   *
   * @param requirement - The requirement.
   * @param scenarios - The scenarios whose deliveries are altered.
   * @param alter - The alteration.
   * @param label - What the alteration is, for the report.
   */
  async function evaluateAltered(
    requirement: PaymentVerifierConformanceRequirement,
    scenarios: ReadonlyArray<PaymentVerifierScenario>,
    alter: (delivery: PaymentNotificationDelivery) => Promise<PaymentNotificationDelivery>,
    label: string
  ): Promise<void> {
    const problems: string[] = [];
    let evaluated = 0;
    for (const scenario of scenarios) {
      const fixture = await issue(scenario);
      if (fixture === undefined) continue;
      evaluated += 1;
      if (typeof fixture === "string") {
        problems.push(`${scenario}: ${fixture}`);
        continue;
      }
      let outcome: VerifyOutcome | string;
      try {
        outcome = await verify(binding, await alter(fixture.delivery));
      } catch (error) {
        outcome = describeThrown(error);
      }
      if (typeof outcome === "string") {
        problems.push(`${scenario}: ${outcome}`);
      } else if (!isInvalid(outcome, "signature")) {
        problems.push(
          `${scenario} with ${label}: expected \`signature\`, got ${describeOutcome(outcome)}`
        );
      }
    }
    record(requirement, problems, evaluated, `${label} is always \`signature\``);
  }

  await evaluateAltered(
    "VC-1",
    ["valid"],
    (d) => harness.breakAuthenticity(d),
    "invalid signature"
  );

  {
    const problems: string[] = [];
    const fixture = await issue("undeterminable-events");
    let evaluated = 0;
    if (fixture !== undefined) {
      evaluated = 1;
      if (typeof fixture === "string") {
        problems.push(fixture);
      } else {
        const authentic = await verify(binding, fixture.delivery);
        if (typeof authentic === "string") problems.push(authentic);
        else if (!isInvalid(authentic, "malformed")) {
          problems.push(`authentic: expected \`malformed\`, got ${describeOutcome(authentic)}`);
        }
        let broken: VerifyOutcome | string;
        try {
          broken = await verify(binding, await harness.breakAuthenticity(fixture.delivery));
        } catch (error) {
          broken = describeThrown(error);
        }
        if (typeof broken === "string") problems.push(broken);
        else if (!isInvalid(broken, "signature")) {
          problems.push(
            `authenticity broken: expected \`signature\`, got ${describeOutcome(broken)}`
          );
        }
      }
    }
    record(
      "VC-2",
      problems,
      evaluated,
      "undeterminable events are `malformed`; the same bytes with authenticity broken are `signature`"
    );
  }

  await evaluateAltered(
    "VC-3",
    ["valid"],
    (d) => harness.withoutAuthenticity(d),
    "missing authenticity material"
  );

  await evaluate(
    "VC-4",
    ["unmapped-event-type"],
    (fixture, outcome) => expectOther({ delivery: fixture.delivery }, outcome),
    "an unmapped event type is `other` without `subject`"
  );

  {
    const problems: string[] = [];
    const fixture = await issue("valid");
    let evaluated = 0;
    if (fixture !== undefined) {
      evaluated = 1;
      if (typeof fixture === "string") {
        problems.push(fixture);
      } else {
        const { outcome, attempts } = await verifyWithoutNetwork(binding, fixture.delivery);
        if (typeof outcome === "string") problems.push(outcome);
        else if (!outcome.success) {
          problems.push(`verify failed with the network denied: ${describeOutcome(outcome)}`);
        }
        if (attempts > 0) problems.push(`verify attempted ${attempts} outbound call(s)`);
      }
    }
    record("VC-5", problems, evaluated, "verify succeeds for valid input with the network denied");
  }

  await evaluate(
    "VC-7",
    ["state-unmapped-value"],
    (fixture, outcome) => {
      const defect = expectOther(fixture, outcome);
      if (defect !== undefined) return defect;
      return fixture.subject === undefined
        ? "the fixture declares no expected subject for a state event with identifiers"
        : undefined;
    },
    "a state event with an unmapped state value is `other` with `subject`"
  );

  await evaluate(
    "VC-8",
    ["state-missing-optional-fields"],
    (fixture, outcome) => {
      if (!outcome.success) return `expected a state kind, got ${describeOutcome(outcome)}`;
      const kinds = outcome.value.map((n) => n.kind);
      if (kinds.length === 0 || kinds.includes("other")) {
        return `expected a state kind, got ${kinds.join(", ") || "no notifications"}`;
      }
      return fixture.kind !== undefined && kinds.some((kind) => kind !== fixture.kind)
        ? `expected kind ${fixture.kind}, got ${kinds.join(", ")}`
        : undefined;
    },
    "a state event missing only optional fields keeps its state kind"
  );

  await evaluate(
    "VC-9",
    ["state-missing-required-field"],
    (fixture, outcome) => {
      const defect = expectOther(fixture, outcome);
      if (defect !== undefined) return defect;
      return fixture.subject === undefined
        ? "the fixture declares no expected subject although identifiers are present"
        : undefined;
    },
    "a non-success state event missing a required field is `other` with the narrowest `subject`"
  );

  await evaluate(
    "VC-10",
    ["state-missing-identifiers"],
    (fixture, outcome) => {
      const defect = expectOther({ delivery: fixture.delivery }, outcome);
      return defect !== undefined
        ? defect
        : fixture.subject !== undefined
          ? "the fixture declares a subject although every identifier is missing"
          : undefined;
    },
    "a state event with every identifier missing is `other` without `subject`"
  );

  await evaluate(
    "VC-12",
    ["several-representable"],
    (fixture, outcome) => {
      if (!outcome.success) return `expected every event, got ${describeOutcome(outcome)}`;
      const expected = fixture.identifiers ?? [];
      const observed = outcome.value.map(primaryIdentifier);
      if (outcome.value.length < 2)
        return `expected several notifications, got ${outcome.value.length}`;
      return expected.length === observed.length && expected.every((id, i) => id === observed[i])
        ? undefined
        : `events ${JSON.stringify(observed)} differ from the expected order ${JSON.stringify(expected)}`;
    },
    "every representable event is returned, in delivery order"
  );

  await evaluate(
    "VC-13",
    ["mixed-with-unrepresentable", "two-unrepresentable"],
    (fixture, outcome) => {
      if (!isCaseB(outcome)) {
        return `expected \`unrepresentable_success\`, got ${describeOutcome(outcome)}`;
      }
      const details = outcome.success ? undefined : outcome.error.meta.details;
      if (details?.paymentId !== fixture.paymentId) {
        return `details name payment ${String(details?.paymentId)}, not the first VR-9 event's ${String(fixture.paymentId)}`;
      }
      return details?.refundId === fixture.refundId
        ? undefined
        : `details name refund ${String(details?.refundId)}, not the first VR-9 event's ${String(fixture.refundId)}`;
    },
    "a delivery with a VR-9 event fails as a whole with the details of the first such event"
  );

  {
    const problems: string[] = [];
    let evaluated = 0;
    const undetermined = await issue("undetermined-kind");
    if (undetermined !== undefined) {
      evaluated += 1;
      if (typeof undetermined === "string") problems.push(`undetermined-kind: ${undetermined}`);
      else {
        const outcome = await verify(binding, undetermined.delivery);
        const defect =
          typeof outcome === "string"
            ? outcome
            : (expectOther(undetermined, outcome) ??
              (undetermined.subject?.kind === "payment_or_refund"
                ? undefined
                : "the fixture does not declare a `payment_or_refund` subject"));
        if (defect !== undefined) problems.push(`undetermined-kind: ${defect}`);
      }
    }
    const operation = await issue("possibly-operation");
    if (operation !== undefined) {
      evaluated += 1;
      if (typeof operation === "string") problems.push(`possibly-operation: ${operation}`);
      else {
        const outcome = await verify(binding, operation.delivery);
        const defect =
          typeof outcome === "string"
            ? outcome
            : expectOther({ delivery: operation.delivery }, outcome);
        if (defect !== undefined) problems.push(`possibly-operation: ${defect}`);
      }
    }
    record(
      "VC-14",
      problems,
      evaluated,
      "an identifier of undetermined kind is `payment_or_refund`; one that may be an operation forms no `subject`"
    );
  }

  await evaluate(
    "VC-15",
    [
      "unrepresentable-payment",
      "unrepresentable-refund",
      "mixed-with-unrepresentable",
      "two-unrepresentable",
    ],
    (fixture, outcome) => {
      if (outcome.success || outcome.error.meta.reason !== "unrepresentable_success") {
        return `expected \`unrepresentable_success\`, got ${describeOutcome(outcome)}`;
      }
      const details = outcome.error.meta.details;
      if (details?.provider !== binding.id) {
        return `details.provider ${String(details?.provider)} is not the binding ${binding.id}`;
      }
      if (!details.paymentId) return "details carry no paymentId";
      if (details.scope === "refund" && !details.refundId) {
        return "a refund-scoped error carries no refundId";
      }
      return fixture.refundId !== undefined && details.scope !== "refund"
        ? "the fixture expects a refund scope"
        : undefined;
    },
    "every `unrepresentable_success` carries provider = the binding, paymentId, and refundId for the refund scope"
  );

  {
    const problems: string[] = [];
    let evaluated = 0;
    for (const scenario of ["undeterminable-events", "unrepresentable-payment"] as const) {
      const fixture = await issue(scenario);
      if (fixture === undefined) continue;
      evaluated += 1;
      if (typeof fixture === "string") {
        problems.push(`${scenario}: ${fixture}`);
        continue;
      }
      let outcome: VerifyOutcome | string;
      try {
        outcome = await verify(binding, await harness.breakAuthenticity(fixture.delivery));
      } catch (error) {
        outcome = describeThrown(error);
      }
      if (typeof outcome === "string") problems.push(`${scenario}: ${outcome}`);
      else if (!isInvalid(outcome, "signature")) {
        problems.push(
          `${scenario} with authenticity broken: expected \`signature\`, got ${describeOutcome(outcome)}`
        );
      }
    }
    record(
      "VC-16",
      problems,
      evaluated,
      "with authenticity broken, neither `malformed` nor `unrepresentable_success` is ever returned"
    );
  }

  await evaluate(
    "VC-17",
    [
      "payment-success-missing-payment-id",
      "refund-success-missing-refund-id",
      "payment-success-missing-payment-id-unusable-amount",
      "refund-success-missing-refund-id-unusable-amount",
    ],
    expectOther,
    "a settled success missing its identifier is `other` with the narrowest truthful `subject`, never `malformed` or `unrepresentable_success`"
  );

  await evaluate(
    "VC-18",
    ["signal-with-amount-like-fields"],
    (fixture, outcome) => {
      const defect = expectOther(fixture, outcome);
      if (defect !== undefined) return defect;
      const notifications: ReadonlyArray<OtherNotification> = outcome.success
        ? outcome.value.filter((n): n is OtherNotification => n.kind === "other")
        : [];
      return notifications.some((n) => "amount" in n || "providerAmountUnusable" in n)
        ? "an `other` notification carries an amount"
        : undefined;
    },
    "a signal event stays `other`: no state kind, no case B, no amount"
  );

  await evaluate(
    "VC-19",
    ["failure-unusable-amount", "pending-refund-unusable-amount"],
    (fixture, outcome) => {
      if (!outcome.success) return `expected a state kind, got ${describeOutcome(outcome)}`;
      if (outcome.value.length === 0) return "expected a state kind, got no notifications";
      for (const notification of outcome.value) {
        if (notification.kind === "other" || notification.kind === "operation") {
          return `expected a state kind, got ${notification.kind}`;
        }
        if (fixture.kind !== undefined && notification.kind !== fixture.kind) {
          return `expected kind ${fixture.kind}, got ${notification.kind}`;
        }
        if (
          !("providerAmountUnusable" in notification) ||
          notification.providerAmountUnusable !== true
        ) {
          return "providerAmountUnusable is not `true`";
        }
        if ("amount" in notification && notification.amount !== undefined)
          return "an amount accompanies providerAmountUnusable";
      }
      return undefined;
    },
    "an unusable amount on a confirmed failure or pending refund sets `providerAmountUnusable: true`"
  );

  return REQUIREMENTS.map(
    (requirement) =>
      results.find((r) => r.requirement === requirement) ?? {
        requirement,
        status: "not_applicable",
        detail: "not evaluated",
      }
  );
}

/**
 * Whether a verifier conformance run passed: no requirement failed. `not_applicable` results neither pass nor fail,
 * and a run in which every requirement is `not_applicable` is not conformant.
 *
 * @param results - The results of {@link runPaymentNotificationVerifierConformance}.
 *
 * @returns Whether the adapter's verifier is conformant.
 */
export function isPaymentNotificationVerifierConformant(
  results: ReadonlyArray<PaymentVerifierConformanceResult>
): boolean {
  return (
    results.some((r) => r.status === "passed") &&
    results.every((r) => r.status === "passed" || r.status === "not_applicable")
  );
}
