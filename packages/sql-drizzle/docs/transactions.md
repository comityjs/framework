# Transactions

`@comity/sql-drizzle` implements transactions using Drizzle's transaction API.

## Behavior

- Transactions are explicit; there is no ambient transaction context
- Nested transactions are not created
- Rollback occurs automatically when Drizzle reports a failure
- Errors inside a transaction are normalized before propagation

## Example

```ts
const begun = await sql.begin();

if (!begun.success) {
  return begun;
}

const tx = begun.value;

const inserted = await tx.query({ statement: "insert into t (a) values (?)", params: [1] });

if (!inserted.success) {
  await tx.rollback();
  return inserted;
}

const committed = await tx.commit();
```

## How the capability works

Drizzle's transaction API is callback-scoped: it runs a function and commits when
that function resolves. To expose `begin()` / `commit()` as separate operations,
the adapter opens the transaction and holds its callback on a barrier:

```text
begin()  → db.transaction(cb) starts; cb assigns the tx handle and waits
query()  → executes on the tx handle
commit() → releases the barrier → Drizzle issues COMMIT
rollback() → rejects the barrier → Drizzle issues ROLLBACK
```

The transaction is therefore open for as long as the capability is held. An
abandoned capability keeps a connection busy until the driver's own idle
handling intervenes; callers own the outcome and must call `commit()` or
`rollback()`. A transaction that fails while the capability is abandoned is
contained by the adapter, so it never reaches the process as an unhandled
rejection.

## Async requirement

Because the callback must be asynchronous, the driver must support an
asynchronous transaction function:

| Driver                                 | Transactions  |
| -------------------------------------- | ------------- |
| `node-postgres`, `postgres-js`, `neon` | supported     |
| `mysql2`                               | supported     |
| `libsql` (async), `d1`                 | supported     |
| `better-sqlite3`, `bun-sqlite` (sync)  | not supported |

A synchronous driver throws when handed an asynchronous callback; the adapter
maps that to `transaction_failed`. A transaction function that returns no
promise at all cannot keep the transaction open, so it is rejected with
`invalid_configuration` (`context.violation = "synchronous_transaction"`). Use
`atomicBatch` where the database offers atomic multi-statement execution without
interactive transactions.

## Guarantees

- `begin()` resolves only after the database has actually started the
  transaction: the returned capability can run a query immediately, even with a
  pooled driver that acquires a connection first
- A transaction is either fully committed or rolled back
- A transaction that cannot be started is reported as `invalid_configuration`
  (no asynchronous `transaction()` on the database) or `transaction_failed` (the
  driver refused it)
- Commit failures are reported as `transaction_failed`
