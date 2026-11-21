---
"@comity/payment": minor
---

Breaking-class contract change (minor under 0.x) for notification identity and
classification (ADR-037 §3 and §7, AMD-ID and AMD-SIG). `PaymentNotification.eventId`
becomes optional on every kind: it is present only when the provider's delivery
carries an event identifier, copied unchanged and never synthesized. Consumers that
read `eventId` as a `string` must handle `undefined`, and under
`exactOptionalPropertyTypes` copying it into an optional property needs a
conditional spread. New exported type `PaymentNotificationSubject` (`payment`,
`refund` or `payment_or_refund`, each with an optional `reference`) and
`OtherNotification.subject?`: a subject names what to look up, never what happened.
`invalid_notification` keeps its two causes and no reason is added, but their
meanings change. `signature` now means authenticity not positively established
(failed, missing, expired or not evaluable). `malformed` is narrowed to an
authentic delivery whose event boundaries or event types cannot be determined; an
identifiable event is never `malformed`, whatever fields it lacks. Classification
rules for `verify`: an unmapped type, a signal event, or an event that cannot be
normalized into a state kind (missing or invalid required field, unmapped state
value, or a settled success missing its identifier) is `other` with the narrowest
truthful `subject`; a settled success whose identifiers are present and whose
schema-declared amount is absent or unusable is `unrepresentable_success` and fails
the delivery as a whole; a confirmed failure or pending refund with an unusable
amount carries `providerAmountUnusable: true`. Adds the verifier conformance runner
`runPaymentNotificationVerifierConformance` (VC-1 to VC-5, VC-7 to VC-10, VC-12 to
VC-19) and, for `MemoryPaymentProvider`, a documented event mapping with the test
controls `issueRaw` and `issueMatrixRow`. Published JSDoc of the verifier,
`invalid_notification` and its causes is updated. Migration:
`packages/payment/docs/migration.md`.
