# @comity/order-sql

PostgreSQL implementation of the `@comity/order` `OrderRepository` contract, implementing the
versioned-repository rules of ADR-029 (optimistic concurrency).

## Scope

- ✅ `SqlOrderRepository`: `getById`, `save` (atomic compare-and-set on `version`), `search`.
- ✅ `migrateOrderSql` / `ORDER_SQL_MIGRATIONS`: versioned, adapter-owned schema migrations.
- ❌ No connection management, no ORM, no query builder: it consumes a `@comity/sql` `SqlClient`.
- ❌ Not a generic persistence framework; it persists the `Order` aggregate only.

Dialect: **PostgreSQL** (`jsonb`, `INSERT … ON CONFLICT DO NOTHING … RETURNING`, advisory locks). Tested on 16.

## Usage

```ts
import { SqlOrderRepository, migrateOrderSql } from "@comity/order-sql";

await migrateOrderSql(client); // client: SqlClient for PostgreSQL
const orders = new SqlOrderRepository(client);
```

## Concurrency contract (ADR-029 §4)

`save` supplies `order.version` as the expected persisted version inside one transaction:

| Persisted | Supplied | Executed root statement                                                           | Result                              |
| --------- | -------- | --------------------------------------------------------------------------------- | ----------------------------------- |
| none      | `0`      | `INSERT … VALUES (…, 1, …) ON CONFLICT (tenant, id) DO NOTHING RETURNING version` | row returned → created at version 1 |
| exists    | `0`      | same insert → no row                                                              | `repository:conflict`               |
| none      | ≠ 0      | `UPDATE … WHERE tenant = $1 AND id = $2 AND version = $3` → no row                | `repository:conflict`               |
| exists    | = stored | `UPDATE … SET version = version + 1 … WHERE … AND version = $3 RETURNING version` | row returned → stored + 1           |
| exists    | ≠ stored | same update → no row                                                              | `repository:conflict`               |

- The outcome is decided **only** from the rows `RETURNING` hands back — never from a pre-read and never from the optional `rowCount`.
- Lines and payment facts are written only **after** the root compare-and-set succeeded, in the same transaction; any failure rolls the whole save back.
- A conflict is returned to the caller; the repository never retries it.
- SQL failures map to `service_unavailable` (connection/timeout/cancel), `protocol_error` (invalid query/config) or `unknown`; they are never reported as `conflict`.
- The `version` column is `integer NOT NULL CHECK (version >= 1)` with no default; the repository supplies `1` on the first save.
- The in-memory `Order` keeps its pre-save version; reload with `getById` before saving again.

## Schema

`comity_order_orders` (root, primary key `(tenant, id)`), `comity_order_lines` and `comity_order_payments`
(child rows keyed `(tenant, order_id, position)`, cascading on delete). Every predicate includes `tenant`.

## Tests

Integration tests need a PostgreSQL database and opt in through `TEST_DATABASE_URL` (the same convention as
`@comity/queue-pg-boss`); without it they are skipped. Each test creates and drops its own schema, so the
database only needs to be dedicated to the run and never be an application database.

```sh
# 1. provision a throwaway cluster (example: Homebrew PostgreSQL 16, trust auth, loopback only)
initdb -D "$TMPDIR/pgdata" -U comity_test --auth=trust --locale=C -E UTF8
pg_ctl -D "$TMPDIR/pgdata" -o "-p 54329 -k /tmp/adr029sock -c listen_addresses=127.0.0.1 -c max_connections=400" -w start
psql -h 127.0.0.1 -p 54329 -U comity_test -d postgres -c "create database adr029"

# 2. run
TEST_DATABASE_URL=postgres://comity_test@127.0.0.1:54329/adr029 pnpm --filter @comity/order-sql test

# 3. clean up
pg_ctl -D "$TMPDIR/pgdata" -m fast stop && rm -rf "$TMPDIR/pgdata" /tmp/adr029sock
```

Never point `TEST_DATABASE_URL` at a shared or application database. Keep connection settings out of committed files.
