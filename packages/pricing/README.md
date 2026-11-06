# @comity/pricing

Pricing domain for Comity commerce modules.

---

## Purpose

Owns the commercial pricing domain: the `Currency` Value Object (which owns
monetary precision via its ISO 4217 minor-unit exponent), the `Money` Value
Object (integer minor units), the `Percentage` Value Object for rates, the
`Price` Value Object with the `PriceModifier` value structure, the
`PriceSnapshot` point-in-time capture, the `PriceRecord` historical record
contract, and the pure `calculatePrice` engine.

> Catalog owns product definition, not commercial execution. Price belongs to
> `@comity/pricing`.

---

## Scope

This package:

- ✅ validates ISO 4217 currency codes and exposes their minor-unit precision
  (`Currency` with `exponent`)
- ✅ represents money as an integer count of the currency's minor unit
  (`Money`), with exact `add`/`subtract`/`multiply(bigint)` arithmetic
- ✅ represents precise percentage rates for percent modifiers (`Percentage`)
- ✅ computes a `Price` from a base amount and modifiers (`calculatePrice`),
  applied in input order with the total computed internally by
  `Price.create`
- ✅ models `PriceModifier` as a commercial-context descriptor carrying a
  `PriceAdjustment` discriminated union (`money`/`percentage` with an explicit
  `add`/`subtract` operation) that makes invalid states and hidden sign
  policies impossible
- ✅ models `PriceSnapshot` as a `Price` extended with the capture instant
- ✅ defines the persisted historical record (`PriceRecord`), its structural
  currency (`PriceCurrency`), its lossless plain wire form (`PlainPriceRecord`)
  and its historical verification (`PriceVerification`)
- ✅ provides `PriceRecord.from`, `combine`, `restore`, `toPlain` and `verify`
  as the record lifecycle, and `currentPriceCurrency` for current work
- ❌ implements storage or adapters — `PriceRecord` is the persistence
  contract, but the package contains no repository, I/O or database access
- ❌ formats money for humans — display (`$20`, `20€`) belongs to a dedicated
  formatter, out of scope
- ❌ converts currencies — future `ExchangeRate`/`ExchangeRateProvider`/
  `CurrencyConverter` domain services
- ❌ multiplies money by fractional quantities (kg, meters, consumption, time)
  — those are owned by their domain modules
- ❌ knows about products, inventory, or orders

---

## `Price` versus `PriceRecord`

- `Price` is the **transient result of a calculation**. It is created by
  `calculatePrice`/`Price.create`, has no identity and MUST NOT be persisted.
- `PriceRecord` is the **persisted historical representation**. It records
  `format`, `semanticsId`, `PriceCurrency`, integer minor-unit `subtotal` and
  `total`, and ordered modifier provenance. Consumers persist this record, not
  `Price` or `PriceSnapshot`.
- `PriceRecord.from(price)` records a computed `Price` and stamps the current
  `format`/`semanticsId`; callers cannot choose them.
- `PriceRecord.combine(parts, adjustments)` is the commit-time composition of
  finalized line records. It validates parts under current semantics, sums line
  totals, never reapplies line modifiers, and applies order adjustments once.
- `PriceRecord.toPlain(record)` / `PriceRecord.restore(plain)` are the lossless
  JSON-safe wire form and its structural restoration. Restoration never checks
  the current ISO table and never recomputes a total.
- `PriceRecord.verify(record)` re-executes the record's own frozen semantics for
  historical verification; it does not answer commit eligibility.
- `currentPriceCurrency(code)` admits a currency for a **new** calculation and
  is never used to validate a stored record.

Persistence adapters live outside this package. They should persist
`PlainPriceRecord` and restore it with `PriceRecord.restore`; they must not
serialize a live `PriceRecord` with `JSON.stringify`.

---

## Public API

- Currency contracts — ISO 4217 currency codes with minor-unit precision
- Money contracts — integer minor-unit monetary values with exact arithmetic
- Percentage contracts — precise percentage rates for modifiers
- Price contracts — base amounts with modifiers and point-in-time snapshots
- PriceRecord contracts — historical record (`PriceRecord`, `PriceCurrency`,
  `PriceModifierRecord`), lossless plain wire form (`PlainPriceRecord`) and
  historical verification (`PriceVerification`)
- Current-currency admission — `currentPriceCurrency` for new calculations
- Price calculation engine — pure `calculatePrice` function
- Error types — pricing failure reasons and metadata (`@comity/pricing/errors`)

No exhaustive reference; see docs for constraints.

---

## Documentation

- docs/overview.md
- docs/conventions.md

Detailed documentation lives in the repository. The npm tarball contains this
README (and `dist`), not the `docs/` directory; use the repository documentation
for the complete conventions and historical-record rationale.

---

## Related Packages

- @comity/catalog — product definition (no pricing); will reference
  `PriceSnapshot` only when `ProductProjection` includes it
- @comity/order — order domain consumes `PriceRecord`/`PriceCurrency` and
  calls `combine` under the ADR-008 value-import exception; other pricing
  contracts remain type-only

---

## Status

`0.9.3` is the current published release. `0.10.0` is in preparation and adds
the `PriceRecord`/`PriceCurrency` historical-record contract and the additive
`unsupported_record_format` reason; it is **not published yet**.
