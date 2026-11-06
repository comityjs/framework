import type { PriceModifierKind } from "../contracts/price-modifier.js";
import type {
  PriceModifierRecord,
  PriceRecord,
  PriceVerification,
} from "../contracts/price-record.js";

import { PricingError } from "../errors/pricing.js";

/** Current record schema version (ADR-014 §14.5). */
const CURRENT_FORMAT = 1;

/** Identifier of the current frozen calculation pipeline (ADR-014 §14.1). */
const CURRENT_SEMANTICS_ID = 1;

const PRICE_MODIFIER_KINDS: ReadonlySet<PriceModifierKind> = new Set([
  "discount",
  "tax",
  "charge",
  "credit",
  "other",
]);

/**
 * Returns whether a value is a plain, non-array object.
 *
 * @param value - The value to check.
 *
 * @returns True for plain objects.
 */
function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Identifiers whose retained implementation has been retired. */
const RETIRED_SEMANTICS_IDS: ReadonlySet<number> = new Set<number>();

/**
 * A frozen implementation of one calculation pipeline.
 *
 * Returns `null` when the modifiers are invalid for that pipeline or when the
 * result would be negative.
 */
type SemanticsImplementation = (
  subtotal: bigint,
  modifiers: ReadonlyArray<PriceModifierRecord>
) => bigint | null;

/**
 * Returns the current record schema version.
 *
 * @returns The current `format`.
 */
export function currentFormat(): 1 {
  return CURRENT_FORMAT;
}

/**
 * Returns the current pricing semantics identifier.
 *
 * @returns The current `semanticsId`.
 */
export function currentSemanticsId(): number {
  return CURRENT_SEMANTICS_ID;
}

/**
 * Reports whether an identifier is the current calculation pipeline.
 *
 * @param semanticsId - The identifier to check.
 *
 * @returns True when the identifier is current.
 */
export function isCurrentSemantics(semanticsId: number): boolean {
  return semanticsId === CURRENT_SEMANTICS_ID;
}

/**
 * Returns whether a value is a supported `PriceModifierKind`.
 *
 * @param value - The value to check.
 *
 * @returns True when the value is a supported modifier kind.
 */
export function isPriceModifierKind(value: unknown): value is PriceModifierKind {
  return typeof value === "string" && PRICE_MODIFIER_KINDS.has(value as PriceModifierKind);
}

/**
 * Validates a recorded modifier structurally.
 *
 * Accepts `unknown` so malformed runtime input produces a deterministic
 * failure instead of a thrown `TypeError` (ADR-014 A14-16).
 *
 * `kind` and `component` are descriptive and never interpreted; they are
 * validated only as structure (ADR-014 §8).
 *
 * @param modifier - The recorded modifier to validate.
 *
 * @returns The validation error, or `null` when the modifier is valid.
 */
export function validateModifierRecord(modifier: unknown): PricingError | null {
  if (!isRecordValue(modifier)) {
    return new PricingError("invalid_modifier", { details: { field: "modifier" } });
  }

  const code = modifier["code"];

  if (typeof code !== "string" || code.trim().length === 0) {
    return new PricingError("invalid_modifier", { details: { field: "code" } });
  }

  const kind = modifier["kind"];

  if (!isPriceModifierKind(kind)) {
    return new PricingError("invalid_modifier", {
      details: { field: "kind", modifierCode: code },
    });
  }

  const label = modifier["label"];

  if (label !== undefined && typeof label !== "string") {
    return new PricingError("invalid_modifier", {
      details: { field: "label", modifierCode: code },
    });
  }

  const component = modifier["component"];

  if (component !== undefined && typeof component !== "string") {
    return new PricingError("invalid_modifier", {
      details: { field: "component", modifierCode: code },
    });
  }

  const adjustment = modifier["adjustment"];

  if (!isRecordValue(adjustment)) {
    return new PricingError("invalid_modifier", {
      details: { field: "adjustment", modifierCode: code },
    });
  }

  const operation = adjustment["operation"];

  if (operation !== "add" && operation !== "subtract") {
    return new PricingError("invalid_modifier", {
      details: { field: "operation", modifierCode: code },
    });
  }

  const type = adjustment["type"];

  if (type === "money") {
    const amount = adjustment["amount"];

    if (typeof amount !== "bigint") {
      return new PricingError("invalid_modifier", {
        details: { field: "amount", modifierCode: code },
      });
    }

    if (amount < 0n) {
      return new PricingError("invalid_amount", {
        details: { field: "amount", modifierCode: code },
      });
    }

    return null;
  }

  if (type === "percentage") {
    const rate = adjustment["rate"];

    if (!isRecordValue(rate)) {
      return new PricingError("invalid_modifier", {
        details: { field: "rate", modifierCode: code },
      });
    }

    const amount = rate["amount"];

    if (typeof amount !== "bigint" || amount < 0n) {
      return new PricingError("invalid_percentage", {
        details: { field: "amount", modifierCode: code },
      });
    }

    const scale = rate["scale"];

    if (typeof scale !== "number" || !Number.isInteger(scale) || scale < 0) {
      return new PricingError("invalid_percentage", {
        details: { field: "scale", modifierCode: code },
      });
    }

    if (amount === 0n) {
      return new PricingError("invalid_modifier", {
        details: { field: "rate", modifierCode: code },
      });
    }

    return null;
  }

  return new PricingError("invalid_modifier", {
    details: { field: "type", modifierCode: code },
  });
}
/**
 * Applies one recorded modifier to a running total under the frozen current
 * pipeline (ADR-014 §8).
 *
 * @param current - The running total, in integer minor units.
 * @param modifier - The recorded modifier to apply.
 *
 * @returns The updated total, or `null` when the result would be negative.
 */
export function applyRecordedModifier(
  current: bigint,
  modifier: PriceModifierRecord
): bigint | null {
  const adjustment = modifier.adjustment;
  const sign = adjustment.operation === "subtract" ? -1n : 1n;
  const delta =
    adjustment.type === "money" ? adjustment.amount : percentDelta(current, adjustment.rate);

  if (sign < 0n && delta > current) {
    return null;
  }

  return current + sign * delta;
}

/**
 * Re-executes a recorded subtotal and modifier list under the frozen current
 * pipeline.
 *
 * @param subtotal - The recorded subtotal, in integer minor units.
 * @param modifiers - The recorded modifiers, in order.
 *
 * @returns The computed total, or `null` when the record is not valid under
 * this pipeline.
 */
export function computeTotal(
  subtotal: bigint,
  modifiers: ReadonlyArray<PriceModifierRecord>
): bigint | null {
  for (const modifier of modifiers) {
    if (validateModifierRecord(modifier) !== null) {
      return null;
    }
  }

  let running = subtotal;

  for (const modifier of modifiers) {
    const next = applyRecordedModifier(running, modifier);

    if (next === null) {
      return null;
    }

    running = next;
  }

  return running;
}

/**
 * Retained, frozen implementations keyed by semantics identifier.
 *
 * Only the current pipeline is retained today; the table is module-private and
 * has no registration API (ADR-014 §14.3). No speculative historical versions
 * are invented.
 */
const RETAINED_SEMANTICS: ReadonlyMap<number, SemanticsImplementation> = new Map<
  number,
  SemanticsImplementation
>([[CURRENT_SEMANTICS_ID, computeTotal]]);

/**
 * Re-executes a record's own frozen semantics (ADR-014 §14.2).
 *
 * This is historical verification only. It never falls back to current
 * semantics, never mutates the record, and never answers commit eligibility.
 *
 * @param record - The record to verify.
 *
 * @returns The verification outcome.
 */
export function verifyRecord(record: PriceRecord): PriceVerification {
  if (!Number.isInteger(record.semanticsId) || record.semanticsId < 1) {
    return { outcome: "unverifiable", cause: "unspecified" };
  }

  if (RETIRED_SEMANTICS_IDS.has(record.semanticsId)) {
    return { outcome: "unverifiable", cause: "retired_semantics" };
  }

  const implementation = RETAINED_SEMANTICS.get(record.semanticsId);

  if (implementation === undefined) {
    return { outcome: "unverifiable", cause: "unknown_semantics" };
  }

  const total = implementation(record.subtotal, record.modifiers);

  if (total === null || total !== record.total) {
    return { outcome: "mismatch" };
  }

  return { outcome: "verified" };
}

/**
 * Computes a percentage adjustment of a running total, rounded half-up to the
 * running total's minor unit (ADR-014 §8).
 *
 * @param current - The running total.
 * @param rate - The percentage rate.
 * @param rate.amount - The scaled percentage amount.
 * @param rate.scale - The percentage scale.
 *
 * @returns The rounded adjustment.
 */
function percentDelta(
  current: bigint,
  rate: {
    /** Scaled percentage amount. */
    readonly amount: bigint;
    /** Percentage scale. */
    readonly scale: number;
  }
): bigint {
  const divisor = 10n ** BigInt(rate.scale + 2);

  return roundHalfUp(current * rate.amount, divisor);
}

/**
 * Rounds a division half-up.
 *
 * @param dividend - The dividend (non-negative here).
 * @param divisor - The divisor (positive).
 *
 * @returns The rounded quotient.
 */
function roundHalfUp(dividend: bigint, divisor: bigint): bigint {
  return (dividend + divisor / 2n) / divisor;
}
