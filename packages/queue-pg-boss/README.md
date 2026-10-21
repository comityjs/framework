# @comity/queue-pg-boss

Implements the Comity queue contract with pg-boss.

---

## Purpose

Implements the `@comity/queue` contracts on PostgreSQL through pg-boss. Provides a
producer, a worker factory, and client teardown, mapping pg-boss failures to
`QueueError` while keeping pg-boss types out of the public API.

---

## Scope

This package:

- ✅ implements `QueueProducer` and `QueueWorker` for pg-boss
- ✅ provisions configured queues and validates queue identity
- ✅ maps pg-boss failures to `QueueError` reasons
- ✅ drains every accepted handler before `stop()` resolves
- ✅ exposes adapter-specific queue, retry, and expiration configuration

This package does NOT:

- ❌ defines queue contracts (import them from `@comity/queue`)
- ❌ promises exactly-once execution or ordering
- ❌ implements a portable retry or scheduling contract
- ❌ starts workers automatically or installs signal handlers
- ❌ exposes pg-boss clients or types

---

## Public API

- `createPgBossQueueClient` — factory returning `Result<PgBossQueueClient, QueueError>`
- Client contracts — producer, worker creation, and non-portable `close()`
- Configuration contracts — connection, schema, queue definitions, retry, and expiration
- Observability hooks — `onHandlerFailed` and `onBackendError` (non-portable)

No exhaustive reference; see docs for constraints.

---

## Documentation

- docs/overview.md
- docs/conventions.md
- docs/error-mapping.md

---

## Related Packages

- @comity/queue — Queue contracts and error types
- @comity/primitives — Error and result primitives

---

## Status

Experimental
