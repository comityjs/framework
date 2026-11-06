# @comity/pricing — Overview

`@comity/pricing` is the pricing domain module for Comity commerce.

It exists so higher-level packages (catalog, order) can share a precise money
and price model without coupling pricing decisions to product definition or
order processing.

## What it includes

- `Currency` — ISO 4217 currency Value Object, always created valid via
  `Currency.create(code): Result<Currency, PricingError>`; owns monetary
  precision through its `exponent` (the number of decimal places of a
  monetary amount: `USD`/`EUR` → 2, `JPY` → 0, `KWD` → 3)
- `Money` — immutable `bigint` amount in the currency's minor unit, always
  created valid via `Money.create(amount: bigint, currency)`, with exact
  arithmetic (`add()`, `subtract()`, `multiply(bigint)`) and safe
  cross-currency checks (`currency_mismatch`)
- `Percentage` — Value Object for precise percentage rates
  (`20%`, `12.5%`, `7.25%`), internal scaled integer hidden from the contract,
  arbitrary non-negative scale
- `Price` — Value Object whose `total` is computed internally by
  `Price.create(subtotal, modifiers)`, so subtotal/modifiers/total are always
  coherent; no identity, no lifecycle
- `PriceModifier` — serializable commercial-context descriptor (`code`,
  `label`, `kind`, `component`) carrying a `PriceAdjustment`
  discriminated union:
  `{ type: "money", amount: Money, operation } | { type: "percentage", rate: Percentage, operation }`
  where `operation: "add" | "subtract"`. Invalid states are impossible by
  construction, and the sign is a mathematical operation — never derived from
  `kind`
- `PriceSnapshot` — a `Price` extended with the capture instant
  (`capturedAt: Instant`)
- `PriceRecord` — immutable historical representation of a computed price
  (`format`, `currency`, `subtotal`, ordered `modifiers`, `total`,
  `semanticsId`). `Price` is transient; `PriceRecord` is what consumers
  persist. Its operations are listed below
- `PriceCurrency` — structural historical currency `{ code, exponent }`
  recorded verbatim; `currentPriceCurrency(code)` is the current-currency gate
  for a new calculation
- `PriceModifierRecord` — persisted modifier: `code`, optional `label` /
  `component`, `kind`, and either an integer minor-unit money amount or a
  `Percentage` rate
- `PlainPriceRecord` — JSON-safe wire form: integer amounts as decimal
  strings, percentages as `(amount, scale)`
- `PriceVerification` — `verified` | `mismatch` | `unverifiable` outcome of
  historical verification
- `PriceRecord.from(price)` — records a computed `Price`, stamping the current
  `format`/`semanticsId`
- `PriceRecord.combine(parts, adjustments)` — composes an order-level record
  from finalized line records
- `PriceRecord.verify(record)` — re-executes the record's own frozen semantics
- `PriceRecord.toPlain(record)` / `PriceRecord.restore(plain)` — lossless
  serialization and structural restoration
- `PriceRecord.historicalInputs(record)` — recorded subtotal, ordered
  modifiers and semantics identifier
- `calculatePrice` — pure, deterministic calculation engine
- `PricingError` — typed error with `pricing:<reason>` codes, from the
  `@comity/pricing/errors` subpath; includes `unsupported_record_format`

## Historical records and the three boundaries

- **Structural restoration** — `PriceRecord.restore(plain)` validates shape,
  types and lossless encodings only. It never consults the current ISO 4217
  table, never calls `Currency.create`, never recomputes `total` and never
  repairs a value, so withdrawn currencies still load.
- **Historical verification** — `PriceRecord.verify(record)` re-executes the
  record's own `semanticsId` pipeline. It never falls back to current
  semantics and never answers commit eligibility.
- **Current commitment eligibility** — `PriceRecord.combine(parts,
adjustments)` is commit-time only: it requires current `format` and
  `semanticsId`, coherent line records sharing one currency, sums line totals
  exactly without reapplying line modifiers, then applies order-level
  adjustments once, in order.
- `format` (record schema) and `semanticsId` (calculation pipeline) are
  independent axes. Only `from` and `combine` mint a record with the current
  values; callers cannot choose them.

## Record lifecycle example

```ts
import { Currency, Money, PriceRecord, calculatePrice } from "@comity/pricing";

const eur = Currency.create("EUR");
if (!eur.success) throw eur.error;

const subtotal = Money.create(1999n, eur.value); // 19.99 EUR
if (!subtotal.success) throw subtotal.error;

const price = calculatePrice(subtotal.value, []);
if (!price.success) throw price.error;

// Persist this record, not the transient Price.
const record = PriceRecord.from(price.value);
if (!record.success) throw record.error;

const plain = PriceRecord.toPlain(record.value); // JSON-safe
const restored = PriceRecord.restore(plain); // structural only
if (!restored.success) throw restored.error;

const verification = PriceRecord.verify(restored.value);
// verification.outcome: "verified" | "mismatch" | "unverifiable"
```

`PriceRecord.from` stamps the current `format` and `semanticsId`.
`PriceRecord.restore` does not validate the currency against the current ISO
table and does not recompute the total; `verify` is the separate historical
check. `combine` is used for order-level composition, not for restoring a
stored record.

## What it does not include

- no repository, no persistence adapter, no I/O — `PriceRecord` is plain
  immutable data, and persistence lives outside the package
- no generic `Decimal`/`Quantity` abstraction — money uses integer minor
  units, rates use the domain-specific `Percentage`
- no currency conversion (`ExchangeRate`/`ExchangeRateProvider`/
  `CurrencyConverter` are future domain services)
- no human/localized formatting (`Intl` and locale handling never live in the
  Value Objects; `Money.toString()`/`Percentage.toString()` are stable
  technical / canonical serializations)
- no fractional-quantity multiplication (kg, meters, consumption, time) — those
  are owned by their domain modules
- no coupon/promotion rules
- no tax module (future `@comity/tax` may consume pricing results)
- no product or order models
