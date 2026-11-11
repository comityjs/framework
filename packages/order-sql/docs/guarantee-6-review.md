# ADR-029 Guarantee 6 — review evidence for `SqlOrderRepository` and `MemoryOrderRepository`

> **Guarantee 6:** a `repository:conflict` is never retried inside the repository; reload and retry is an application decision.
>
> **Status: evidence prepared; owner / independent human sign-off PENDING.** Nothing in this document is an approval.
> Black-box conformance (TC-4, TC-5) cannot prove this guarantee (ADR-029 §5.5.1); this file is the implementation-level evidence.

Line numbers refer to the working tree at the time of writing (uncommitted).

## 1. Exact `SqlOrderRepository.save` path

`packages/order-sql/src/sql-order-repository.ts`, `save` (≈ lines 201–255):

1. **Input gate** (≈ 203–206): a supplied version that is not a non-negative safe integer, or is `Number.MAX_SAFE_INTEGER`, returns `repository:invalid_data` before any SQL. Not a conflict, not retried.
2. **`#begin()`** (≈ 208): one `client.begin()`. Failure → mapped error, return.
3. **Root statement** (≈ 217): exactly one `tx.query(this.#rootStatement(...))`.
   - supplied `0`: `INSERT … ON CONFLICT (tenant,id) DO NOTHING RETURNING version`.
   - supplied > 0: `UPDATE … SET version = version + 1 … WHERE tenant=$1 AND id=$2 AND version=$3::bigint RETURNING version`.
4. **Zero rows returned** (≈ 225–229): `#rollback(tx)`, then **one diagnostic `SELECT version::text …`** (`#storedVersion`, ≈ 340–355) used only to fill `details.storedVersion`, then `return failure(conflict(...))`. There is no loop, no second root statement, no second `begin()`.
5. **Rows returned** (≈ 231–249): child `DELETE`/`INSERT` statements, then `commit()`.
6. Any SQL failure or thrown value (≈ 219–223, 234–238, 243–247, 250–254): rollback, map to `service_unavailable | protocol_error | unknown | invalid_data`, return. Never `conflict`.

Distinction: the diagnostic read (step 4) executes **after** the decision, its result is not used to decide anything and no write follows it. A retry would require a second write attempt; none exists.

### Statements executed for a stale save (captured by the test)

`save(version=1)` when stored is `2`: `begin` ×1, then `UPDATE comity_order_orders …` (row-less result), `ROLLBACK`, `SELECT version::text …`. The probe records `begin()` calls and `query` calls only, **not `ROLLBACK`/`COMMIT`**; the test asserts `["UPDATE","SELECT"]`, exactly one `UPDATE comity_order_orders` and `begins === 1`. The duplicate-create (INSERT) path is asserted likewise as `["INSERT","SELECT"]` with one `begin`
(`packages/order-sql/src/__tests__/sql-specifics.test.ts`, test "executed CAS: …").

## 2. Retry loops, helpers and mechanisms reachable from `save`

| Layer                        | Finding                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sql-order-repository.ts`    | No `for/while` around the root statement; the only loop (≈ 231) iterates child statements after a successful CAS. No retry helper is imported. `grep -i retr` over `packages/order-sql/src` (non-test): no matches.                                                                                                |
| `@comity/sql` contract       | `packages/sql/src/contracts/client.ts`: "No implicit retries or logging at this boundary" (≈ line 25) and, for batches, "The operation is never automatically retried" (≈ line 62). `SqlError.details.retriable` is metadata only; nothing in `@comity/sql` consumes it.                                           |
| `@comity/sql-kysely`         | `grep -i retr` over `packages/sql-kysely/src` (non-test): only the `retriable` metadata flag in `internal/map-sql-error.ts` and `transaction/execute.ts`; no retry logic. `begin()` wraps `db.transaction().execute(...)` once.                                                                                    |
| Kysely 0.28.19               | `dist/esm/kysely.js` contains no query/transaction retry; the only match for "retr" is a comment that a failed rollback cannot be retried.                                                                                                                                                                         |
| `pg` 8.23.1 / `pg-pool` 3.14 | No automatic statement retry (`grep -i retry` over `pg/lib` and `pg-pool/index.js`: none). The pool may reconnect for _new_ checkouts, not re-run a failed statement.                                                                                                                                              |
| PostgreSQL                   | No server-side retry; serialization retries exist only at `SERIALIZABLE`/`REPEATABLE READ`, which this adapter does not request (default `READ COMMITTED`). Under `READ COMMITTED` a blocked `UPDATE` re-evaluates its `WHERE` on the committed row: it is the **single** execution of the statement, not a retry. |

Honest limit: a _caller-supplied_ `SqlClient` could implement retries (the contract forbids it, but a user client is outside this repository's control). The repository does not and cannot detect that.

## 3. `MemoryOrderRepository`

`packages/order/src/repositories/memory.ts`: `save` (≈ 161–196) calls `store.compareAndSet` exactly once (≈ 180). `MemoryOrderStore.compareAndSet` (≈ 92) is a synchronous check-and-set with no `await`, no loop; a mismatch returns `{ applied:false }` and the repository returns `conflict` immediately. No retry helper exists.

## 4. Existing evidence

- Statement-count test: `sql-specifics.test.ts` "executed CAS: …" (one `begin`, one root `UPDATE`, then a diagnostic `SELECT`).
- Mutation result (real PostgreSQL 16): inserting a second root-CAS attempt when the first returns zero rows made **only** that evidence test fail; TC-4/TC-5 and all other tests still passed — confirming black-box tests alone cannot detect it (ADR-029 §5.5.1) and that the evidence test does.

### Scope limits of the evidence test (from the automated review)

The probe wraps the `SqlClient` handed to the repository. It proves that `SqlOrderRepository` issues one root statement per `save`. It does **not** observe anything below that client: the test-only `pg` client, `pg-pool`, PostgreSQL, or the production `@comity/sql-kysely` adapter. Retry-freedom of those layers rests on the source reading and greps in section 2, not on this test.

## 4a. Automated adversarial review (not a human sign-off)

A separate read-only agent reviewed this evidence statically. It found no retry or second root write attempt at any layer, confirmed the line references and greps, and reported the scope limits above plus residual risks it cannot exclude: retries in a caller-supplied `SqlClient`, Kysely plugins, pool wrappers, proxies, or application code looping over `save`. It did not run the tests or the mutation. It gave no approval and none is claimed.

## 5. Open items for the reviewer

1. Confirm no other path reaches `save` that wraps it in a retry (e.g. application code) — out of this package's scope.
2. Confirm acceptance of the "caller-supplied client" limit above.
3. Sign-off: **PENDING — not completed by the author of the code.**
