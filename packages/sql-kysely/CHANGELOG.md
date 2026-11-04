# @comity/sql-kysely

## 0.9.3

### Patch Changes

- 5df89a5: ADR-034 (Amendment 1): ESM-only distribution with one flat `dist/` directory. Runtime JavaScript and TypeScript declarations are emitted side by side (`dist/index.js`, `dist/index.d.ts`); there is no `dist/esm`, `dist/types` or `dist/cjs`. Package metadata is `type: module`, `main`/`types` at `./dist/…`, and exports use `types` + `default` (no separate `import`/`require` branches, no `module` field). Node 24+ `require(ESM)` resolves to the same ESM file as `import` (compatibility, not CommonJS support; a graph with top-level `await` fails with `ERR_REQUIRE_ASYNC_MODULE`). No public subpath is added or removed. `@comity/queue-pg-boss` now follows the same shape and gains a working `main`. Type-only relative imports in `auth-tokens`, `cache-kv`, `http` and `router` gained `.js` extensions so emitted declarations resolve under `NodeNext`.

  Packaging: the `files` field of every package changed from `["./dist", "!./dist/**/*.map"]` to `["dist", "!dist/**/*.map"]`. pnpm 12 and npm ignore the `./`-prefixed negation, which would have put source maps into the published tarballs; the unprefixed form preserves the intended exclusion of `.map` files (published packages contain none).

  Patch (ADR-034 proposal, roadmap WP-B): it makes `require()` work and removes no working behaviour; a non-patch release of a peered Core Module would trigger the ADR-033 peer-dependent major cascade.

- Updated dependencies [5df89a5]
  - @comity/sql@0.9.2

## 0.9.2

### Patch Changes

- 82aee25: `begin()` now resolves only after Kysely has started the transaction and handed over the
  transactional handle. Previously the capability could be returned before the callback ran,
  so a query issued immediately after `begin()` failed with `query_failed` against a driver
  that acquires a pooled connection first.

  A transaction that fails before it starts is now reported as `transaction_failed`, a
  transaction function that returns no promise is rejected with `invalid_configuration`
  (`context.violation = "synchronous_transaction"`), and a transaction that fails while its
  capability is abandoned no longer surfaces as an unhandled rejection.

## 0.9.1

### Patch Changes

- 313ef0a: Add the required `SqlClient.atomicBatch` contract for atomic, all-or-nothing multi-statement execution, plus the non-generic `SqlBatchResult` type.

  BREAKING: `atomicBatch` is a required member of `SqlClient`, so every external `SqlClient` implementation must now provide it. `@comity/sql-kysely` does not implement it yet and must be updated in a follow-up.

  The `batch` value was added to `SqlErrorMeta.details.operation`. `SqlErrorReason` is unchanged.

- Updated dependencies [313ef0a]
  - @comity/sql@0.9.1
