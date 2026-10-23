# @comity/queue-pg-boss — Conventions

This document is normative for the adapter. It restates the constraints ratified by
ADR-028 and the `@comity/queue` design where they apply to a Technology Adapter.

## Adapter boundary

- Adapt, do not decide. No business, domain, or module logic belongs here.
- Depend on `@comity/queue` contracts; do not redefine them.
- Do not expose pg-boss types, clients, connections, job handles, or identifier
  types in the public API.
- Do not re-export `@comity/queue` symbols; consumers import them from the core.
- Do not add a second public error class.
- Keep error mapping internal.

## Configuration

- The configured `queues` array is the only source of queue identity.
- Validate every queue definition before constructing pg-boss: names, duplicates,
  policies, retry and expiration values, dead-letter targets.
- Return malformed entries through `invalid_configuration`; never dereference an
  unvalidated configuration value.
- Reject a declared policy the adapter cannot drive. `key_strict_fifo` stays in
  the type for pg-boss parity but is unsupported here, because the portable
  producer cannot supply the required `singletonKey`.
- Do not silently rewrite an existing queue's database configuration. pg-boss
  `createQueue` inserts only when absent; document drift rather than hiding it.
- Configure dead-letter targets before the queues that reference them.

## Publication

- Classify an outcome as `enqueue_rejected` only when non-acceptance is proven:
  pg-boss resolved `null`, or the server returned a SQLSTATE that rolled the
  statement back.
- Classify every connection or network failure as `enqueue_outcome_unknown`. A
  dropped socket does not prove that the insert did not commit.
- Default every unrecognised failure to `enqueue_outcome_unknown`.
- Never retry an ambiguous publication inside the adapter.
- Do not fabricate `details.retriable`. Set it only when the classification makes
  retryability defensible.

## Workers

- Register a handler execution in the drain tracker in the same synchronous turn
  in which pg-boss invokes the callback.
- `stop()` must stop that worker only, using `offWork` with the worker id. Never use
  instance-level `boss.stop()` as a worker stop.
- After `offWork` resolves, drain tracked handlers with a loop that re-checks the
  set until it is empty.
- Do not report a worker as stopped when `offWork` or the drain fails.
- Do not add a universal shutdown timeout. A handler that never settles may keep
  `stop()` pending forever.
- Do not claim that a running handler can be forcibly terminated.

## Client

- `close()` is adapter-specific teardown, not a portable operation.
- Always install a pg-boss `error` listener before `start()`. An unhandled
  `error` event throws; an optional observer must not decide whether a backend
  failure can crash the process.
- Stop every owned worker before closing pg-boss.
- Reject worker creation once shutdown begins; a worker registered after the
  drain must not escape the close barrier.
- Return the first worker or backend shutdown failure; do not swallow it.
- Repeated `close()` calls return the first outcome.
- Reject publication once the client is closed.

## Packaging

- The package is ESM-only until the shared build emits CommonJS scope markers.
- Do not advertise a `require` condition that resolves to a tree Node cannot load.

## Testing

- Unit tests cover configuration validation, error classification, and the
  lifecycle/drain state machine with a deterministic port.
- PostgreSQL integration tests cover real backend behaviour and are the only
  evidence for pg-boss semantics.
- Integration tests must use `TEST_DATABASE_URL` and skip when it is absent; they
  must never silently pass by mocking the backend.
