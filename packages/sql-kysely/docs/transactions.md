# Transactions

`@comity/sql-kysely` implements transactions using Kysely's transaction API.

## Behavior

- Transactions are explicit; there is no ambient transaction context
- Nested transactions are not created unless Kysely guarantees correctness
- Rollback occurs automatically on error
- Errors inside a transaction are normalized before propagation

## Example

```ts
const begun = await sql.begin();

if (!begun.success) {
  return begun;
}

const tx = begun.value;

const inserted = await tx.query({ statement: "insert into t (a) values ($1)", params: [1] });

if (!inserted.success) {
  await tx.rollback();
  return inserted;
}

const committed = await tx.commit();
```

## How the capability works

Kysely's transaction API is callback-scoped: it runs a function and commits when
that function resolves. To expose `begin()` / `commit()` as separate operations,
the adapter opens the transaction and holds its callback on a barrier:

```text
begin()    → transaction().execute(cb) starts; cb assigns the tx handle and waits
query()    → executes on the tx handle
commit()   → releases the barrier → Kysely issues COMMIT
rollback() → rejects the barrier → Kysely issues ROLLBACK
```

`begin()` resolves only after Kysely has started the transaction and handed over
the handle, so the returned capability can run a query immediately even when the
driver has to acquire a pooled connection first. A transaction that cannot start
is reported as `invalid_configuration` or `transaction_failed` instead of being
returned as an opened capability.

The transaction is therefore open for as long as the capability is held. An
abandoned capability keeps a connection busy until the driver's own idle
handling intervenes; callers own the outcome and must call `commit()` or
`rollback()`. A transaction that fails while the capability is abandoned is
contained by the adapter, so it never reaches the process as an unhandled
rejection.

## Guarantees

- A transaction is either fully committed or rolled back
- `begin()` resolves only after `BEGIN` has been issued
- Commit failures are reported as `transaction_failed`
