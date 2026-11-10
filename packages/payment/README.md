# @comity/payment

Payment domain abstractions for Comity.

---

## Purpose

Defines the payment domain contracts: payment requests, outcomes, provider interfaces, and module setup. Provides the foundation for integrating payment providers without binding to specific payment gateways.

---

## Scope

This package:

- ✅ defines `PaymentRequest` (amount, required idempotency key, required attempt `reference`, capture mode, optional `returnUrl`), `PaymentOutcome`, `PaymentState`, `PaymentStatus` and `OperationStatus` (ADR-030, ADR-037)
- ✅ defines the provider ports: `PaymentProvider` (initiation), payment lookup, capture, cancel, operation lookup, notification verification, and the refund port `PaymentRefundProvider` with `RefundRequest` / `RefundOutcome` (ADR-031)
- ✅ defines the capability descriptor and `PaymentProviderBinding`, with `validatePaymentProviderBinding` (static rules C-1 to C-9 and C-11, ADR-037)
- ✅ exports the C-10 adapter conformance runner `runPaymentOperationConformance`, which validates the binding statically first and then exercises the binding's real command and lookup ports against an adapter's deterministic provider seam; passing proves nothing about a real PSP's guarantees
- ✅ provides `PaymentError` with typed reasons and details, including `idempotency_conflict` and `unrepresentable_success`
- ✅ supplies module setup tokens and metadata for kernel integration: the module composes a validated binding
- ✅ provides `MemoryPaymentProvider`, a deterministic test double implementing every port, ADR-030 replay rules and scripted asynchronous transitions

This package does NOT:

- ❌ implement specific payment gateways (Stripe, Adyen, etc.) or select a PSP
- ❌ manage payment method storage or tokenization
- ❌ orchestrate payments or refunds: deciding when and why to capture, cancel or refund, attempt tracking and the one-unresolved-attempt invariant belong to the application
- ❌ persist payment or refund attempts, idempotency keys or deliveries (no attempt store, no durable idempotency)
- ❌ provide webhook endpoints, a durable inbox, reconciliation workers or scheduling
- ❌ handle disputes or chargebacks
- ❌ record Order payment facts or reversals
- ❌ encode business rules for payment flows

---

## Public API

- Payment contracts — request, outcome, status, provider ports, capabilities and binding
- `validatePaymentProviderBinding` and `runPaymentOperationConformance` — static validation and adapter conformance (distinct)
- `MemoryPaymentProvider` — in-memory provider for testing and development (root)
- Error types (`@comity/payment/errors`)
- Setup — module wiring and configuration (`@comity/payment/setup`)

No exhaustive reference; see docs for constraints.

---

## Documentation

- docs/migration.md — migration of the ADR-030 / ADR-031 / ADR-037 contract changes

---

## Related Packages

- @comity/pricing — price and money contracts
- @comity/order — order domain (consumes payment outcomes)
- @comity/storefront — storefront checkout (consumes payment provider)
- @comity/composition — module metadata and setup

---

## Status

Stable
