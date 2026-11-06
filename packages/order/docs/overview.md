# @comity/order — Overview

`@comity/order` provides the generic order commitment aggregate, contracts and models for Comity commerce flows.

## What it includes

- order entity with lifecycle transitions, validating creation and the atomic `setPricedContent` operation
- generic order, line and subject-snapshot contracts
- order identifier value object
- order repository contracts
- order-specific errors (ten reasons; four added by the Phase A extension)

## What it does not include

- persistence implementations
- commerce taxonomy, billing/fiscal buyer facts, price provenance or terms
- checkout orchestration
- optimistic concurrency (the advisory `version` token only)

## Design

An order unifies the cart and order concepts. A cart is an order in `"draft"` status.
The status lifecycle is:

```
draft → pending → confirmed → fulfilled
  ↓        ↓          ↓
  └────────┴──────────┴── cancelled
```

Any order in `draft`, `pending` or `confirmed` status can be cancelled.

`confirmed` means the order's delivery obligations exist; `fulfilled` means every
_delivery_ obligation created by the order's lines has been discharged —
financial settlement never gates the status. `cancelled` terminates the
commitment; a financial reversal is a separate payment fact.

## Creation and hydration

`Order.create(data, id)` is the validating creation path: it checks O-1
(integer quantity `>= 1`), O-2 (unique `lineId`), O-6 (one currency on `(code,
exponent)`), O-7 (exact `PriceRecord` commitment equality with the record
derived by `combine`) and O-9 (supplied payment facts), and returns
`Result<Order, OrderError>`. A new order is `draft` with `version: 0`.

`OrderData.currency` and `OrderData.price` are always required. An empty order
is accepted only with the canonical zero record: subtotal `0`, total `0`, no
modifiers, supported `format`, current `semanticsId` and the order currency.

`setPricedContent([], ...)` is rejected: clearing all priced content is not a
supported transition.

The constructor is the **hydration** path (ADR-001): it performs no validation
and restores persisted state — including `version` — verbatim.

## Priced content

`setPricedContent(lines, adjustments)` is the single draft-only operation that
replaces all priced content atomically. It derives the order-level record with
`PriceRecord.combine(lines.map(line => line.price), adjustments)`:

- each part is a finalized line record and contributes its `total`;
- line-level modifiers are provenance and are never reapplied or copied;
- order-level adjustments are applied exactly once, in the supplied order;
- on any failure the aggregate is left completely unchanged.

`update` only changes non-semantic metadata. There are no line mutators: the
four former mutators and `OrderUpdate.price` are withdrawn.

## Line subject boundary

An order line embeds `subject: OrderLineSubject` — an owned, immutable,
generic snapshot of what was bought: optional opaque `reference`, required
`name`, optional `description`. It is renderable without the catalog, but it
carries no commercial taxonomy, SKU, variant, option or attribute. Commerce
specialises its own richer representation by composition and serialisation
into `line.meta`, never by extending Comity types.

## Commitment immutability

Priced content may change only in `draft`. Outside `draft`,
`setPricedContent` returns `order:commitment_immutable`. Metadata stays
updatable in every status. `submit` re-derives the order record from the stored
line records and the stored order-level modifiers and requires exact
commitment equality before leaving `draft`; it never uses `verify()` and never
constructs a record from a `Price`.

## Payment facts

`attachPayment` records an immutable historical fact. Facts dedupe on
`(paymentId, status)`: an identical repeat is an idempotent no-op, the same key
with a different amount is `order:payment_fact_conflict`, and a new status for a
known `paymentId` is legal only from `authorized` to `captured`, `failed` or
`cancelled` (recorded facts are terminal). A fact without a `paymentId` is
always appended.

## Pricing ownership

`@comity/pricing` is the single owner of price composition. Orders store the
immutable `PriceRecord` on each line and at order level, plus the structural
`PriceCurrency`. Modifiers are accessed only through `price.modifiers`. Order
maps `combine`'s `currency_mismatch` to `order:currency_mismatch` and every
other pricing failure to `order:price_incoherent`.

## Advisory version

`OrderState.version` is a read-only token. A new, not-yet-persisted aggregate
has `0`; hydration restores the persisted value verbatim. The aggregate never
increments it — the repository does, once per successful save. It is advisory
until ADR-029 is accepted and a conforming adapter exists.

## Errors

The closed reason union contains `invalid_quantity`, `invalid_item`,
`invalid_status_transition`, `shipping_destination_immutable`,
`ambiguous_shipping_destination`, `duplicate_item_id`, `currency_mismatch`,
`price_incoherent`, `commitment_immutable` and `payment_fact_conflict`.
`invalid_buyer` and O-11 are removed: buyer commercial/fiscal coherence is
Commerce policy.
