# Observability

This adapter emits no signals of its own.

## Characteristics

- No logging, metrics, or tracing
- No hooks that could affect correctness
- Failures are observable only through the returned `SqlOperationResult`

## Signals available to callers

`SqlError.meta.details` records the operation (`query`, `transaction`, `batch`,
`connect`) and the adapter name, and `SqlError.meta.context` records the driver's
original code or the rejected-query violation. That is enough to classify
failures without inspecting messages.

Drizzle's own logging (`drizzle({ logger })`) stays available: the adapter hands
statements to the driver, so Drizzle's logger observes them as usual. Note that
Drizzle's error wrapper carries the SQL text; the adapter discards that wrapper,
so it never propagates through `SqlError`.

Observability must never affect correctness.
