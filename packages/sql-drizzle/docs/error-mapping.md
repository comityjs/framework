# Error Mapping

This adapter guarantees that all failures are normalized into `SqlError`
from `@comity/sql`.

## Canonical error reasons

| Failure type                 | SqlError.reason        |
| ---------------------------- | ---------------------- |
| Connection failure           | sql:connection_failed  |
| SQL syntax error             | sql:invalid_query      |
| Constraint / execution error | sql:query_failed       |
| Transaction commit/rollback  | sql:transaction_failed |
| Query timeout                | sql:timeout            |
| Explicit cancellation        | sql:cancelled          |

`sql:timeout` belongs to the contract's reason set, but this adapter never
produces it: no portable Drizzle API applies a timeout, and
`SqlClientOptions.timeout` / `SqlClientOptions.context` are accepted for contract
compatibility only — they are not forwarded to the driver. A timeout raised by
the driver surfaces through the normal mapping: `cancelled` for a cancelled
statement, `query_failed` otherwise.

## Drizzle's error wrapper

Since Drizzle 0.44, driver failures reach the caller wrapped in a
`DrizzleQueryError` whose message contains the SQL text and the bound
parameters. The adapter unwraps it before classification and keeps only the
underlying driver error as `cause`, so a wrapper can never leak a statement or
its parameters into a log.

## Driver codes

`adapter` selects the code table:

| `adapter`  | Codes                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres` | `57014` → cancelled, `42601` / `42883` → invalid_query, `08006` → connection_failed                                                   |
| `mysql`    | `1317` → cancelled, `1064` → invalid_query                                                                                            |
| `sqlite`   | `SQLITE_BUSY` / `SQLITE_LOCKED` → query_failed (retriable), `SQLITE_CONSTRAINT` → query_failed, `SQLITE_CANTOPEN` → connection_failed |

Codes are matched exactly first, then by longest prefix, so an extended SQLite
code such as `SQLITE_CONSTRAINT_UNIQUE` resolves through `SQLITE_CONSTRAINT`.
Any other `adapter` value leaves failures on the fallback: `transaction_failed`
for transaction operations, `query_failed` otherwise.

`AbortError` is always `cancelled`, whatever the adapter.

## Adapter-raised failures

A failure the adapter raises itself is returned unchanged rather than
reclassified:

- `invalid_configuration` when the client has no usable execution or
  transaction surface, or when `atomicBatch` has no executor
- `invalid_query` when a statement cannot be bound

## Security considerations

- SQL queries MUST NOT be included in error metadata
- Parameters MUST NOT be logged
- Error meta must be safe for logs and telemetry

The adapter may include:

- operation type
- adapter name
- retriable flag
- the driver's original error code (`context.originalCode`)
- the violation identifier for rejected queries (`context.violation`)
