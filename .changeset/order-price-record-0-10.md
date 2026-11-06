---
"@comity/order": minor
---

Breaking contract change (minor under 0.x): orders now use `lines` and the
generic `OrderLineSubject`, require `OrderData.currency`, store `PriceRecord`
on lines and at order level, and replace all priced-content mutation with the
atomic, draft-only `setPricedContent`. `Order.create` validates and `submit`
performs exact `PriceRecord` commitment reconciliation; the constructor is
hydration-only. `OrderUpdate` is metadata-only. The error union has ten reasons;
`invalid_buyer` and O-11 are removed from generic Order. Migration:
`packages/order/docs/migration.md`.
