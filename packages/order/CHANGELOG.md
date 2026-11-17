# @comity/order

## 0.12.0

### Minor Changes

- ea414f5: Add refund reversal recording (ADR-032 Amendment 4, accepted 2026-11-17), a
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

## 0.11.0

### Minor Changes

- 352ee1b: Implement the ADR-029 versioned repository contract. `OrderRepository.save` is now a compare-and-set on the aggregate version and returns `repository:conflict` for stale or duplicate writes, with no retry. Add `MemoryOrderStore` for shared in-memory persistence.

### Patch Changes

- Updated dependencies [352ee1b]
  - @comity/primitives@0.9.4

## 0.10.0

### Minor Changes

- ba1c78c: Breaking contract change (minor under 0.x): orders now use `lines` and the
  generic `OrderLineSubject`, require `OrderData.currency`, store `PriceRecord`
  on lines and at order level, and replace all priced-content mutation with the
  atomic, draft-only `setPricedContent`. `Order.create` validates and `submit`
  performs exact `PriceRecord` commitment reconciliation; the constructor is
  hydration-only. `OrderUpdate` is metadata-only. The error union has ten reasons;
  `invalid_buyer` and O-11 are removed from generic Order. Migration:
  `packages/order/docs/migration.md`.

### Patch Changes

- Updated dependencies [ba1c78c]
  - @comity/pricing@0.10.0

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
  - @comity/organization@0.9.3
  - @comity/pricing@0.9.3

## 0.9.2

### Patch Changes

- 5df89a5: ADR-034 (Amendment 1): ESM-only distribution with one flat `dist/` directory. Runtime JavaScript and TypeScript declarations are emitted side by side (`dist/index.js`, `dist/index.d.ts`); there is no `dist/esm`, `dist/types` or `dist/cjs`. Package metadata is `type: module`, `main`/`types` at `./dist/…`, and exports use `types` + `default` (no separate `import`/`require` branches, no `module` field). Node 24+ `require(ESM)` resolves to the same ESM file as `import` (compatibility, not CommonJS support; a graph with top-level `await` fails with `ERR_REQUIRE_ASYNC_MODULE`). No public subpath is added or removed. `@comity/queue-pg-boss` now follows the same shape and gains a working `main`. Type-only relative imports in `auth-tokens`, `cache-kv`, `http` and `router` gained `.js` extensions so emitted declarations resolve under `NodeNext`.

  Packaging: the `files` field of every package changed from `["./dist", "!./dist/**/*.map"]` to `["dist", "!dist/**/*.map"]`. pnpm 12 and npm ignore the `./`-prefixed negation, which would have put source maps into the published tarballs; the unprefixed form preserves the intended exclusion of `.map` files (published packages contain none).

  Patch (ADR-034 proposal, roadmap WP-B): it makes `require()` work and removes no working behaviour; a non-patch release of a peered Core Module would trigger the ADR-033 peer-dependent major cascade.

- Updated dependencies [5df89a5]
  - @comity/organization@0.9.2
  - @comity/pricing@0.9.2
  - @comity/primitives@0.9.2

## 0.9.1

### Patch Changes

- Updated dependencies [713871e]
  - @comity/primitives@0.9.1
  - @comity/organization@0.9.1
  - @comity/pricing@0.9.1
