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
import {
  currentFormat,
  currentSemanticsId,
  isCurrentSemantics,
  isPriceModifierKind,
  verifyRecord,
} from "../pricing-semantics.js";

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

const tenPercent: PriceModifier = {
  code: "promo",
  kind: "discount",
  adjustment: { type: "percentage", rate: pct(10n), operation: "subtract" },
};

describe("pricing semantics identity", () => {
  it("exposes the current format and a stable current semantics identifier", () => {
    expect(currentFormat()).toBe(1);
    expect(Number.isInteger(currentSemanticsId())).toBe(true);
    expect(currentSemanticsId()).toBeGreaterThanOrEqual(1);
  });

  it("recognises only the current semantics identifier", () => {
    expect(isCurrentSemantics(currentSemanticsId())).toBe(true);
    expect(isCurrentSemantics(currentSemanticsId() + 1)).toBe(false);
  });

  it("validates modifier kinds structurally", () => {
    expect(isPriceModifierKind("discount")).toBe(true);
    expect(isPriceModifierKind("other")).toBe(true);
    expect(isPriceModifierKind("bundle")).toBe(false);
    expect(isPriceModifierKind(1)).toBe(false);
  });
});

describe("verifyRecord", () => {
  it("verifies a record produced by the current pipeline", () => {
    const record = unwrap(PriceRecord.from(price(1000n, [tenPercent])));

    expect(verifyRecord(record)).toEqual({ outcome: "verified" });
  });

  it("reports a mismatch when the recorded total is not what its semantics produce", () => {
    const record = unwrap(PriceRecord.from(price(1000n, [tenPercent])));
    const tampered: PriceRecordData = { ...record, total: record.total + 1n };

    expect(verifyRecord(tampered)).toEqual({ outcome: "mismatch" });
  });

  it("reports unverifiable for an unknown semantics identifier", () => {
    const record = unwrap(PriceRecord.from(price(1000n)));
    const unknown: PriceRecordData = { ...record, semanticsId: 999 };

    expect(verifyRecord(unknown)).toEqual({
      outcome: "unverifiable",
      cause: "unknown_semantics",
    });
  });

  it("reports unspecified for a malformed semantics identifier", () => {
    const record = unwrap(PriceRecord.from(price(1000n)));
    const malformed: PriceRecordData = { ...record, semanticsId: 1.5 };

    expect(verifyRecord(malformed)).toEqual({
      outcome: "unverifiable",
      cause: "unspecified",
    });
  });

  it("does not report verified merely because current arithmetic matches an older identifier", () => {
    const record = unwrap(PriceRecord.from(price(1000n, [tenPercent])));
    const older: PriceRecordData = { ...record, semanticsId: currentSemanticsId() + 1 };

    expect(verifyRecord(older)).toEqual({
      outcome: "unverifiable",
      cause: "unknown_semantics",
    });
  });

  it("reports a mismatch for a structurally restored but incoherent record", () => {
    const record = unwrap(PriceRecord.from(price(1000n, [tenPercent])));
    const plain = PriceRecord.toPlain(record);
    const restored = unwrap(
      PriceRecord.restore({ ...plain, total: (record.total + 1n).toString() })
    );

    expect(restored.total).toBe(record.total + 1n);
    expect(verifyRecord(restored)).toEqual({ outcome: "mismatch" });
  });

  it("reports a mismatch for a recorded modifier that is invalid under its semantics", () => {
    const record = unwrap(PriceRecord.from(price(1000n)));
    const invalidRate: PriceModifierRecord = {
      code: "zero",
      kind: "charge",
      adjustment: { type: "percentage", rate: pct(0n), operation: "add" },
    };
    const malformed: PriceRecordData = { ...record, modifiers: [invalidRate] };

    expect(verifyRecord(malformed)).toEqual({ outcome: "mismatch" });
  });
});

describe("verifyRecord runtime robustness", () => {
  it("reports mismatch instead of throwing for malformed modifier records", () => {
    const record = unwrap(PriceRecord.from(price(1000n)));
    const cases: ReadonlyArray<unknown> = [
      null,
      { code: 42, kind: "charge", adjustment: { type: "money", amount: 100n, operation: "add" } },
      { code: "bad", kind: "charge", adjustment: { type: "money", amount: 100, operation: "add" } },
      { code: "bad", kind: "charge", adjustment: { type: "money", operation: "add" } },
      { code: "bad", kind: "charge", adjustment: { type: "percentage", operation: "add" } },
      {
        code: "bad",
        kind: "charge",
        adjustment: { type: "percentage", rate: { amount: 10, scale: 0 }, operation: "add" },
      },
    ];

    for (const malformed of cases) {
      const candidate: PriceRecordData = {
        ...record,
        modifiers: [malformed as PriceModifierRecord],
      };

      expect(verifyRecord(candidate)).toEqual({ outcome: "mismatch" });
    }
  });
});
