# @comity/order — Design Document (Commerce Extension, Phase A) — HISTORICAL / SUPERSEDED

> **HISTORICAL / SUPERSEDED — NOT THE CURRENT CONTRACT.**
> This document records the Phase A design as proposed and reviewed in 2026-11-05.
> It is retained as a historical decision record. The body below deliberately
> preserves superseded requirements — including `Price`, the five-kind
> `OrderLineSubjectSnapshot`, `priceBasis`, `OrderLineTerm`, four line mutators,
> `OrderUpdate.price`, buyer `kind`/`legalName`/`taxId`, O-11 and
> `invalid_buyer` — so that the earlier decision can be read in context. Do not
> implement or migrate from those sections.
>
> **Current authority:** ADR-032 including **Amendment 3**, the accepted
> `order-commerce-boundary-decision.md`, ADR-014 §13–§14, and ADR-008/OD-8.
> The current contract is `docs/overview.md`; the migration guide is
> `docs/migration.md`.
>
> **Historical status:** the Phase A design was implemented and then superseded
> by the generic-boundary integration. The extension described here was never
> published as such. `0.9.3` remains the published baseline; `0.10.0` is in
> preparation and is **not published yet**.
>
> **Historical review:** Community review verdict `APPROVED WITH CONDITIONS`
> (2026-11-05; conditions in "Community review" below). Owner:
> comity-community (runtime implementation). The decision was owned by
> comity-development (ADR-032); the domain scope was owned by the Commerce
> Foundation (`commerce/docs/architecture/`, frozen 2026-11-04).

## Purpose and authority

This document specifies how the extension decided in **ADR-032** is intended to
work, in enough detail for a Phase A implementation to proceed now that the ADR is
accepted (2026-11-05) and this document has passed Community review — verdict
`APPROVED WITH CONDITIONS` (AGENTS.md: a breaking public-API change is an
Architectural change requiring an accepted ADR, this design document, and explicit
review).

- **ADR-032 records the decision.** Where the two differ, ADR-032 governs and
  this document MUST be corrected.
- **The Commerce frozen architecture is the authoritative contract source**
  (`commerce/docs/architecture/08-typescript-contracts.md` §4,
  `03-bounded-contexts.md` §3.2, `12-implementation-roadmap.md` Phase A). Where
  this document and those differ, the frozen architecture governs.
- **It authorizes nothing by itself.** The authorisation comes from the accepted ADR-032 plus the review
  recorded below; this document only specifies the resulting contract.

## Module responsibility (after the extension)

`@comity/order` remains the **commercial commitment** aggregate: it owns order
identity, the committed lines, the applied price, the owned historical facts
(buyer, addresses, payments), the status lifecycle and its invariants. It is
**extended, not replaced**: there is no parallel `CommerceOrder` and no universal
cart (a cart is still an order in `draft`). It does not orchestrate checkout,
does not move money, and does not own fulfillment, entitlement, billing,
subscription or quote — those are separate Commerce capabilities built later in
the Commerce repository and are out of scope here.

## Layer classification and dependency direction

`@comity/order` is a **Core Module** (`comity.layer: "core"`) and stays one after the extension. Phase A changes no
declared dependency and introduces **no new ADR-008 edge**. Amendment 1 later formalised the existing
`order → pricing` edge as a narrowly scoped **value** import (`PriceRecord`/`PriceCurrency` types and
`combine`), recorded in the ADR-008 register. The dependency direction is unchanged:

```text
application / Commerce capabilities
                ↓
         @comity/order   (core)
                ↓
@comity/organization · @comity/pricing · @comity/primitives
```

Public subpaths are unchanged — `.`, `./errors`, `./repositories`, `./package.json` — and error types stay in `./errors`
(`docs/conventions.md`). The extension changes contract shapes inside those subpaths; it adds no package, no adapter, no
infrastructure import and no reverse dependency.

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

Enforced on creation and on every applicable mutation path: O-1 (quantity ≥ 1),
O-2 (unique `lineId`), O-3 (legal transition), O-4/O-5 (shipping destination),
O-6 (one currency), O-7 (`price.subtotal` = Σ line totals), O-8 (lines/price
change only in `draft`), O-9 (payment-fact rule), O-11 (buyer coherence). O-10
(cancellation requires cancellable lines) stays an **application** precondition.
`Order.create` applies O-1, O-2, O-6, O-7, O-9, O-11.

**Enforcement paths as implemented.** O-7 is checked where a price or a whole
line collection is supplied — `Order.create`, `setLines`, `update({ price })` —
matching the invariant authority
(`commerce/docs/architecture/03-bounded-contexts.md` §3.2). `addLine`,
`removeLine` and `updateLineQuantity` enforce O-1, O-2, O-6 and O-8 and do not
re-check the subtotal, so draft assembly mutates lines first and then supplies a
coherent price with `update({ price })`. See `docs/migration.md` §10.

### Error reasons (exactly five new)

`currency_mismatch` (O-6), `price_incoherent` (O-7), `commitment_immutable`
(O-8), `payment_fact_conflict` (O-9), `invalid_buyer` (O-11). Existing reasons
keep their meaning; `duplicate_item_id` is retained for a duplicate `lineId`.
`stale_version`, `bundle_allocation_incoherent`, `invalid_line_term` do not
exist. ADR-032 Amendment 4 later added six reversal reasons, listed in "Refund
reversal facts" below.

### Payment facts (owner decision D-1)

`OrderPaymentSnapshot` is immutable and append-only. `attachPayment` dedupes on
`(paymentId, status)`: identical repeat = no-op (terminal facts included);
same key, different amount = `order:payment_fact_conflict`. Progression per
`paymentId`: none → any initial status; `authorized → {captured, failed,
cancelled}`; `captured`/`failed`/`cancelled` are terminal. Any other transition
= `order:payment_fact_conflict`. A fact without `paymentId` is always appended
and is never reversible through the Order.

### Refund reversal facts (ADR-032 Amendment 4)

`Order.recordReversal(reversal): Result<void, OrderError>` appends an immutable
refund fact to the `reversals` collection. It records a fact only: it executes
and confirms no refund, reads no clock, changes neither the order status nor the
order total, and is legal in every order status. A reversal is not a payment
status and never mutates a payment snapshot.

`OrderReversal` is `{ reversalId, kind: "refund", amount: Money, paymentId,
recordedAt: Instant }`. `reversalId` is the application `RefundAttemptId`, a plain
string stored exactly as supplied. Only `kind: "refund"` exists in version 1 and
there is no `reference` field. `recordedAt` is supplied by the caller and is
excluded from idempotency.

Evaluation order of `recordReversal`:

1. an empty or whitespace-only `reversalId` (`trim().length === 0`) →
   `order:invalid_reversal_id`;
2. identity: an identical existing reversal (`kind`, `paymentId`, `amount`) is a
   no-op that touches nothing and does not read `recordedAt`; the same
   `reversalId` with different content → `order:reversal_conflict`;
3. for a new reversal only: `kind` other than `"refund"` at runtime →
   `order:invalid_reversal_kind`;
4. amount not strictly positive → `order:invalid_reversal_amount`;
5. `recordedAt` not finite, or with an absolute value above `8.64e15` ms →
   `order:invalid_reversal_timestamp` (fractional milliseconds are accepted);
6. more than one `captured` fact for the `paymentId` in the aggregate (possible
   only in hydrated history) → `order:reversal_conflict`; the facts are never
   summed and none is selected;
7. R-1: the cumulative reversals for the `(paymentId, currency)` including this
   one must not exceed the captured amount (zero when there is no captured fact)
   → `order:reversal_exceeds_captured`; no currency conversion is performed;
8. append, and `updatedAt = recordedAt` (it may move backwards).

A rejection or a no-op changes nothing, including `updatedAt`.

`Order.create` validates supplied initial `reversals` as new state with the same
per-fact rules, in the supplied order. A `reversalId` appearing more than once is
rejected with `order:reversal_conflict` (`details.field: "reversals"`), identical
or not; nothing is deduplicated. `create` also rejects more than one `captured`
fact for the same `paymentId` with `order:payment_fact_conflict`. The constructor
(hydration) restores persisted reversals verbatim and validates nothing; an
absent and an empty collection are equivalent, and `snapshot()` omits the
collection when it is empty.

| Reason                             | `details.field` | HTTP |
| ---------------------------------- | --------------- | ---: |
| `order:reversal_exceeds_captured`  | `amount`        |  409 |
| `order:reversal_conflict`          | `reversals`     |  409 |
| `order:invalid_reversal_amount`    | `amount`        |  400 |
| `order:invalid_reversal_id`        | `reversalId`    |  400 |
| `order:invalid_reversal_timestamp` | `recordedAt`    |  400 |
| `order:invalid_reversal_kind`      | `kind`          |  400 |

Currencies are compared with `Currency.equals` (the code); a `Money` derives its
exponent from its code, and the historical exponent is not preserved. The
application must supply a valid `Instant`; `Instant` itself does not guarantee
finiteness.

### Buyer validation (owner decision D-2)

`kind: "organization"` requires `legalName`; `taxId` is valid only for
organizations (`kind` defaults to `individual`). Enforced in `Order.create` →
`order:invalid_buyer`. The rule stays on the aggregate.

## Aggregate / repository responsibility split

- **Aggregate** carries `version` read-only, applies invariants, produces
  `OrderError`. It **never** increments `version`.
- **Repository** owns persistence and (per ADR-029) the version compare-and-set.
  `OrderRepository`'s surface (`getById`, `save`, `search`) is **unchanged** by
  Phase A; its `save` _semantics_ become version-checked through ADR-029
  (accepted 2026-11-12; implemented by `MemoryOrderRepository`).

## Version and concurrency (contract only — no implementation claimed)

> _Update 2026-11-12:_ the text below records the Phase A state. ADR-029 has since been
> **Accepted** and `MemoryOrderRepository` implements the versioned `save`; the SQL
> adapter lives in Commerce. Acceptance is an architectural decision, not evidence of any
> adapter's conformance or production readiness.

A newly created, not-yet-persisted aggregate has `version: 0`. Hydration restores
the persisted value verbatim. The intended persistence semantics — insert
establishes `1`; a compare-and-set update stores `supplied + 1` exactly once per
successful save; a failed check persists nothing and returns
`repository:conflict` — are owned by **ADR-029** (Proposed when this was written) and the
adapter, **not** by this package. **Until ADR-029 is accepted and a
conforming adapter exists, `version` is advisory**, and no production write path
that mutates money or rights may ship. Phase A ships only the aggregate-side
`version` shape so it is fixed once.

## Explicit exclusions and deferred capabilities

Not in Phase A (ADR-032 §5): `customer → buyer` rename; `OrderProfile`;
`cancel(reason)` / reason enum (`cancel()` stays argument-free); `bundle` subject
and `BundleGroupRef`; `stale_version` / `saveWithVersion` / `VersionedRepository`;
`origin` / `OrderOrigin` / `amendment_of`; any offering / Commerce
package. `Order.recordReversal` and the reversals collection, excluded from
Phase A, are specified by ADR-032 Amendment 4 (§2C, accepted 2026-11-17) and
described in "Refund reversal facts" above. ADR-029/030/031 are **separate prerequisites** (Proposed when this was written; ADR-029 since
accepted, 2026-11-12), not part of Phase A.

## Testing expectations

O-1…O-9 and O-11 each covered (O-10 is application policy); `invalid_buyer` for
organization-without-`legalName` and `taxId`-on-individual; a retail, a service
and a plan-line order constructible and renderable from snapshots alone; every
invariant enforced on every mutation path including creation; `attachPayment`
tests for authorize→capture, duplicate fact and conflicting fact.

## Community review (2026-11-05)

**Verdict: `APPROVED WITH CONDITIONS`.** Independent review of ADR-032 and this document against the Community conventions
(`AGENTS.md`, `packages/order/docs/conventions.md`) and the current `@comity/order` source, performed under the architecture
owner's explicit authorisation. It is recorded here because the review condition attaches to these artefacts.

Evidence checked: the pre-extension behaviours ADR-032 asserts — constructor without validation
(`src/entities/order.ts:188`), `update()` replacing the price in any status (`:303`), `attachPayment()` appending
unconditionally (`:325`), item mutation not status-gated (`:406` and its JSDoc), argument-free `cancel()` (`:601`); the six
existing error reasons (`src/errors/order.ts`); the unchanged transition table (`src/domain/order-transitions.ts`); the
unchanged subpath exports and dependencies (`package.json`); and the absence of any in-repo consumer of `@comity/order`.

| #   | Finding                                                                                                                                                                                     | Class                                                                              | Status                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| R-1 | Status block asserted ADR-032 `Proposed` and the published package as 0.9.2 after both had moved on                                                                                         | Documentation drift                                                                | Corrected in this revision                                     |
| R-2 | No layer-classification / dependency-direction section, although peer design documents carry one                                                                                            | Documentation conformance                                                          | Corrected in this revision                                     |
| R-3 | The precise shapes of `OrderLineSubjectSnapshot`, `PriceBasis`, `OrderLineTerm`, `OrderCreate` and `OrderUpdate` are deferred to `commerce/docs/architecture/08-typescript-contracts.md` §4 | Observation, not a defect — the precedence is stated under "Purpose and authority" | No change; implementers MUST use that document as the contract |

**Conditions (none blocks the start of Phase A):**

1. **Release-time:** the minor (0.x) breaking release MUST ship the written migration note ADR-032 requires.
2. **Implementation-time:** `version` ships advisory; no production write path that mutates money or rights until ADR-029 is
   accepted and a conforming adapter exists (ADR-032 §4).
3. **Implementation-time:** O-1…O-9 and O-11 MUST be enforced on every mutation path including creation, and the five new
   reasons MUST be the only new reasons (`stale_version`, `bundle_allocation_incoherent` and `invalid_line_term` do not exist).

**Disclosure:** this review was performed by the implementation agent under the architecture owner's explicit authorisation in
the project conversation of 2026-11-05, against repository evidence. It is not a named human maintainer sign-off; if Community
policy requires one before merge, that sign-off remains outstanding.

## Related

- **ADR-032** (Accepted 2026-11-05) — the decision this document specifies.
- **ADR-001** (creation vs hydration), **ADR-013** (Order entity consolidation).
- **ADR-029 / ADR-030 / ADR-031** (ADR-029 Accepted 2026-11-12; Proposed when this was written) — separate prerequisites gating
  production concurrency, charge idempotency and refunds.
- `commerce/docs/architecture/` — the frozen Commerce Foundation v0 architecture.
