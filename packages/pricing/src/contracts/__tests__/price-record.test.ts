import type { PriceModifier } from "../../contracts/price-modifier.js";

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
const money = (amount: bigint): Money => unwrap(Money.create(amount, eur));
const pct = (amount: bigint, scale = 0): Percentage => unwrap(Percentage.create(amount, scale));
const price = (amount: bigint, modifiers: ReadonlyArray<PriceModifier> = []): Price =>
  unwrap(Price.create(money(amount), modifiers));

const feeModifier: PriceModifier = {
  code: "fee",
  label: "Handling fee",
  kind: "charge",
  component: "shipping",
  adjustment: { type: "money", amount: money(500n), operation: "add" },
};

const discountModifier: PriceModifier = {
  code: "promo",
  label: "Promotion",
  kind: "discount",
  component: "marketing",
  adjustment: { type: "percentage", rate: pct(125n, 1), operation: "subtract" },
};

describe("PriceRecord.from", () => {
  it("stamps the current format and semantics and preserves amounts", () => {
    const record = unwrap(PriceRecord.from(price(1000n, [feeModifier])));

    expect(record.format).toBe(1);
    expect(record.semanticsId).toBe(currentSemanticsId());
    expect(record.currency).toEqual({ code: "EUR", exponent: 2 });
    expect(record.subtotal).toBe(1000n);
    expect(record.total).toBe(1500n);
  });

  it("maps money and percentage modifiers to their recorded form", () => {
    const record = unwrap(PriceRecord.from(price(1000n, [feeModifier, discountModifier])));

    expect(record.modifiers).toHaveLength(2);
    expect(record.modifiers[0]).toEqual({
      code: "fee",
      label: "Handling fee",
      kind: "charge",
      component: "shipping",
      adjustment: { type: "money", amount: 500n, operation: "add" },
    });
    expect(record.modifiers[1]?.adjustment.type).toBe("percentage");
    if (record.modifiers[1]?.adjustment.type === "percentage") {
      expect(record.modifiers[1].adjustment.rate.amount).toBe(125n);
      expect(record.modifiers[1].adjustment.rate.scale).toBe(1);
    }
  });

  it("accepts a matching historical currency", () => {
    const record = PriceRecord.from(price(1000n), { code: "EUR", exponent: 2 });

    expect(isFailure(record)).toBe(false);
  });

  it("rejects a non-matching historical currency", () => {
    const record = PriceRecord.from(price(1000n), { code: "EUR", exponent: 3 });

    expect(isFailure(record)).toBe(true);
    if (isFailure(record)) {
      expect(record.error.code).toBe("pricing:currency_mismatch");
    }
  });
});

describe("PriceRecord.toPlain and restore", () => {
  it("serializes amounts as decimal strings and percentages as (amount, scale)", () => {
    const record = unwrap(PriceRecord.from(price(1000n, [feeModifier, discountModifier])));
    const plain = PriceRecord.toPlain(record);

    expect(plain.subtotal).toBe("1000");
    expect(plain.total).toBe(record.total.toString());
    expect(plain.modifiers[0]?.adjustment).toEqual({
      type: "money",
      amount: "500",
      operation: "add",
    });
    expect(plain.modifiers[1]?.adjustment).toEqual({
      type: "percentage",
      amount: "125",
      scale: 1,
      operation: "subtract",
    });
  });

  it("round-trips bigint amounts above 2^53 losslessly", () => {
    const large = 9007199254740993n;
    const record = unwrap(PriceRecord.from(price(large)));
    const restored = unwrap(PriceRecord.restore(PriceRecord.toPlain(record)));

    expect(restored.subtotal).toBe(large);
    expect(restored.total).toBe(large);
    expect(PriceRecord.toPlain(restored)).toEqual(PriceRecord.toPlain(record));
  });

  it("round-trips losslessly and idempotently", () => {
    const record = unwrap(PriceRecord.from(price(1000n, [feeModifier, discountModifier])));
    const plain = PriceRecord.toPlain(record);
    const restored = unwrap(PriceRecord.restore(plain));

    expect(PriceRecord.toPlain(restored)).toEqual(plain);
    expect(PriceRecord.toPlain(unwrap(PriceRecord.restore(PriceRecord.toPlain(restored))))).toEqual(
      plain
    );
  });
  it("preserves modifier order and legitimate duplicates", () => {
    const duplicate: PriceModifier = {
      code: "fee",
      kind: "charge",
      adjustment: { type: "money", amount: money(100n), operation: "add" },
    };
    const record = unwrap(PriceRecord.from(price(1000n, [duplicate, duplicate])));
    const restored = unwrap(PriceRecord.restore(PriceRecord.toPlain(record)));

    expect(restored.modifiers).toHaveLength(2);
    expect(restored.modifiers.map((modifier) => modifier.code)).toEqual(["fee", "fee"]);
    expect(restored.total).toBe(1200n);
  });

  it("preserves optional label/component presence and absence", () => {
    const bare: PriceModifier = {
      code: "bare",
      kind: "charge",
      adjustment: { type: "money", amount: money(100n), operation: "add" },
    };
    const record = unwrap(PriceRecord.from(price(1000n, [bare, feeModifier])));
    const restored = unwrap(PriceRecord.restore(PriceRecord.toPlain(record)));

    expect(restored.modifiers[0]?.label).toBeUndefined();
    expect(restored.modifiers[0]?.component).toBeUndefined();
    expect(restored.modifiers[1]?.label).toBe("Handling fee");
    expect(restored.modifiers[1]?.component).toBe("shipping");
  });

  it("restores a withdrawn currency code structurally", () => {
    const record = unwrap(PriceRecord.from(price(1000n)));
    const plain = { ...PriceRecord.toPlain(record), currency: { code: "ZZZ", exponent: 2 } };
    const restored = unwrap(PriceRecord.restore(plain));

    expect(restored.currency).toEqual({ code: "ZZZ", exponent: 2 });
  });

  it("restores a zero percentage structurally", () => {
    const record = unwrap(PriceRecord.from(price(1000n)));
    const plain = PriceRecord.toPlain(record);
    const zeroRate = {
      ...plain,
      modifiers: [
        {
          code: "zero",
          kind: "charge" as const,
          adjustment: {
            type: "percentage" as const,
            amount: "0",
            scale: 0,
            operation: "add" as const,
          },
        },
      ],
    };

    expect(isFailure(PriceRecord.restore(zeroRate))).toBe(false);
  });

  it("rejects unsupported formats", () => {
    const plain = PriceRecord.toPlain(unwrap(PriceRecord.from(price(1000n))));

    for (const format of [2, 0, "1", undefined]) {
      const result = PriceRecord.restore({ ...plain, format });

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("pricing:unsupported_record_format");
      }
    }
  });

  it("rejects non-object input structurally", () => {
    for (const value of [null, "record", 42, []]) {
      const result = PriceRecord.restore(value);

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("pricing:unsupported_record_format");
      }
    }
  });

  it("rejects malformed monetary strings", () => {
    const plain = PriceRecord.toPlain(unwrap(PriceRecord.from(price(1000n))));

    for (const subtotal of ["1.5", "-1", "abc", "", 1000]) {
      const result = PriceRecord.restore({ ...plain, subtotal });

      expect(isFailure(result)).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code).toBe("pricing:invalid_amount");
      }
    }
  });

  it("rejects malformed currencies and semantics identifiers", () => {
    const plain = PriceRecord.toPlain(unwrap(PriceRecord.from(price(1000n))));

    const badCode = PriceRecord.restore({ ...plain, currency: { code: "", exponent: 2 } });
    const badExponent = PriceRecord.restore({ ...plain, currency: { code: "EUR", exponent: -1 } });
    const badSemantics = PriceRecord.restore({ ...plain, semanticsId: 0 });

    expect(isFailure(badCode) && badCode.error.code).toBe("pricing:invalid_currency");
    expect(isFailure(badExponent) && badExponent.error.code).toBe("pricing:invalid_currency");
    expect(isFailure(badSemantics) && badSemantics.error.code).toBe(
      "pricing:unsupported_record_format"
    );
  });

  it("rejects malformed modifier records", () => {
    const plain = PriceRecord.toPlain(unwrap(PriceRecord.from(price(1000n, [feeModifier]))));
    const modifier = plain.modifiers[0];
    const cases: ReadonlyArray<readonly [string, unknown, string]> = [
      ["code", { ...modifier, code: "" }, "pricing:invalid_modifier"],
      ["kind", { ...modifier, kind: "bundle" }, "pricing:invalid_modifier"],
      [
        "operation",
        { ...modifier, adjustment: { type: "money", amount: "1", operation: "multiply" } },
        "pricing:invalid_modifier",
      ],
      [
        "money amount",
        { ...modifier, adjustment: { type: "money", amount: "1.5", operation: "add" } },
        "pricing:invalid_amount",
      ],
      [
        "percentage scale",
        {
          ...modifier,
          adjustment: { type: "percentage", amount: "10", scale: -1, operation: "add" },
        },
        "pricing:invalid_percentage",
      ],
    ];

    for (const [name, candidate, code] of cases) {
      const result = PriceRecord.restore({ ...plain, modifiers: [candidate] });

      expect(isFailure(result), name).toBe(true);
      if (isFailure(result)) {
        expect(result.error.code, name).toBe(code);
      }
    }
  });
});

describe("PriceRecord.historicalInputs", () => {
  it("returns historical inputs only", () => {
    const record = unwrap(PriceRecord.from(price(1000n, [feeModifier])));
    const inputs = PriceRecord.historicalInputs(record);

    expect(inputs.subtotal).toBe(1000n);
    expect(inputs.modifiers).toHaveLength(1);
    expect(inputs.semanticsId).toBe(record.semanticsId);
    expect(inputs).not.toHaveProperty("total");
  });
});
