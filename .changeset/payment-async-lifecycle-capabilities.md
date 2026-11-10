---
"@comity/payment": minor
---

Breaking contract change (minor under 0.x), implementing ADR-030, ADR-031 and
ADR-037 (with OD-F9 and OD-F10): `PaymentRequest` requires `idempotencyKey`,
`reference` (the payment-attempt id) and `capture`; `PaymentOutcome` is
discriminated by `state` and never echoes the requested amount; new capture,
cancel, lookup, refund and notification ports; the capability descriptor and
`PaymentProviderBinding` with `validatePaymentProviderBinding` (C-1 to C-9,
C-11) and the C-10 conformance runner `runPaymentOperationConformance`; new
error reasons `idempotency_conflict`, `invalid_notification`,
`invalid_configuration` and `unrepresentable_success`. Module setup now takes
a validated `binding` instead of `provider`, and `PAYMENT_PROVIDER_TOKEN`
resolves the binding. `MemoryPaymentProvider` implements every port, replay
rules and scripted asynchronous transitions. Migration:
`packages/payment/docs/migration.md`.
