# @comity/order — Design Document (Commerce Extension, Phase A)

> **Status:** **Draft — pending review.** Design specification accompanying
> **ADR-032 (Proposed)**, "`@comity/order` Aggregate Extension for the Commerce
> Foundation (Phase A)" (comity-development). It is **not** accepted and **not**
> implemented: no manifest, source file, test, or API change described here has
> been created. The current published package (0.9.1) is unchanged.
> **Owner:** comity-community (runtime implementation). The decision it
> specifies is owned by comity-development (ADR-032). The domain scope is owned
> by the Commerce Foundation (`commerce/docs/architecture/`, frozen 2026-11-04).

## Purpose and authority

This document specifies how the extension decided in **ADR-032** is intended to
work, in enough detail for a Phase A implementation to proceed once the ADR is
accepted and this document has passed Community review (AGENTS.md: a breaking
public-API change is an Architectural change requiring an accepted ADR, this
design document, and explicit review).

- **ADR-032 records the decision.** Where the two differ, ADR-032 governs and
  this document MUST be corrected.
- **The Commerce frozen architecture is the authoritative contract source**
  (`commerce/docs/architecture/08-typescript-contracts.md` §4,
  `03-bounded-contexts.md` §3.2, `12-implementation-roadmap.md` Phase A). Where
  this document and those differ, the frozen architecture governs.
- **It authorizes nothing by itself.** Implementation remains subject to ADR-032
  acceptance and review.

## Module responsibility (after the extension)

`@comity/order` remains the **commercial commitment** aggregate: it owns order
identity, the committed lines, the applied price, the owned historical facts
(buyer, addresses, payments), the status lifecycle and its invariants. It is
**extended, not replaced**: there is no parallel `CommerceOrder` and no universal
cart (a cart is still an order in `draft`). It does not orchestrate checkout,
does not move money, and does not own fulfillment, entitlement, billing,
subscription or quote — those are separate Commerce capabilities built later in
the Commerce repository and are out of scope here.

## Resulting contract (the seven-item change set)

Authoritative detail in ADR-032 §1 and the frozen architecture. Summary:

1. **`items → lines`, `OrderItem → OrderLine`.** The collection is renamed because
   the element type changes.
2. **`line.subject: OrderLineSubjectSnapshot`** replaces `line.product` — a closed
   union of five variants: `physical_good | digital_asset | licence | service |
   plan`. No `bundle` variant.
3. **`line.priceBasis?: PriceBasis`** (optional; `price_list` with opaque
   `priceListId`/`offeringId`, or `manual`; documented non-exhaustive consumption
   rule) and **`line.term?: OrderLineTerm`** (optional).
4. **`Order.create(data, id): Result<Order, OrderError>`** — the validating
   creation path. The constructor stays **hydration-only** (no validation).
5. **Draft-only mutation**, with mutators **`setLines`, `addLine`, `removeLine`,
   `updateLineQuantity`** (replacing `setItems`/`addItem`/`removeItem`/
   `updateItemQuantity`). Mutating lines or price outside `draft` →
   `order:commitment_immutable`.
6. **`version: number` in `OrderState`** (read-only on the aggregate; see
   "Version and concurrency").
7. **Five new error reasons and the `attachPayment` fact rule.** `attachPayment`
   and `update` now return `Result<void, OrderError>`. The buyer snapshot gains
   additive optional `kind?`, `legalName?`, `taxId?` (no rename).

### Invariants

Enforced on **every** mutation path including creation: O-1 (quantity ≥ 1), O-2
(unique `lineId`), O-3 (legal transition), O-4/O-5 (shipping destination), O-6
(one currency), O-7 (`price.subtotal` = Σ line totals), O-8 (lines/price change
only in `draft`), O-9 (payment-fact rule), O-11 (buyer coherence). O-10
(cancellation requires cancellable lines) stays an **application** precondition.
`Order.create` applies O-1, O-2, O-6, O-7, O-9, O-11.

### Error reasons (exactly five new)

`currency_mismatch` (O-6), `price_incoherent` (O-7), `commitment_immutable`
(O-8), `payment_fact_conflict` (O-9), `invalid_buyer` (O-11). Existing reasons
keep their meaning; `duplicate_item_id` is retained for a duplicate `lineId`.
`stale_version`, `bundle_allocation_incoherent`, `invalid_line_term` do not
exist.

### Payment facts (owner decision D-1)

`OrderPaymentSnapshot` is immutable and append-only. `attachPayment` dedupes on
`(paymentId, status)`: identical repeat = no-op (terminal facts included);
same key, different amount = `order:payment_fact_conflict`. Progression per
`paymentId`: none → any initial status; `authorized → {captured, failed,
cancelled}`; `captured`/`failed`/`cancelled` are terminal. Any other transition
= `order:payment_fact_conflict`. A fact without `paymentId` is always appended
and is never reversible through the Order.

### Buyer validation (owner decision D-2)

`kind: "organization"` requires `legalName`; `taxId` is valid only for
organizations (`kind` defaults to `individual`). Enforced in `Order.create` →
`order:invalid_buyer`. The rule stays on the aggregate.

## Aggregate / repository responsibility split

- **Aggregate** carries `version` read-only, applies invariants, produces
  `OrderError`. It **never** increments `version`.
- **Repository** owns persistence and (per ADR-029) the version compare-and-set.
  `OrderRepository`'s surface (`getById`, `save`, `search`) is **unchanged** by
  Phase A; its `save` *semantics* become version-checked only when ADR-029 is
  accepted and implemented.

## Version and concurrency (contract only — no implementation claimed)

A newly created, not-yet-persisted aggregate has `version: 0`. Hydration restores
the persisted value verbatim. The intended persistence semantics — insert
establishes `1`; a compare-and-set update stores `supplied + 1` exactly once per
successful save; a failed check persists nothing and returns
`repository:conflict` — are owned by **Proposed ADR-029** and the eventual
adapter, **not** by this package today. **Until ADR-029 is accepted and a
conforming adapter exists, `version` is advisory**, and no production write path
that mutates money or rights may ship. Phase A ships only the aggregate-side
`version` shape so it is fixed once.

## Explicit exclusions and deferred capabilities

Not in Phase A (ADR-032 §5): `customer → buyer` rename; `OrderProfile`;
`cancel(reason)` / reason enum (`cancel()` stays argument-free); `bundle` subject
and `BundleGroupRef`; `stale_version` / `saveWithVersion` / `VersionedRepository`;
`origin` / `OrderOrigin` / `amendment_of`; `Order.recordReversal` and the
reversals collection (deferred, gated on ADR-031); any offering / Commerce
package. ADR-029/030/031 are **separate Proposed prerequisites**, not part of
Phase A, and are neither accepted nor implemented here.

## Testing expectations

O-1…O-9 and O-11 each covered (O-10 is application policy); `invalid_buyer` for
organization-without-`legalName` and `taxId`-on-individual; a retail, a service
and a plan-line order constructible and renderable from snapshots alone; every
invariant enforced on every mutation path including creation; `attachPayment`
tests for authorize→capture, duplicate fact and conflicting fact.

## Related

- **ADR-032** (Proposed) — the decision this document specifies.
- **ADR-001** (creation vs hydration), **ADR-013** (Order entity consolidation).
- **ADR-029 / ADR-030 / ADR-031** (Proposed) — separate prerequisites gating
  production concurrency, charge idempotency and refunds.
- `commerce/docs/architecture/` — the frozen Commerce Foundation v0 architecture.
