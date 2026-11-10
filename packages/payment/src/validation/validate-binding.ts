import type { Result } from "@comity/primitives/result";
import { failure, success } from "@comity/primitives/result";

import type { PaymentProviderBinding } from "../contracts/payment-capabilities.js";
import { PaymentError } from "../errors/payment.js";

/** Rule identifiers of the static binding rules (ADR-037 §5). C-10 is an adapter conformance rule and is deliberately absent. */
export type PaymentBindingRule =
  "C-1" | "C-2" | "C-3" | "C-4" | "C-5" | "C-6" | "C-8" | "C-9" | "C-11";

/** One violated static rule. */
export interface PaymentBindingViolation {
  /** The violated rule. */
  readonly rule: PaymentBindingRule;

  /** Human-readable description of the violation. */
  readonly message: string;
}

const CUSTOMER_ACTION_KINDS: ReadonlyArray<string> = ["redirect"];

/**
 * Lists every violated static rule of a binding (ADR-037 §5, rules C-1 to C-9 and C-11).
 *
 * Pure and deterministic: no I/O, no clock, no mutation, no normalization. It checks that a binding is *declared* consistently;
 * it cannot prove that an adapter behaves as declared (see the conformance suite for C-10) nor that a PSP honours a declared
 * guarantee such as `incompleteResolution`. Rule C-7 imposes no condition. Rule C-10 is not static.
 *
 * @param binding - The binding to inspect.
 *
 * @returns The violations, in rule order; empty when the binding is structurally valid.
 */
export function getPaymentBindingViolations(
  binding: PaymentProviderBinding
): ReadonlyArray<PaymentBindingViolation> {
  const c = binding.capabilities;
  const violations: PaymentBindingViolation[] = [];

  /**
   * Records one violation.
   *
   * @param rule - The violated rule.
   * @param message - What is wrong.
   */
  function violate(rule: PaymentBindingRule, message: string): void {
    violations.push({ rule, message });
  }

  const presence: ReadonlyArray<readonly [string, boolean, boolean]> = [
    ["statusLookup / status", c.statusLookup === true, binding.status !== undefined],
    [
      "notifications / notifications",
      c.notifications === true,
      binding.notifications !== undefined,
    ],
    ["operationLookup / operations", c.operationLookup === true, binding.operations !== undefined],
    ["manualCapture / capture", c.manualCapture !== false, binding.capture !== undefined],
    ["cancel / cancel", c.cancel !== false, binding.cancel !== undefined],
    ["refund / refund", c.refund !== false, binding.refund !== undefined],
  ];
  for (const [name, declared, present] of presence) {
    if (declared !== present) {
      violate(
        "C-1",
        `Capability and port disagree (${name}): declared ${String(declared)}, port ${present ? "present" : "absent"}`
      );
    }
  }

  if (c.asynchronousInitiation && !c.statusLookup) {
    violate("C-2", "asynchronousInitiation requires statusLookup");
  }

  if (c.customerActions.length > 0 && !c.asynchronousInitiation) {
    violate("C-3", "customerActions is non-empty but asynchronousInitiation is false");
  }

  const asyncCapture = c.manualCapture !== false && c.manualCapture.asynchronous;
  const asyncCancel = c.cancel !== false && c.cancel.asynchronous;
  if ((asyncCapture || asyncCancel) && !c.operationLookup) {
    violate("C-4", "asynchronous manualCapture or cancel requires operationLookup");
  }

  if (c.manualCapture !== false && (c.cancel === false || !c.cancel.authorized)) {
    violate("C-5", "manualCapture requires cancel.authorized");
  }

  if (c.refund !== false && c.refund.multiple && !c.refund.partial) {
    violate("C-6", "refund.multiple requires refund.partial");
  }

  if (!(c.idempotencyRetentionSeconds > 0)) {
    violate("C-8", "idempotencyRetentionSeconds must be greater than zero");
  }

  for (const kind of c.customerActions) {
    if (!CUSTOMER_ACTION_KINDS.includes(kind)) {
      violate("C-9", `customerActions contains an unsupported kind: ${String(kind)}`);
    }
  }

  const resolution = c.incompleteResolution;
  if (c.asynchronousInitiation && resolution === false) {
    violate("C-11", "asynchronousInitiation requires incompleteResolution to declare a mechanism");
  }
  if (resolution !== false) {
    if (resolution.kind === "cancel") {
      if (c.cancel === false || !c.cancel.incomplete) {
        violate("C-11", 'incompleteResolution kind "cancel" requires cancel.incomplete');
      }
    } else if (resolution.kind === "expiry") {
      if (!(Number.isFinite(resolution.maxSeconds) && resolution.maxSeconds > 0)) {
        violate(
          "C-11",
          'incompleteResolution kind "expiry" requires maxSeconds to be a finite number greater than zero'
        );
      }
    } else {
      violate("C-11", "incompleteResolution is not a recognized declaration");
    }
  }

  return violations;
}

/**
 * Validates a provider binding against the static rules (ADR-037 §5).
 *
 * A failing binding is not usable and must not be composed. The failure is `invalid_configuration` and lists every
 * violated rule in `meta.details.violations`.
 *
 * @param binding - The binding to validate.
 *
 * @returns Success when structurally valid, otherwise an `invalid_configuration` failure.
 */
export function validatePaymentProviderBinding(
  binding: PaymentProviderBinding
): Result<void, PaymentError> {
  const violations = getPaymentBindingViolations(binding);
  if (violations.length === 0) {
    return success(undefined);
  }
  return failure(new PaymentError("invalid_configuration", { details: { violations } }));
}
