# Error Mapping

This adapter guarantees that all failures are normalized into `SqlError`
from `@comity/sql`.

## Canonical error reasons

| Failure type                 | SqlError.reason        |
| ---------------------------- | ---------------------- |
| Connection failure           | sql:connection-failed  |
| SQL syntax error             | sql:invalid-query      |
| Constraint / execution error | sql:query-failed       |
| Transaction commit/rollback  | sql:transaction-failed |
| Query timeout                | sql:timeout            |
| Explicit cancellation        | sql:cancelled          |

`sql:timeout` belongs to the contract's reason set, but this adapter never
produces it: no portable Kysely API applies a timeout, and
`SqlClientOptions.timeout` / `SqlClientOptions.context` are accepted for contract
compatibility only — they are not forwarded to the driver. A timeout raised by
the driver surfaces through the normal mapping: `cancelled` for a cancelled
statement, `query_failed` otherwise.

## Security considerations

- SQL queries MUST NOT be included in error metadata
- Parameters MUST NOT be logged
- Error meta must be safe for logs and telemetry

The adapter may include:

- operation type
- adapter name
- retriable flag
