# @comity/order — Conventions

`@comity/order` is a Core Module that defines domain contracts for the order domain.

## Rules

- keep contracts and models explicit
- keep error types inside the `errors` subpath
- depend only on the packages already declared in `package.json`
- do not add persistence or transport logic
- do not add checkout orchestration
- do not mutate order status except through the entity's transition methods
- do not validate coupons or apply promotion rules inside this package
- keep the Repository as a persistence boundary: no business commands on `OrderRepository`
- create orders through `Order.create`; the constructor is hydration-only and must never validate
- change priced content only in `draft` through the single atomic
  `setPricedContent(lines, adjustments)` operation; it replaces lines and the derived order-level
  `PriceRecord` together
- price composition belongs to `@comity/pricing`: use only `PriceRecord`, `PriceCurrency` and
  `combine`; never call `verify()`, the retained-semantics table, or `PriceRecord.from()` in Order
- never perform pricing arithmetic, rounding, modifier normalization or deduplication in Order
- keep line subjects generic: no commercial taxonomy, SKU, variant, option or attribute
- never mint a `lineId` inside the aggregate: occurrence keys are caller-assigned and preserved verbatim
- never imply concurrency guarantees from `version` alone: they exist only through a repository that implements ADR-029
  (accepted 2026-11-12) and runs its conformance suite (`docs/standards/repository-conformance.md`)

## Status Lifecycle

The order status follows a linear lifecycle. No status can transition backwards.
See `docs/overview.md` for the full transition diagram.

## Invariants

O-1 quantity, O-2 unique `lineId`, O-3 legal transition, O-4/O-5 shipping
destination, O-6 one currency on `(code, exponent)`, O-7 exact `PriceRecord`
coherence, O-8 draft-only priced content and O-9 payment facts are enforced by
the aggregate. O-10 (cancellation requires cancellable lines) is an application
precondition and is not enforced here. O-11 (buyer commercial/fiscal coherence)
is Commerce policy, is not a generic Order invariant, and is not enforced here.
