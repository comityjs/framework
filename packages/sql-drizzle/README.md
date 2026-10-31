# @comity/sql-drizzle

Drizzle ORM adapter for @comity/sql.

---

## Purpose

Implements the SQL contracts from `@comity/sql` on top of Drizzle ORM. Maps Comity queries, transactions, and atomic batches onto Drizzle execution and normalises driver failures into `SqlError`, without exposing Drizzle internals directly.

---

## Scope

This package:

- ✅ provides a Drizzle-backed SQL client implementation
- ✅ binds positional parameters through Drizzle's own dialect, so each database keeps its placeholder syntax
- ✅ normalises documented Drizzle driver result shapes into rows and an optional row count
- ✅ maps driver errors — including the wrapper Drizzle raises — to Comity SQL error types
- ✅ maps Drizzle transactions to the SQL transaction contract

This package does NOT:

- ❌ define SQL contracts
- ❌ define the schema or generate migrations
- ❌ manage connection pools or pooling strategies
- ❌ provide an atomic multi-statement primitive; composition injects one
- ❌ expose Drizzle types (other than in the options accepted by the factory)

---

## Public API

- `createDrizzleSqlClient` — factory that creates a Drizzle-based SQL client
- `DrizzleSqlClientOptions` — factory options, including the result normaliser and the atomic batch executor
- `DrizzleAtomicBatchExecutor` / `DrizzleAtomicStatement` / `DrizzleAtomicStatementResult` — atomic batch port
- `DrizzleResultNormalizer` / `DrizzleQueryResult` — result normalisation port

No exhaustive reference; see docs for constraints.

---

## Documentation

- docs/overview.md
- docs/conventions.md
- docs/architecture.md
- docs/results.md
- docs/error-mapping.md
- docs/transactions.md
- docs/observability.md
- docs/faq.md

---

## Related Packages

- @comity/sql — SQL contracts and error types

---

## Status

Experimental
