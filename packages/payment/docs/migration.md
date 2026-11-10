# @comity/payment — Migration Guide: 0.9.5 → next minor

> **Target release:** the next minor of `@comity/payment` (a breaking change under 0.x, delivered through the
> repository's changeset release process). This is a migration guide, not a release announcement.
>
> **Authority:** ADR-030 (payment command idempotency), ADR-031 (refund contract) and ADR-037 (asynchronous lifecycle
> and provider capabilities, including OD-F9 and OD-F10).

## 1. Scope

Every change below is in `@comity/payment`. `@comity/order` and `@comity/pricing` are unchanged. No package in this
repository imports the Payment contracts, so the migration concerns external adapters, applications and tests only.
There are no compatibility aliases.

## 2. `PaymentRequest`

| `0.9.5`                  | Next                                                         |
| ------------------------ | ------------------------------------------------------------ |
| `{ amount; reference? }` | `{ amount; idempotencyKey; reference; capture; returnUrl? }` |

- `idempotencyKey` is **required**: one key per initiation invocation, 1–255 characters, no whitespace or control
  characters (ADR-030). Persist it before the call and reuse it, with an identical request, on every retry.
- `reference` is **required** and is the application `PaymentAttemptId`, not an order id and not an idempotency key.
- `capture` is **required**: `"automatic"` or `"manual"`. `"manual"` needs a binding that declares `manualCapture`.
- `returnUrl` is required whenever the provider may return a redirect.

## 3. `PaymentOutcome`

- The discriminant is now `state` (a `PaymentState`), not `status`. `PaymentStatus` keeps its four values for Order
  facts; `PaymentState` adds `pending` and `requires_action`, which are never Order facts.
- `authorized` and `captured` require `paymentId` and a provider-confirmed `amount`. Other states carry an amount only
  when the provider supplied one (`ReportedAmount`); the requested amount is never echoed into an outcome.
- `provider` is required and carries the binding id.
- `requires_action` carries an `action` (`{ kind: "redirect"; url }`).

Replace `outcome.status` with `outcome.state` and narrow on it before reading `paymentId` or `amount`.

## 4. New contracts

- Ports: `PaymentStatusProvider` (`retrieve`), `PaymentCaptureProvider`, `PaymentCancelProvider`,
  `PaymentOperationLookup` (`retrieveOperation`), `PaymentNotificationVerifier` (`verify`) and `PaymentRefundProvider`
  (`refund`, `retrieveRefund`), with `PaymentOperationOutcome`, `PaymentNotification`, `RefundRequest` and
  `RefundOutcome`.
- `PaymentCapabilities` and `PaymentProviderBinding`, validated by `validatePaymentProviderBinding` (rules C-1 to C-9
  and C-11).
- `runPaymentOperationConformance`: the C-10 adapter conformance runner. Every payment technology adapter that declares
  asynchronous capture or cancel must pass it.

## 5. Errors

- New reasons: `idempotency_conflict` (HTTP 409; `details.cause` `request_mismatch` | `in_progress`),
  `invalid_notification` (`details.cause` `signature` | `malformed`), `invalid_configuration` (`details.violations`)
  and `unrepresentable_success` (`details`: `UnrepresentableSuccessDetails`).
- `invalid_request` may carry `details.cause` `malformed` | `unsupported`.
- The `PaymentError` constructor is overloaded per reason: `idempotency_conflict`, `invalid_notification` and
  `unrepresentable_success` require their details. `internal_error` keeps its meaning: the outcome is unknown.

## 6. Module setup

| `0.9.5`                                             | Next                                                       |
| --------------------------------------------------- | ---------------------------------------------------------- |
| option `provider?: PaymentProvider`                 | option `binding?: PaymentProviderBinding`                  |
| `PAYMENT_PROVIDER_TOKEN` resolves `PaymentProvider` | `PAYMENT_PROVIDER_TOKEN` resolves `PaymentProviderBinding` |

The binding is validated during module initialization; an invalid binding fails initialization with
`invalid_configuration` listing the violated rules. Without a binding the token still resolves `undefined`.
Call `binding.provider.initiate(...)` where you previously called `provider.initiate(...)`.

## 7. `MemoryPaymentProvider`

- Wire it through its binding: `{ binding: new MemoryPaymentProvider().binding }`.
- It now implements every port, the ADR-030 replay and conflict rules, and scripted transitions
  (`settlePayment`, `settleOperation`, `settleRefund`), configured by `MemoryPaymentProviderOptions`.
- Payment identifiers are sequential per instance (`mem_pay_1`, ...) instead of being derived from the reference.
- The `capture:` reference prefix is removed: the capture mode decides between `captured` and `authorized`.
  `fail:` and `cancel:` remain; `pending:` and `action:` are new.
- `failed`, `cancelled`, `pending` and `requires_action` outcomes no longer carry the requested amount.
