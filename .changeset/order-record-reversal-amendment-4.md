---
"@comity/order": minor
---

Add refund reversal recording (ADR-032 Amendment 4, accepted 2026-11-17), a
minor release under the repository's pre-1.0 convention. `Order.recordReversal`
appends an immutable refund reversal fact to a new, optional
`OrderData.reversals` collection, exposed read-only through the new
`Order.reversals` accessor. The fact is `OrderReversal`
(`{ reversalId, kind, amount, paymentId, recordedAt }`) with the new
`OrderReversalKind` type supporting only `"refund"` in v1. Deduplication keys on
`reversalId`: an identical repeat (`kind`, `paymentId`, `amount`) is an
idempotent no-op, and the same id with different content is
`order:reversal_conflict`; `recordedAt` is caller-supplied and excluded from
equality. On append `updatedAt` becomes `recordedAt`. Six additive error
reasons ship: `reversal_exceeds_captured` and `reversal_conflict` (409) and
`invalid_reversal_amount`, `invalid_reversal_id`, `invalid_reversal_timestamp`,
`invalid_reversal_kind` (400). The cumulative reversed amount per
`(paymentId, currency)` never exceeds the captured amount
(`order:reversal_exceeds_captured`, no currency conversion). `Order.create`
validates supplied initial reversals as new state, rejects a repeated
`reversalId` without deduplication, and rejects a second `captured` fact for
the same `paymentId`; hydration restores persisted reversals verbatim and
validates nothing.
