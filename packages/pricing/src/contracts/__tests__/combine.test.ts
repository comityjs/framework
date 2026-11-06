import type { PriceModifier } from "../../contracts/price-modifier.js";
import type {
  PriceModifierRecord,
  PriceRecord as PriceRecordData,
} from "../../contracts/price-record.js";

import { isFailure } from "@comity/primitives/result";
import { describe, expect, it } from "vitest";
import { PriceRecord } from "../../contracts/price-record.js";
import { Currency } from "../../value-objects/currency.js";
import { Money } from "../../value-objects/money.js";
import { Percentage } from "../../value-objects/percentage.js";
import { Price } from "../../value-objects/price.js";
import { currentSemanticsId } from "../../domain/pricing-semantics.js";

function unwrap<T>(result: { success: true; value: T } | { success: false }): T {
  if (isFailure(result)) {
    throw new Error("Unexpected failure");
  }

  return result.value;
}

const eur = unwrap(Currency.create("EUR"));
const usd = unwrap(Currency.create("USD"));
const money = (amount: bigint, currency = eur): Money => unwrap(Money.create(amount, currency));
const pct = (amount: bigint, scale = 0): Percentage => unwrap(Percentage.create(amount, scale));
const price = (
  amount: bigint,
  modifiers: ReadonlyArray<PriceModifier> = [],
  currency = eur
): Price => unwrap(Price.create(money(amount, currency), modifiers));

const recordFrom = (value: Price): PriceRecordData => unwrap(PriceRecord.from(value));

const tenPercentOff: PriceModifier = {
  code: "promo",
  kind: "discount",
  adjustment: { type: "percentage", rate: pct(10n), operation: "subtract" },
};
const fiveHundredOff: PriceModifier = {
  code: "coupon",
  kind: "discount",
  adjustment: { type: "money", amount: money(500n), operation: "subtract" },
};

const lineA = recordFrom(price(1000n, [tenPercentOff]));
const lineB = recordFrom(price(2000n, [fiveHundredOff]));

function recordOf(overrides: Partial<PriceRecordData> = {}): PriceRecordData {
  return {
    format: 1,
    currency: { code: "EUR", exponent: 2 },
    subtotal: 1000n,
    modifiers: [],
    total: 1000n,
    semanticsId: currentSemanticsId(),
    ...overrides,
  };
}

describe("PriceRecord.combine", () => {
  it("preserves the total of a single part with no order adjustments", () => {
    const combined = unwrap(PriceRecord.combine([lineA], []));

    expect(combined.subtotal).toBe(900n);
    expect(combined.total).toBe(900n);
    expect(combined.modifiers).toEqual([]);
    expect(combined.format).toBe(1);
    expect(combined.semanticsId).toBe(currentSemanticsId());
  });

  it("validates line modifiers without reapplying them", () => {
    const priced = recordFrom(price(1000n, [fiveHundredOff]));
    const combined = unwrap(PriceRecord.combine([priced], []));

    expect(priced.total).toBe(500n);
    expect(combined.subtotal).toBe(500n);
    expect(combined.total).toBe(500n);
    expect(combined.modifiers).toEqual([]);
  });

  it("aggregates multiple part totals exactly", () => {
    const combined = unwrap(PriceRecord.combine([lineA, lineB], []));

    expect(combined.subtotal).toBe(2400n);
    expect(combined.total).toBe(2400n);
  });

  it("applies an order-level adjustment exactly once after aggregation", () => {
    const fee: PriceModifier = {
      code: "fee",
      kind: "charge",
      adjustment: { type: "percentage", rate: pct(10n), operation: "add" },
    };
    const combined = unwrap(PriceRecord.combine([lineA, lineB], [fee]));

    expect(combined.subtotal).toBe(2400n);
    expect(combined.total).toBe(2640n);
    expect(combined.modifiers).toHaveLength(1);
    expect(combined.modifiers[0]?.code).toBe("fee");
  });

  it("accepts recorded modifiers as order adjustments", () => {
    const fee: PriceModifierRecord = {
      code: "fee",
      kind: "charge",
      adjustment: { type: "money", amount: 500n, operation: "add" },
    };
    const combined = unwrap(PriceRecord.combine([lineA, lineB], [fee]));

    expect(combined.total).toBe(2900n);
    expect(combined.modifiers[0]?.adjustment).toEqual({
      type: "money",
      amount: 500n,
      operation: "add",
    });
  });

  it("preserves the supplied order of adjustments", () => {
    const fee: PriceModifier = {
      code: "fee",
      kind: "charge",
      adjustment: { type: "percentage", rate: pct(10n), operation: "add" },
    };
    const discount: PriceModifier = {
      code: "coupon",
      kind: "discount",
      adjustment: { type: "money", amount: money(500n), operation: "subtract" },
    };
    const feeThenDiscount = unwrap(PriceRecord.combine([lineA, lineB], [fee, discount]));
    const discountThenFee = unwrap(PriceRecord.combine([lineA, lineB], [discount, fee]));

    expect(feeThenDiscount.total).toBe(2140n);
    expect(discountThenFee.total).toBe(2090n);
    expect(feeThenDiscount.modifiers.map((modifier) => modifier.code)).toEqual(["fee", "coupon"]);
  });
  it("rejects different currency codes", () => {
    const other = recordOf({ currency: { code: "USD", exponent: 2 } });
    const result = PriceRecord.combine([lineA, other], []);

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.code).toBe("pricing:currency_mismatch");
    }
  });

  it("rejects a different exponent for the same code", () => {
    const other = recordOf({ currency: { code: "EUR", exponent: 3 } });
    const result = PriceRecord.combine([lineA, other], []);

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.code).toBe("pricing:currency_mismatch");
    }
  });

  it("rejects an unsupported record format", () => {
    const other = recordOf({ format: 2 as unknown as 1 });
    const result = PriceRecord.combine([lineA, other], []);

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.code).toBe("pricing:unsupported_record_format");
    }
  });

  it("rejects non-current and unknown semantics", () => {
    for (const semanticsId of [currentSemanticsId() + 1, 999]) {
      const other = recordOf({ semanticsId });
      const result = PriceRecord.combine([lineA, other], []);

      expect(isFailure(result), String(semanticsId)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code, String(semanticsId)).toBe("pricing:calculation_failed");
      }
    }
  });

  it("rejects an internally incoherent input part", () => {
    const incoherent = recordOf({ total: 1001n });
    const result = PriceRecord.combine([incoherent], []);

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.code).toBe("pricing:calculation_failed");
    }
  });

  it("rejects an invalid modifier on an input part", () => {
    const invalid: PriceModifierRecord = {
      code: "zero",
      kind: "charge",
      adjustment: { type: "percentage", rate: pct(0n), operation: "add" },
    };
    const result = PriceRecord.combine([recordOf({ modifiers: [invalid] })], []);

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.code).toBe("pricing:invalid_modifier");
    }
  });

  it("rejects a malformed input part structure", () => {
    const notArray = recordOf({
      modifiers: "bad" as unknown as ReadonlyArray<PriceModifierRecord>,
    });
    const negative = recordOf({ subtotal: -1n });

    expect(isFailure(PriceRecord.combine([notArray], []))).toBe(true);
    expect(isFailure(PriceRecord.combine([negative], []))).toBe(true);
  });

  it("rejects an invalid order adjustment", () => {
    const zeroRate: PriceModifier = {
      code: "zero",
      kind: "charge",
      adjustment: { type: "percentage", rate: pct(0n), operation: "add" },
    };
    const negative: PriceModifierRecord = {
      code: "negative",
      kind: "charge",
      adjustment: { type: "money", amount: -1n, operation: "add" },
    };
    const badOperation: PriceModifier = {
      code: "bad",
      kind: "charge",
      adjustment: {
        type: "money",
        amount: money(1n),
        operation: "multiply" as unknown as "add",
      },
    };

    const zeroRateResult = PriceRecord.combine([lineA], [zeroRate]);
    const negativeResult = PriceRecord.combine([lineA], [negative]);
    const badOperationResult = PriceRecord.combine([lineA], [badOperation]);

    expect(isFailure(zeroRateResult) && zeroRateResult.error.code).toBe("pricing:invalid_modifier");
    expect(isFailure(negativeResult) && negativeResult.error.code).toBe("pricing:invalid_amount");
    expect(isFailure(badOperationResult) && badOperationResult.error.code).toBe(
      "pricing:invalid_modifier"
    );
  });

  it("rejects an order money adjustment in another currency", () => {
    const usdFee: PriceModifier = {
      code: "fee",
      kind: "charge",
      adjustment: { type: "money", amount: money(100n, usd), operation: "add" },
    };
    const result = PriceRecord.combine([lineA], [usdFee]);

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.code).toBe("pricing:currency_mismatch");
    }
  });

  it("rejects empty parts", () => {
    const result = PriceRecord.combine([], []);

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.code).toBe("pricing:calculation_failed");
    }
  });

  it("rounds an order-level percentage half-up at the minor unit", () => {
    const part = recordOf({ subtotal: 2405n, total: 2405n });
    const tenPercent: PriceModifier = {
      code: "fee",
      kind: "charge",
      adjustment: { type: "percentage", rate: pct(10n), operation: "add" },
    };
    const combined = unwrap(PriceRecord.combine([part], [tenPercent]));

    expect(combined.subtotal).toBe(2405n);
    expect(combined.total).toBe(2646n);
    expect(combined.total - combined.subtotal).toBe(241n);
  });

  it("accepts recorded percentage adjustments without normalizing provenance or order", () => {
    const tax: PriceModifierRecord = {
      code: "tax",
      kind: "tax",
      adjustment: { type: "percentage", rate: pct(125n, 1), operation: "add" },
    };
    const fee: PriceModifierRecord = {
      code: "fee",
      kind: "charge",
      adjustment: { type: "percentage", rate: pct(10n), operation: "add" },
    };
    const combined = unwrap(PriceRecord.combine([lineA], [tax, fee]));

    expect(combined.subtotal).toBe(900n);
    expect(combined.total).toBe(1114n);
    expect(combined.modifiers.map((modifier) => modifier.code)).toEqual(["tax", "fee"]);

    const first = combined.modifiers[0]?.adjustment;
    const second = combined.modifiers[1]?.adjustment;

    expect(first?.type).toBe("percentage");
    expect(second?.type).toBe("percentage");
    if (first?.type === "percentage" && second?.type === "percentage") {
      expect(first.rate.amount).toBe(125n);
      expect(first.rate.scale).toBe(1);
      expect(second.rate.amount).toBe(10n);
      expect(second.rate.scale).toBe(0);
    }

    expect(PriceRecord.toPlain(combined).modifiers.map((modifier) => modifier.adjustment)).toEqual([
      { type: "percentage", amount: "125", scale: 1, operation: "add" },
      { type: "percentage", amount: "10", scale: 0, operation: "add" },
    ]);
  });

  it("is idempotent under a second flatten", () => {
    const fee: PriceModifier = {
      code: "fee",
      kind: "charge",
      adjustment: { type: "percentage", rate: pct(10n), operation: "add" },
    };
    const first = unwrap(PriceRecord.combine([lineA, lineB], [fee]));
    const flattened = unwrap(PriceRecord.combine([first], []));
    const flattenedAgain = unwrap(PriceRecord.combine([flattened], []));

    expect(flattened.subtotal).toBe(2640n);
    expect(flattened.total).toBe(2640n);
    expect(flattened.modifiers).toEqual([]);
    expect(PriceRecord.toPlain(flattenedAgain)).toEqual(PriceRecord.toPlain(flattened));
  });
});

describe("PriceRecord.combine runtime robustness", () => {
  const malformedMoneyNumber = {
    code: "bad",
    kind: "charge",
    adjustment: { type: "money", amount: 100, operation: "add" },
  } as unknown as PriceModifierRecord;

  it("rejects a money adjustment whose amount is a number", () => {
    const result = PriceRecord.combine([lineA], [malformedMoneyNumber]);

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.code).toBe("pricing:invalid_modifier");
    }
  });

  it("rejects a money adjustment with a missing amount", () => {
    const malformed = {
      code: "bad",
      kind: "charge",
      adjustment: { type: "money", operation: "add" },
    } as unknown as PriceModifierRecord;
    const result = PriceRecord.combine([lineA], [malformed]);

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.code).toBe("pricing:invalid_modifier");
    }
  });

  it("rejects a percentage adjustment with a missing rate", () => {
    const malformed = {
      code: "bad",
      kind: "charge",
      adjustment: { type: "percentage", operation: "add" },
    } as unknown as PriceModifierRecord;
    const result = PriceRecord.combine([lineA], [malformed]);

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.code).toBe("pricing:invalid_modifier");
    }
  });

  it("rejects a null part", () => {
    const result = PriceRecord.combine([lineA, null as unknown as PriceRecordData], []);

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.code).toBe("pricing:calculation_failed");
    }
  });

  it("rejects a null adjustment", () => {
    const result = PriceRecord.combine([lineA], [null as unknown as PriceModifier]);

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.code).toBe("pricing:invalid_modifier");
    }
  });

  it("rejects a part containing a malformed modifier record", () => {
    const result = PriceRecord.combine([recordOf({ modifiers: [malformedMoneyNumber] })], []);

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.code).toBe("pricing:invalid_modifier");
    }
  });

  it("rejects non-array runtime inputs", () => {
    const badParts = PriceRecord.combine("parts" as unknown as PriceRecordData[], []);
    const badAdjustments = PriceRecord.combine(
      [lineA],
      "adjustments" as unknown as PriceModifier[]
    );

    expect(isFailure(badParts)).toBe(true);
    expect(isFailure(badAdjustments)).toBe(true);
    if (isFailure(badParts) && isFailure(badAdjustments)) {
      expect(badParts.error.code).toBe("pricing:calculation_failed");
      expect(badAdjustments.error.code).toBe("pricing:calculation_failed");
    }
  });
});

describe("PriceRecord.combine properties", () => {
  it("is independent of part order", () => {
    const forward = unwrap(PriceRecord.combine([lineA, lineB], []));
    const backward = unwrap(PriceRecord.combine([lineB, lineA], []));

    expect(forward.subtotal).toBe(backward.subtotal);
    expect(forward.total).toBe(backward.total);
    expect(forward.modifiers).toEqual(backward.modifiers);
  });

  it("flattens a single part while preserving its total", () => {
    const priced = recordFrom(price(1000n, [fiveHundredOff]));
    const flattened = unwrap(PriceRecord.combine([priced], []));

    expect(flattened.subtotal).toBe(priced.total);
    expect(flattened.total).toBe(priced.total);
    expect(flattened.modifiers).toEqual([]);
  });

  it("is not associative when intermediate combinations apply adjustments", () => {
    const fee: PriceModifier = {
      code: "fee",
      kind: "charge",
      adjustment: { type: "percentage", rate: pct(10n), operation: "add" },
    };
    const direct = unwrap(PriceRecord.combine([lineA, lineB], [fee]));
    const inner = unwrap(PriceRecord.combine([lineA], [fee]));
    const nested = unwrap(PriceRecord.combine([inner, lineB], []));

    expect(direct.total).toBe(2640n);
    expect(nested.total).toBe(2490n);
    expect(direct.total).not.toBe(nested.total);
  });
});
