# @comity/payment

## 0.11.0

### Minor Changes

- 60ef7cc: Breaking-class contract change (minor under 0.x) for notification identity and
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

## 0.10.0

### Minor Changes

- cef1981: Breaking contract change (minor under 0.x), implementing ADR-030, ADR-031 and
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

## 0.9.5

### Patch Changes

- ba1c78c: Update the internal `@comity/pricing` dependency range to `^0.10.0` so Payment
  resolves the same Pricing release as Order. No runtime behavior or public
  contract changes.
- Updated dependencies [ba1c78c]
  - @comity/pricing@0.10.0

## 0.9.4

### Patch Changes

- fc17103: Correct published documentation and package metadata: content setup exports, storefront tenant JSDoc, organization related-package notes, payment testing-provider documentation, and primitives package description and keywords.
- Updated dependencies [fc17103]
  - @comity/primitives@0.9.3

## 0.9.3

### Patch Changes

- Publish caret sibling ranges instead of exact pins (WP-A1, released by WP-A2).

  Every internal `@comity/*` reference in `dependencies` and `peerDependencies` now uses
  `workspace:^`, so published manifests carry `^<sibling version>` instead of the exact pin
  that `pnpm` produced from `workspace:*`. Under 0.x this means a patch bump of a sibling is
  compatible and a sibling minor is a range break. Sibling `devDependencies` are unchanged.

  This coordinated patch release publishes every package that carries a sibling edge; it
  contains no behaviour change.

- Updated dependencies
  - @comity/composition@0.9.3
  - @comity/pricing@0.9.3

## 0.9.2

### Patch Changes

- 5df89a5: ADR-034 (Amendment 1): ESM-only distribution with one flat `dist/` directory. Runtime JavaScript and TypeScript declarations are emitted side by side (`dist/index.js`, `dist/index.d.ts`); there is no `dist/esm`, `dist/types` or `dist/cjs`. Package metadata is `type: module`, `main`/`types` at `./dist/…`, and exports use `types` + `default` (no separate `import`/`require` branches, no `module` field). Node 24+ `require(ESM)` resolves to the same ESM file as `import` (compatibility, not CommonJS support; a graph with top-level `await` fails with `ERR_REQUIRE_ASYNC_MODULE`). No public subpath is added or removed. `@comity/queue-pg-boss` now follows the same shape and gains a working `main`. Type-only relative imports in `auth-tokens`, `cache-kv`, `http` and `router` gained `.js` extensions so emitted declarations resolve under `NodeNext`.

  Packaging: the `files` field of every package changed from `["./dist", "!./dist/**/*.map"]` to `["dist", "!dist/**/*.map"]`. pnpm 12 and npm ignore the `./`-prefixed negation, which would have put source maps into the published tarballs; the unprefixed form preserves the intended exclusion of `.map` files (published packages contain none).

  Patch (ADR-034 proposal, roadmap WP-B): it makes `require()` work and removes no working behaviour; a non-patch release of a peered Core Module would trigger the ADR-033 peer-dependent major cascade.

- Updated dependencies [5df89a5]
  - @comity/composition@0.9.2
  - @comity/pricing@0.9.2
  - @comity/primitives@0.9.2

## 0.9.1

### Patch Changes

- Updated dependencies [713871e]
  - @comity/primitives@0.9.1
  - @comity/composition@0.9.1
  - @comity/pricing@0.9.1
