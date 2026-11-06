import type { Result } from "@comity/primitives/result";
import type { PriceCurrency } from "../contracts/price-record.js";

import { isFailure, success } from "@comity/primitives/result";
import type { PricingError } from "../errors/pricing.js";
import { Currency } from "../value-objects/currency.js";

/**
 * Admits a currency for a **new** calculation (ADR-014 §13).
 *
 * This is the current-currency gate for new work; it is never used on a
 * restoration path and never validates a historical record.
 *
 * @param code - The ISO 4217 currency code.
 *
 * @returns The structural `PriceCurrency`, or `invalid_currency`.
 */
export function currentPriceCurrency(code: string): Result<PriceCurrency, PricingError> {
  const currency = Currency.create(code);

  if (isFailure(currency)) {
    return currency;
  }

  return success({ code: currency.value.code, exponent: currency.value.exponent });
}
