# @comity/order

Order domain contracts for Comity commerce modules.

---

## Purpose

Defines the generic order commitment contract consumed by commerce and storefront modules. Unifies cart and order into a single domain where a cart is an order in draft status. Provides the aggregate, repositories, line models and structured errors without binding to a specific commerce backend.

---

## Scope

This package:

- ✅ defines the order entity with lifecycle, validating creation, and the single atomic draft-only priced-content operation
- ✅ defines generic order, line and subject contracts
- ✅ defines order repository contracts
- ✅ exposes the `errors` subpath for order-specific error types

This package does NOT:

- ❌ classify the purchased subject (product/asset/licence/service/plan)
- ❌ own commercial, billing, legal or fiscal buyer facts
- ❌ manage inventory, price composition or promotion rules
- ❌ implement checkout orchestration or payment processing
- ❌ render order UI

---

## Public API

- `Order` — aggregate with lifecycle, `Order.create`, `setPricedContent`, `update`, `changeShippingDestination`, `attachPayment`, `submit`, `confirm`, `fulfill`, `cancel`, `snapshot`
- `OrderId` — order identifier value object
- `OrderRepository` — persistence-boundary contract (`getById`, `search`, `save`)
- `OrderState`, `OrderCreate`, `OrderUpdate`, `OrderSnapshot`, `OrderData`, `OrderStatus` — domain contracts
- `OrderLine`, `OrderLineSubject` — generic embedded line value structures
- `OrderCustomerSnapshot` — generic historical buyer fact
- Error types (`@comity/order/errors`)

A line subject is an owned, immutable, generic snapshot: an opaque
`reference?`, a required `name` and an optional `description`. It makes the line
renderable and traceable without any external system, and it never classifies
the purchase. Commercial taxonomy, catalog identity and commercial attributes
belong to Commerce.

Prices are owned by `@comity/pricing`: lines and the order store the immutable
`PriceRecord`, and `OrderData.currency` is the structural `PriceCurrency`.
The order derives its own record through `PriceRecord.combine`; it never
performs pricing arithmetic.

No exhaustive reference; see docs for constraints.

---

## Migrating from 0.9.3

`0.9.3` is the current published release. `0.10.0` is the target of this
migration and is **not published yet**. The complete guide is
`docs/migration.md` in the repository; because the npm tarball contains the
README and `dist` only, this section is the npm-visible summary.

| `0.9.3`                                                      | `0.10.0`                                                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `OrderData.items`                                            | `OrderData.lines`                                                                                   |
| `OrderItem { id, product, ... }`                             | `OrderLine { lineId, subject, ... }`                                                                |
| `OrderItemInput` for `addItem`                               | no direct replacement; build `OrderLine` and call `setPricedContent`                                |
| `OrderProductSnapshot` (SKU/variant/options/attributes)      | `OrderLineSubject { reference?, name, description? }`; commercial detail in Commerce or `line.meta` |
| `Price` on lines/order                                       | `PriceRecord`                                                                                       |
| no order currency                                            | required `OrderData.currency: PriceCurrency`                                                        |
| `new Order(data, id)` for creation                           | `Order.create(data, id) → Result`; constructor hydrates only                                        |
| `setItems` / `addItem` / `removeItem` / `updateItemQuantity` | `setPricedContent(lines, adjustments)`                                                              |
| `update({ price })`                                          | `update({ meta })` only                                                                             |
| six error reasons                                            | ten reasons (four additions; no `invalid_buyer`)                                                    |

Key steps:

1. Map each legacy line to `OrderLine`: `id` → `lineId`, `product` → `subject`.
   Put SKU/variant/options/attributes in a Commerce-owned type or `line.meta`;
   the generic subject has no commercial taxonomy.
2. Create every line and order price as a `PriceRecord`. Use
   `PriceRecord.from(price)` for a computed line price and
   `PriceRecord.combine(lineRecords, adjustments)` for the order record.
3. Supply `currency` from `currentPriceCurrency(code)`.
4. Replace all priced-content mutation with the atomic, draft-only
   `setPricedContent`; `update` changes metadata only.
5. Handle `Result` values from `create`, `setPricedContent`, `submit`,
   `update` and `attachPayment`; the four new reasons are
   `currency_mismatch`, `price_incoherent`, `commitment_immutable` and
   `payment_fact_conflict`.
6. Persist `PriceRecord.toPlain(record)` and hydrate with
   `PriceRecord.restore(plain)`; never `JSON.stringify` a live record. Do not
   recompute or reprice on load.

An empty order requires the canonical zero `PriceRecord` (`0` subtotal, `0`
total, no modifiers, current format/semantics, order currency).
`combine([])` is forbidden and `setPricedContent([], ...)` is rejected; clearing
all priced content is not supported.

The five-kind subject union, `priceBasis`, `term`, `invalid_buyer` and the
intermediate line mutators were never part of published `0.9.3`; consumers
migrating from `0.9.3` must not add them just to remove them.

---

## Documentation

- docs/overview.md
- docs/conventions.md
- docs/design.md
- docs/migration.md

---

## Related Packages

- @comity/pricing — `PriceRecord`/`PriceCurrency` and `combine` (`order → pricing`, registered in ADR-008)
- @comity/catalog — source of subject data, mapped by the application into the generic `OrderLineSubject` (no direct dependency)
- @comity/kernel — module lifecycle runtime

---

## Status

`0.9.3` is the current published release. `0.10.0` — the breaking contract in
this README — is in preparation and is **not published yet**.
