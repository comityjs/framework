import type { PriceModifier } from "../../contracts/price-modifier.js";

import { isFailure } from "@comity/primitives/result";
import { describe, expect, it } from "vitest";
import { PriceRecord } from "../../contracts/price-record.js";
import { Currency } from "../../value-objects/currency.js";
import { Money } from "../../value-objects/money.js";
import { Percentage } from "../../value-objects/percentage.js";
import { Price } from "../../value-objects/price.js";

/*
 * Maintenance rule (ADR-014 §14.1/§14.3): when a new `semanticsId` is minted,
 * the previous identifier's implementation MUST be frozen independently,
 * including its validation and arithmetic. This suite exists to catch drift
 * between the live engine (`Price.create`) and the frozen current pipeline
 * (`computeTotal`, used by `verify` and `combine`) before such a fork exists.
 */

function unwrap<T>(result: { success: true; value: T } | { success: false }): T {
  if (isFailure(result)) {
    throw new Error("Unexpected failure");
  }

  return result.value;
}

const eur = unwrap(Currency.create("EUR"));
const money = (amount: bigint): Money => unwrap(Money.create(amount, eur));
const pct = (amount: bigint, scale = 0): Percentage => unwrap(Percentage.create(amount, scale));

function moneyModifier(code: string, amount: bigint, operation: "add" | "subtract"): PriceModifier {
  return {
    code,
    kind: "charge",
    adjustment: { type: "money", amount: money(amount), operation },
  };
}

function percentageModifier(
  code: string,
  amount: bigint,
  operation: "add" | "subtract",
  scale = 0
): PriceModifier {
  return {
    code,
    kind: "tax",
    adjustment: { type: "percentage", rate: pct(amount, scale), operation },
  };
}

interface CoherenceCase {
  readonly name: string;
  readonly subtotal: bigint;
  readonly modifiers: ReadonlyArray<PriceModifier>;
  readonly expectedTotal: bigint;
}

const cases: ReadonlyArray<CoherenceCase> = [
  {
    name: "fixed amount added",
    subtotal: 1000n,
    modifiers: [moneyModifier("fee", 250n, "add")],
    expectedTotal: 1250n,
  },
  {
    name: "fixed amount subtracted",
    subtotal: 1000n,
    modifiers: [moneyModifier("discount", 250n, "subtract")],
    expectedTotal: 750n,
  },
  {
    name: "whole percentage added",
    subtotal: 1000n,
    modifiers: [percentageModifier("tax", 10n, "add")],
    expectedTotal: 1100n,
  },
  {
    name: "whole percentage subtracted",
    subtotal: 1000n,
    modifiers: [percentageModifier("promo", 10n, "subtract")],
    expectedTotal: 900n,
  },
  {
    name: "half-up boundary 2405 at 10% (240.5 → 241)",
    subtotal: 2405n,
    modifiers: [percentageModifier("tax", 10n, "add")],
    expectedTotal: 2646n,
  },
  {
    name: "half-up boundary 5 at 50% (2.5 → 3)",
    subtotal: 5n,
    modifiers: [percentageModifier("tax", 50n, "add")],
    expectedTotal: 8n,
  },
  {
    name: "half-up boundary 1 at 50% (0.5 → 1)",
    subtotal: 1n,
    modifiers: [percentageModifier("tax", 50n, "add")],
    expectedTotal: 2n,
  },
  {
    name: "fractional percentage 4 at 12.5% (0.5 → 1)",
    subtotal: 4n,
    modifiers: [percentageModifier("tax", 125n, "add", 1)],
    expectedTotal: 5n,
  },
  {
    name: "zero subtotal with a percentage",
    subtotal: 0n,
    modifiers: [percentageModifier("tax", 10n, "add")],
    expectedTotal: 0n,
  },
  {
    name: "zero fixed amount",
    subtotal: 1000n,
    modifiers: [moneyModifier("fee", 0n, "add")],
    expectedTotal: 1000n,
  },
  {
    name: "subtraction down to exactly zero",
    subtotal: 1000n,
    modifiers: [moneyModifier("discount", 1000n, "subtract")],
    expectedTotal: 0n,
  },
  {
    name: "multiple modifiers in order",
    subtotal: 1000n,
    modifiers: [
      percentageModifier("tax", 10n, "add"),
      moneyModifier("coupon", 500n, "subtract"),
      percentageModifier("promo", 125n, "subtract", 1),
    ],
    expectedTotal: 525n,
  },
  {
    name: "amount above 2^53",
    subtotal: 9007199254740993n,
    modifiers: [moneyModifier("fee", 1n, "add")],
    expectedTotal: 9007199254740994n,
  },
];

describe("current semantics coherence (live Price vs frozen PriceRecord pipeline)", () => {
  it.each(cases)("$name", ({ subtotal, modifiers, expectedTotal }) => {
    const price = unwrap(Price.create(money(subtotal), modifiers));

    expect(price.total.amount).toBe(expectedTotal);

    const record = unwrap(PriceRecord.from(price));

    expect(record.subtotal).toBe(subtotal);
    expect(record.total).toBe(expectedTotal);
    expect(PriceRecord.verify(record)).toEqual({ outcome: "verified" });

    const restored = unwrap(PriceRecord.restore(PriceRecord.toPlain(record)));

    expect(PriceRecord.verify(restored)).toEqual({ outcome: "verified" });

    const combined = unwrap(PriceRecord.combine([record], []));

    expect(combined.subtotal).toBe(expectedTotal);
    expect(combined.total).toBe(expectedTotal);
  });
});
