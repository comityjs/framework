import type { Result } from "@comity/primitives/result";
import type { PriceModifier } from "../contracts/price-modifier.js";
import type {
  PlainPriceRecord,
  PriceCurrency,
  PriceModifierRecord,
  PriceRecord,
} from "../contracts/price-record.js";
import type { Price } from "../value-objects/price.js";

import { failure, isFailure, success } from "@comity/primitives/result";
import { PricingError } from "../errors/pricing.js";
import { Percentage } from "../value-objects/percentage.js";
import {
  applyRecordedModifier,
  computeTotal,
  currentFormat,
  currentSemanticsId,
  isCurrentSemantics,
  isPriceModifierKind,
  validateModifierRecord,
} from "./pricing-semantics.js";

/**
 * Returns whether a value is a plain, non-array object.
 *
 * @param value - The value to check.
 *
 * @returns True for plain objects.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses a non-negative decimal string into a bigint.
 *
 * @param value - The value to parse.
 *
 * @returns The amount, or `null` when the value is not a decimal string.
 */
function parseAmount(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return null;
  }

  return BigInt(value);
}

/**
 * Compares two structural currencies on `(code, exponent)`.
 *
 * @param left - The first currency.
 * @param right - The second currency.
 *
 * @returns True when both code and exponent are equal.
 */
function currencyEquals(left: PriceCurrency, right: PriceCurrency): boolean {
  return left.code === right.code && left.exponent === right.exponent;
}

/**
 * Validates a structural currency representation.
 *
 * This is representation-only: it never consults the current ISO table.
 *
 * @param value - The value to validate.
 *
 * @returns The validation error, or `null` when valid.
 */
function validateCurrency(value: unknown): PricingError | null {
  if (!isPlainObject(value)) {
    return new PricingError("invalid_currency", { details: { field: "currency" } });
  }

  const code = value["code"];

  if (typeof code !== "string" || code.trim().length === 0) {
    return new PricingError("invalid_currency", { details: { field: "code" } });
  }

  const exponent = value["exponent"];

  if (typeof exponent !== "number" || !Number.isInteger(exponent) || exponent < 0) {
    return new PricingError("invalid_currency", {
      details:
        typeof exponent === "number" ? { field: "exponent", exponent } : { field: "exponent" },
    });
  }

  return null;
}

/**
 * Records what `Price.create` produced at the moment of commitment (ADR-014
 * A14-1). One-way: a `Price` stays transient.
 *
 * The current `format` and `semanticsId` are stamped internally; the caller
 * cannot choose either value.
 *
 * @param price - The computed price.
 * @param currency - Optional expected historical currency.
 *
 * @returns The record, or `currency_mismatch` when the supplied currency does
 * not equal the price's own `(code, exponent)`.
 */
export function fromPrice(
  price: Price,
  currency?: PriceCurrency
): Result<PriceRecord, PricingError> {
  const recordCurrency: PriceCurrency = {
    code: price.subtotal.currency.code,
    exponent: price.subtotal.currency.exponent,
  };

  if (currency !== undefined && !currencyEquals(currency, recordCurrency)) {
    return failure(
      new PricingError("currency_mismatch", {
        details: { field: "currency", expectedCurrency: recordCurrency.code },
      })
    );
  }

  const modifiers: PriceModifierRecord[] = [];

  for (const modifier of price.modifiers) {
    const adjustment = modifier.adjustment;
    let recorded: PriceModifierRecord["adjustment"];

    if (adjustment.type === "money") {
      const amountCurrency: PriceCurrency = {
        code: adjustment.amount.currency.code,
        exponent: adjustment.amount.currency.exponent,
      };

      if (!currencyEquals(amountCurrency, recordCurrency)) {
        return failure(
          new PricingError("currency_mismatch", {
            details: { field: "amount", modifierCode: modifier.code },
          })
        );
      }

      recorded = {
        type: "money",
        amount: adjustment.amount.amount,
        operation: adjustment.operation,
      };
    } else {
      recorded = { type: "percentage", rate: adjustment.rate, operation: adjustment.operation };
    }

    modifiers.push({
      code: modifier.code,
      ...(modifier.label !== undefined ? { label: modifier.label } : {}),
      kind: modifier.kind,
      ...(modifier.component !== undefined ? { component: modifier.component } : {}),
      adjustment: recorded,
    });
  }

  return success({
    format: currentFormat(),
    currency: recordCurrency,
    subtotal: price.subtotal.amount,
    modifiers,
    total: price.total.amount,
    semanticsId: currentSemanticsId(),
  });
}
/**
 * Validates one finalized line record before aggregation (ADR-014 A14-15).
 *
 * Accepts malformed runtime values and returns a deterministic failure
 * instead of dereferencing them (ADR-014 A14-16).
 *
 * @param part - The line record to validate.
 * @param expected - The aggregate currency the part must share.
 *
 * @returns The validation error, or `null` when the part is eligible.
 */
function validatePart(part: PriceRecord, expected: PriceCurrency): PricingError | null {
  const value: unknown = part;

  if (!isPlainObject(value)) {
    return new PricingError("calculation_failed", { details: { field: "part" } });
  }

  const format = value["format"];

  if (format !== 1) {
    return new PricingError("unsupported_record_format", {
      details: typeof format === "number" ? { format } : { field: "format" },
    });
  }

  const semanticsId = value["semanticsId"];

  if (
    typeof semanticsId !== "number" ||
    !Number.isInteger(semanticsId) ||
    !isCurrentSemantics(semanticsId)
  ) {
    return new PricingError("calculation_failed", {
      details:
        typeof semanticsId === "number"
          ? { field: "semanticsId", semanticsId }
          : { field: "semanticsId" },
    });
  }

  const rawCurrency = value["currency"];
  const currencyError = validateCurrency(rawCurrency);

  if (currencyError !== null) {
    return currencyError;
  }

  if (!isPriceCurrency(rawCurrency)) {
    return new PricingError("invalid_currency", { details: { field: "currency" } });
  }

  if (!currencyEquals(rawCurrency, expected)) {
    return new PricingError("currency_mismatch", {
      details: { field: "currency", expectedCurrency: expected.code },
    });
  }

  const subtotal = value["subtotal"];

  if (typeof subtotal !== "bigint" || subtotal < 0n) {
    return new PricingError("invalid_amount", { details: { field: "subtotal" } });
  }

  const total = value["total"];

  if (typeof total !== "bigint" || total < 0n) {
    return new PricingError("invalid_amount", { details: { field: "total" } });
  }

  const rawModifiers = value["modifiers"];

  if (!Array.isArray(rawModifiers)) {
    return new PricingError("invalid_modifier", { details: { field: "modifiers" } });
  }

  const modifiers: PriceModifierRecord[] = [];

  for (const rawModifier of rawModifiers as unknown[]) {
    const error = validateModifierRecord(rawModifier);

    if (error !== null) {
      return error;
    }

    modifiers.push(rawModifier as PriceModifierRecord);
  }

  const computed = computeTotal(subtotal, modifiers);

  if (computed === null || computed !== total) {
    return new PricingError("calculation_failed", { details: { field: "total" } });
  }

  return null;
}

/**
 * Normalizes and validates one order-level adjustment (ADR-014 A14-14).
 *
 * @param adjustment - A live `PriceModifier` or a recorded modifier.
 * @param currency - The aggregate currency.
 *
 * @returns The recorded modifier, or the validation error.
 */
function normalizeAdjustment(
  adjustment: PriceModifier | PriceModifierRecord,
  currency: PriceCurrency
): Result<PriceModifierRecord, PricingError> {
  const value: unknown = adjustment;

  if (!isPlainObject(value)) {
    return failure(new PricingError("invalid_modifier", { details: { field: "modifier" } }));
  }

  const code = value["code"];
  const codeDetails = typeof code === "string" ? { modifierCode: code } : {};

  const raw = value["adjustment"];

  if (!isPlainObject(raw)) {
    return failure(
      new PricingError("invalid_modifier", { details: { field: "adjustment", ...codeDetails } })
    );
  }

  const operation = raw["operation"];

  if (operation !== "add" && operation !== "subtract") {
    return failure(
      new PricingError("invalid_modifier", { details: { field: "operation", ...codeDetails } })
    );
  }

  const type = raw["type"];
  let recorded: PriceModifierRecord["adjustment"];

  if (type === "money") {
    const amount = raw["amount"];

    if (typeof amount === "bigint") {
      if (amount < 0n) {
        return failure(
          new PricingError("invalid_amount", { details: { field: "amount", ...codeDetails } })
        );
      }

      recorded = { type: "money", amount, operation };
    } else if (isPlainObject(amount) && isPlainObject(amount["currency"])) {
      const rawCurrency = amount["currency"];
      const currencyCode = rawCurrency["code"];
      const currencyExponent = rawCurrency["exponent"];

      if (
        typeof currencyCode !== "string" ||
        typeof currencyExponent !== "number" ||
        !Number.isInteger(currencyExponent)
      ) {
        return failure(
          new PricingError("invalid_modifier", { details: { field: "amount", ...codeDetails } })
        );
      }

      const amountCurrency: PriceCurrency = {
        code: currencyCode,
        exponent: currencyExponent,
      };

      if (!currencyEquals(amountCurrency, currency)) {
        return failure(
          new PricingError("currency_mismatch", {
            details: {
              field: "amount",
              expectedCurrency: currency.code,
              ...codeDetails,
            },
          })
        );
      }

      const minorUnits = amount["amount"];

      if (typeof minorUnits !== "bigint" || minorUnits < 0n) {
        return failure(
          new PricingError("invalid_amount", { details: { field: "amount", ...codeDetails } })
        );
      }

      recorded = { type: "money", amount: minorUnits, operation };
    } else {
      return failure(
        new PricingError("invalid_modifier", { details: { field: "amount", ...codeDetails } })
      );
    }
  } else if (type === "percentage") {
    const rate = raw["rate"];

    if (!isPlainObject(rate)) {
      return failure(
        new PricingError("invalid_modifier", { details: { field: "rate", ...codeDetails } })
      );
    }

    recorded = { type: "percentage", rate: rate as unknown as Percentage, operation };
  } else {
    return failure(
      new PricingError("invalid_modifier", { details: { field: "type", ...codeDetails } })
    );
  }

  const modifier: PriceModifierRecord = {
    code: code as string,
    ...(value["label"] !== undefined ? { label: value["label"] as string } : {}),
    kind: value["kind"] as PriceModifierRecord["kind"],
    ...(value["component"] !== undefined ? { component: value["component"] as string } : {}),
    adjustment: recorded,
  };

  const error = validateModifierRecord(modifier);

  if (error !== null) {
    return failure(error);
  }

  return success(modifier);
}

/**
 * Composes an order-level record from finalized line records (ADR-014
 * A14-13…A14-17). Commit-time only; never used on a restoration path.
 *
 * @param parts - Finalized line records.
 * @param adjustments - Order-level adjustments, in order.
 *
 * @returns The composed record, or a pricing error.
 */
export function combine(
  parts: ReadonlyArray<PriceRecord>,
  adjustments: ReadonlyArray<PriceModifier | PriceModifierRecord>
): Result<PriceRecord, PricingError> {
  if (!Array.isArray(parts) || parts.length === 0) {
    return failure(new PricingError("calculation_failed", { details: { field: "parts" } }));
  }

  if (!Array.isArray(adjustments)) {
    return failure(new PricingError("calculation_failed", { details: { field: "adjustments" } }));
  }

  const first: unknown = parts[0];

  if (!isPlainObject(first)) {
    return failure(new PricingError("calculation_failed", { details: { field: "parts" } }));
  }

  const rawCurrency = first["currency"];
  const currencyError = validateCurrency(rawCurrency);

  if (currencyError !== null) {
    return failure(currencyError);
  }

  if (!isPriceCurrency(rawCurrency)) {
    return failure(new PricingError("invalid_currency", { details: { field: "currency" } }));
  }

  const currency = rawCurrency;
  let subtotal = 0n;

  for (const part of parts) {
    const error = validatePart(part, currency);

    if (error !== null) {
      return failure(error);
    }

    subtotal += part.total;
  }

  const modifiers: PriceModifierRecord[] = [];

  for (const adjustment of adjustments) {
    const normalized = normalizeAdjustment(adjustment, currency);

    if (isFailure(normalized)) {
      return normalized;
    }

    modifiers.push(normalized.value);
  }

  let running = subtotal;

  for (const modifier of modifiers) {
    const next = applyRecordedModifier(running, modifier);

    if (next === null) {
      return failure(
        new PricingError("calculation_failed", {
          details: { field: "total", modifierCode: modifier.code },
        })
      );
    }

    running = next;
  }

  return success({
    format: currentFormat(),
    currency,
    subtotal,
    modifiers,
    total: running,
    semanticsId: currentSemanticsId(),
  });
}
/**
 * Returns whether a value is a valid structural `PriceCurrency`.
 *
 * @param value - The value to check.
 *
 * @returns True when the value is a `PriceCurrency`.
 */
function isPriceCurrency(value: unknown): value is PriceCurrency {
  return validateCurrency(value) === null;
}

/**
 * Converts a record to its plain, JSON-safe wire form (ADR-014 §14.6).
 *
 * @param record - The record to serialize.
 *
 * @returns The plain record.
 */
export function toPlainRecord(record: PriceRecord): PlainPriceRecord {
  return {
    format: record.format,
    currency: { code: record.currency.code, exponent: record.currency.exponent },
    subtotal: record.subtotal.toString(),
    modifiers: record.modifiers.map(toPlainModifier),
    total: record.total.toString(),
    semanticsId: record.semanticsId,
  };
}

/**
 * Converts one recorded modifier to its plain wire form.
 *
 * @param modifier - The modifier to serialize.
 *
 * @returns The plain modifier.
 */
function toPlainModifier(modifier: PriceModifierRecord): PlainPriceRecord["modifiers"][number] {
  const adjustment = modifier.adjustment;

  return {
    code: modifier.code,
    ...(modifier.label !== undefined ? { label: modifier.label } : {}),
    kind: modifier.kind,
    ...(modifier.component !== undefined ? { component: modifier.component } : {}),
    adjustment:
      adjustment.type === "money"
        ? {
            type: "money",
            amount: adjustment.amount.toString(),
            operation: adjustment.operation,
          }
        : {
            type: "percentage",
            amount: adjustment.rate.amount.toString(),
            scale: adjustment.rate.scale,
            operation: adjustment.operation,
          },
  };
}
/**
 * Restores a record structurally from untrusted input (ADR-014 A14-6).
 *
 * Never calls `Currency.create`, consults the current currency table,
 * recomputes `total`, or repairs an amount.
 *
 * @param plain - The untrusted plain input.
 *
 * @returns The record, or a structural pricing error.
 */
export function restorePlainRecord(plain: unknown): Result<PriceRecord, PricingError> {
  if (!isPlainObject(plain)) {
    return failure(new PricingError("unsupported_record_format", { details: { field: "record" } }));
  }

  const format = plain["format"];

  if (format !== 1) {
    return failure(
      new PricingError("unsupported_record_format", {
        details: typeof format === "number" ? { format } : { field: "format" },
      })
    );
  }

  const rawCurrency = plain["currency"];
  const currencyError = validateCurrency(rawCurrency);

  if (currencyError !== null) {
    return failure(currencyError);
  }

  if (!isPriceCurrency(rawCurrency)) {
    return failure(new PricingError("invalid_currency", { details: { field: "currency" } }));
  }

  const subtotal = parseAmount(plain["subtotal"]);

  if (subtotal === null) {
    return failure(new PricingError("invalid_amount", { details: { field: "subtotal" } }));
  }

  const total = parseAmount(plain["total"]);

  if (total === null) {
    return failure(new PricingError("invalid_amount", { details: { field: "total" } }));
  }

  const rawModifiers = plain["modifiers"];

  if (!Array.isArray(rawModifiers)) {
    return failure(new PricingError("invalid_modifier", { details: { field: "modifiers" } }));
  }

  const modifiers: PriceModifierRecord[] = [];

  for (const rawModifier of rawModifiers as unknown[]) {
    const restored = restoreModifier(rawModifier);

    if (isFailure(restored)) {
      return restored;
    }

    modifiers.push(restored.value);
  }

  const semanticsId = plain["semanticsId"];

  if (typeof semanticsId !== "number" || !Number.isInteger(semanticsId) || semanticsId < 1) {
    return failure(
      new PricingError("unsupported_record_format", { details: { field: "semanticsId" } })
    );
  }

  return success({
    format: 1,
    currency: { code: rawCurrency.code, exponent: rawCurrency.exponent },
    subtotal,
    modifiers,
    total,
    semanticsId,
  });
}

/**
 * Restores one recorded modifier structurally.
 *
 * @param raw - The untrusted plain modifier.
 *
 * @returns The recorded modifier, or a structural pricing error.
 */
function restoreModifier(raw: unknown): Result<PriceModifierRecord, PricingError> {
  if (!isPlainObject(raw)) {
    return failure(new PricingError("invalid_modifier", { details: { field: "modifier" } }));
  }

  const code = raw["code"];

  if (typeof code !== "string" || code.trim().length === 0) {
    return failure(new PricingError("invalid_modifier", { details: { field: "code" } }));
  }

  const label = raw["label"];

  if (label !== undefined && typeof label !== "string") {
    return failure(new PricingError("invalid_modifier", { details: { field: "label" } }));
  }

  const kind = raw["kind"];

  if (!isPriceModifierKind(kind)) {
    return failure(new PricingError("invalid_modifier", { details: { field: "kind" } }));
  }

  const component = raw["component"];

  if (component !== undefined && typeof component !== "string") {
    return failure(new PricingError("invalid_modifier", { details: { field: "component" } }));
  }

  const rawAdjustment = raw["adjustment"];

  if (!isPlainObject(rawAdjustment)) {
    return failure(new PricingError("invalid_modifier", { details: { field: "adjustment" } }));
  }

  const operation = rawAdjustment["operation"];

  if (operation !== "add" && operation !== "subtract") {
    return failure(new PricingError("invalid_modifier", { details: { field: "operation" } }));
  }

  const type = rawAdjustment["type"];
  let adjustment: PriceModifierRecord["adjustment"];

  if (type === "money") {
    const amount = parseAmount(rawAdjustment["amount"]);

    if (amount === null) {
      return failure(new PricingError("invalid_amount", { details: { field: "amount" } }));
    }

    adjustment = { type: "money", amount, operation };
  } else if (type === "percentage") {
    const amount = parseAmount(rawAdjustment["amount"]);

    if (amount === null) {
      return failure(new PricingError("invalid_percentage", { details: { field: "amount" } }));
    }

    const scale = rawAdjustment["scale"];

    if (typeof scale !== "number" || !Number.isInteger(scale) || scale < 0) {
      return failure(new PricingError("invalid_percentage", { details: { field: "scale" } }));
    }

    const rate = Percentage.create(amount, scale);

    if (isFailure(rate)) {
      return rate;
    }

    adjustment = { type: "percentage", rate: rate.value, operation };
  } else {
    return failure(new PricingError("invalid_modifier", { details: { field: "type" } }));
  }

  return success({
    code,
    ...(label !== undefined ? { label } : {}),
    kind,
    ...(component !== undefined ? { component } : {}),
    adjustment,
  });
}

/**
 * Exposes the historical pricing inputs of a record only (ADR-014 §14.4).
 *
 * @param record - The record to read.
 *
 * @returns The recorded subtotal, ordered modifiers and semantics identifier.
 */
export function historicalInputs(record: PriceRecord): {
  /** Recorded subtotal, in integer minor units. */
  readonly subtotal: bigint;
  /** Recorded modifiers, in order. */
  readonly modifiers: ReadonlyArray<PriceModifierRecord>;
  /** Identifier of the pipeline that produced the total. */
  readonly semanticsId: number;
} {
  return {
    subtotal: record.subtotal,
    modifiers: [...record.modifiers],
    semanticsId: record.semanticsId,
  };
}
