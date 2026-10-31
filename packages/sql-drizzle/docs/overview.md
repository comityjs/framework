# @comity/sql-drizzle

`@comity/sql-drizzle` is a concrete SQL adapter for the Comity framework, built
on top of Drizzle ORM.

This package implements the contracts defined in `@comity/sql` and delegates
query execution to Drizzle, while preserving Comity principles: explicitness,
capability-based design, and strict separation between domain and
infrastructure.

## What this package is

- A **thin adapter** between `@comity/sql` and Drizzle ORM
- Responsible for:
  - executing SQL statements
  - binding positional parameters
  - managing transactions
  - normalizing driver results and failures
- Explicit about what Drizzle cannot do portably: atomic multi-statement
  execution is an injected capability, not a guess

## What this package is NOT

- ❌ An ORM or schema layer
- ❌ A repository framework
- ❌ A migration tool
- ❌ A domain abstraction layer
- ❌ A Drizzle wrapper meant to be used directly by applications

Applications should depend only on `@comity/sql` contracts, never on Drizzle.

## Usage

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { createDrizzleSqlClient } from "@comity/sql-drizzle";

const db = drizzle(process.env.DATABASE_URL!);

const sql = createDrizzleSqlClient({
  db,
  adapter: "postgres",
});

const result = await sql.query<{ id: string }>({
  statement: "select id from users where email = $1",
  params: ["user@example.com"],
});

if (!result.success) {
  // result.error is a SqlError; result.error.meta.reason is the stable code.
  throw result.error;
}

console.log(result.value.rows);
```

`db` is the value Drizzle's `drizzle()` returns for the driver in use. The
factory accepts it as an opaque value and resolves the execution surface at
construction: `execute()` for PostgreSQL and MySQL databases, `all()` for SQLite
databases, plus `transaction()`.

## Databases

| Dialect family | Drizzle drivers                                           | Execution surface |
| -------------- | --------------------------------------------------------- | ----------------- |
| PostgreSQL     | `node-postgres`, `postgres-js`, `neon`, `vercel-postgres` | `execute()`       |
| MySQL          | `mysql2`                                                  | `execute()`       |
| SQLite         | `better-sqlite3`, `bun-sqlite`, `libsql`, `d1`            | `all()`           |

Result shapes and the affected-row count each driver reports are documented in
docs/results.md. Transactions require a driver with an asynchronous transaction
callback; synchronous SQLite drivers are reported as `transaction_failed`.

## Atomic batch

`SqlClient.atomicBatch` requires an all-or-nothing executor, and no portable
Drizzle API provides one: `batch()` is dialect-specific and accepts Drizzle
query builders, not raw statements. Composition injects the executor:

```ts
const sql = createDrizzleSqlClient({
  db,
  adapter: "d1",
  atomicBatchExecutor: d1BatchExecutor,
});
```

Without an executor, `atomicBatch` reports `invalid_configuration` — it never
falls back to sequential execution or to a transaction.
