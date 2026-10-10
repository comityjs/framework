# @comity/order — Overview

`@comity/order` provides the order entity, contracts, and models for Comity commerce flows.

## What it includes

- order entity with lifecycle transitions and item mutations
- order, item, and product contracts with status lifecycle
- order identifier value object
- order repository contracts
- order-specific errors

## What it does not include

- persistence implementations
- checkout orchestration
- transport-specific behavior

## Design

An order unifies the cart and order concepts. A cart is an order in `"draft"` status.
The status lifecycle is:

```
draft → pending → confirmed → fulfilled
  ↓        ↓          ↓
  └────────┴──────────┴── cancelled
```

Any order in `draft`, `pending`, or `confirmed` status can be cancelled.

## Product Snapshot Boundary

Order items embed `OrderProductSnapshot` — an owned, immutable, self-contained
representation of the product at purchase time. It is not `ProductProjection`
from `@comity/catalog` and not a reference to the catalog: once the order is
created it no longer depends on the catalog. The application/checkout maps
`ProductProjection` into the snapshot at creation time; historical order
rendering, customer support, invoices, and returns use only this record.
`@comity/order` does not depend on `@comity/catalog`.

## Pricing Ownership

`@comity/pricing` is the single owner of price composition data. Orders store
the full immutable `Price` value (subtotal, modifiers, total) on the line item
and at order level; there is no separate modifier storage in order contracts.
Modifiers are accessed exclusively through `price.modifiers`.

## Persistence vs Domain

`OrderRepository` is the persistence boundary: it exposes `getById`, `search`, and `save` and returns
`Result<T, RepositoryError>`. Not-found is `null`, never an error, and orders are not physically deleted
(the terminal states are `cancelled` and `fulfilled`).

Domain behavior lives on the `Order` entity: item mutations (`setItems`, `addItem`, `removeItem`, `updateItemQuantity`)
protect the order's invariants, and lifecycle transitions (`submit`, `confirm`, `fulfill`, `cancel`) go
through the centralized transition rules in `domain/order-transitions.ts`. Cross-aggregate orchestration
(pricing, coupons, inventory) belongs to application/domain services, not to this package.

`setItems` is retained alongside the individual mutations because only full
replacement is atomic: it validates the entire caller-decided collection
before mutating, so a failure leaves items, price, status, metadata, and
timestamps untouched — a sequence of `addItem`/`removeItem`/
`updateItemQuantity` calls cannot provide equivalent failure atomicity or
single-`updatedAt` semantics. It performs no merging or product-equivalence
detection; the supplied collection is the complete desired collection.

Orders are not created through a public command boundary: a draft order is an `Order` in `"draft"` status.

## Identity

Every `Order` receives its valid `OrderId` at construction from the caller
(application service or hydration path); the entity never generates its own
aggregate ID, and reconstruction preserves the persisted ID verbatim.
`OrderItem` stays embedded: each occurrence carries a caller-assigned stable
technical key (`OrderItemInput.id`) that identifies the occurrence, not the
product. The aggregate mints no item IDs, preserves supplied occurrence IDs
verbatim, and rejects duplicate occurrence IDs on every mutation path.
