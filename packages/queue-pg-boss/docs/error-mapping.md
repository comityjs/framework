# @comity/queue-pg-boss — Error Mapping

Every failure is reported as `QueueError` from `@comity/queue/errors`. Application
logic branches on `error.meta.reason`; `meta.details` carries only `operation`,
`adapter: "pg-boss"`, and, when defensible, `retriable`.

## Publication (`enqueue`)

| Trigger                                                                                        | Reason                                | Deterministic?         |
| ---------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------- |
| Name not in the configured queue set                                                           | `unknown_queue`                       | Yes — no database call |
| pg-boss error with `code: "PGBOSS_QUEUE_NOT_FOUND"`                                            | `unknown_queue`                       | Yes                    |
| SQLSTATE `42P01` (job table missing)                                                           | `unknown_queue`                       | Yes                    |
| `send()` resolved `null`                                                                       | `enqueue_rejected`                    | Yes — no row inserted  |
| SQLSTATE `23505` (unique violation)                                                            | `enqueue_rejected`                    | Yes                    |
| SQLSTATE class `40` (serialization failure, deadlock)                                          | `enqueue_rejected`, `retriable: true` | Yes — rolled back      |
| SQLSTATE class `22` or `23` (data, constraint)                                                 | `invalid_request`                     | Yes                    |
| SQLSTATE `23503` (dead-letter target missing)                                                  | `invalid_configuration`               | Yes                    |
| SQLSTATE `42501`, `3D000`, `28P01`                                                             | `invalid_configuration`               | Yes                    |
| Payload is not a serializable object                                                           | `invalid_request`                     | Yes — before dispatch  |
| pg-boss argument assertion                                                                     | `invalid_request`                     | Yes — before dispatch  |
| Connection or network failure (`ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, `EPIPE`, `57P01`, …) | `enqueue_outcome_unknown`             | **No**                 |
| Any unrecognised failure                                                                       | `enqueue_outcome_unknown`             | **No**                 |

**Why connection failures are not rejections.** A dropped connection or a timeout
does not prove that the `INSERT` did not commit. The adapter has no way to
distinguish "the statement never reached PostgreSQL" from "PostgreSQL committed and
the acknowledgement was lost", so it reports the uncertain outcome. The caller must
treat the job as possibly queued.

**`null` is not a duplicate guarantee.** pg-boss documents `null` as "no job id"
under unique jobs, throttling, or non-standard queue policies. It means this call
inserted nothing. It does not prove that no equivalent job is already queued.

**Retryability.** `details.retriable` is set only for SQLSTATE class `40`, where a
rollback makes a retry safe. It is never inferred from an error code otherwise.

## Lifecycle (`start`, `stop`)

| Trigger                                               | Reason                                   |
| ----------------------------------------------------- | ---------------------------------------- |
| `start()` while running, stopping, stopped, or failed | `invalid_lifecycle_state`                |
| `stop()` after a failed stop                          | `lifecycle_failed` (the cached outcome)  |
| Configured queue missing at `start()`                 | `unknown_queue`                          |
| `getQueue` or `work` failed                           | `lifecycle_failed`, `operation: "start"` |
| `offWork` failed                                      | `lifecycle_failed`, `operation: "stop"`  |
| Client closed before an operation                     | `invalid_configuration`                  |

A failed `stop()` confirms neither half of the two-phase guarantee. The worker is
not usable afterwards; create a new one.

## Initialization

| Trigger                                                                  | Reason                  |
| ------------------------------------------------------------------------ | ----------------------- |
| Invalid configuration (names, duplicates, policies, numbers, connection) | `invalid_configuration` |
| pg-boss could not start (migrations, credentials, connectivity)          | `invalid_configuration` |
| Configured queue absent after provisioning                               | `unknown_queue`         |

## Handler execution

Handler exceptions, rejected promises, and failure `Result`s are normalized to
`handler_failed` with `operation: "execute"`. The adapter throws a fixed, sanitized
`Error("queue handler failed")` to pg-boss so that persisted failure output never
contains payloads, connection strings, or adapter internals. The normalized error
is delivered to the optional `onHandlerFailed` hook.

pg-boss's retry policy — `retryLimit`, `retryDelay`, `retryBackoff` — decides what
happens next. That policy is adapter configuration, not a portable contract.
