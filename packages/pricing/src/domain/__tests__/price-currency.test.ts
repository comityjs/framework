import { isFailure } from "@comity/primitives/result";
import { describe, expect, it } from "vitest";
import { PricingError } from "../../errors/pricing.js";
import { currentPriceCurrency } from "../price-currency.js";

describe("currentPriceCurrency", () => {
  it("returns the structural currency for an active code", () => {
    const result = currentPriceCurrency("EUR");

    expect(isFailure(result)).toBe(false);
    if (!isFailure(result)) {
      expect(result.value).toEqual({ code: "EUR", exponent: 2 });
    }
  });

  it("keeps the currency's own exponent", () => {
    const jpy = currentPriceCurrency("JPY");
    const kwd = currentPriceCurrency("KWD");

    expect(isFailure(jpy)).toBe(false);
    expect(isFailure(kwd)).toBe(false);
    if (!isFailure(jpy) && !isFailure(kwd)) {
      expect(jpy.value.exponent).toBe(0);
      expect(kwd.value.exponent).toBe(3);
    }
  });

  it("normalizes the code to uppercase", () => {
    const result = currentPriceCurrency("eur");

    expect(isFailure(result)).toBe(false);
    if (!isFailure(result)) {
      expect(result.value.code).toBe("EUR");
    }
  });

  it("rejects an unknown code with invalid_currency", () => {
    const result = currentPriceCurrency("ZZZ");

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error).toBeInstanceOf(PricingError);
      expect(result.error.code).toBe("pricing:invalid_currency");
    }
  });
});
