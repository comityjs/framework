# @comity/sql-drizzle — Conventions

`@comity/sql-drizzle` is a thin adapter.

## Rules

- depend on `@comity/sql` and `drizzle-orm` only
- keep Drizzle-specific details inside the adapter boundary
- normalize driver results and failures into `@comity/sql` types
- do not leak Drizzle types into the domain boundary
- never execute a statement the adapter could not bind completely

## Placement

- `src/client/` — factory, options, and the ports the adapter works against
- `src/query/` — single-statement execution
- `src/transaction/` — transaction capability
- `src/batch/` — atomic batch translation
- `src/internal/` — parameter binding, result normalisation, error mapping, and
  client validation; never exported from the package

## Public surface

Only `@comity/sql` types, the factory, and the two injected ports appear in the
public API. `DrizzleSqlClientOptions.db` is generic on purpose: Drizzle's
database types differ per dialect, and no single type describes them all.

## Deliberate omissions

- No implicit retries
- No sequential fallback for `atomicBatch`
- No nested transactions
- No logging, metrics, or observers
- No statement caching or prepared-statement management
