# Architecture

`@comity/sql-drizzle` follows a strict adapter architecture.

```text
Application / Domain
↓
@comity/sql
↓
@comity/sql-drizzle
↓
Drizzle ORM
↓
Database driver
↓
SQL Database
```

## Key principles

### Adapter purity

The adapter:

- translates Comity contracts into Drizzle calls
- translates driver results into `SqlResult`
- translates driver errors into `SqlError`

It does not:

- introduce new abstractions
- leak Drizzle types into the domain boundary
- embed domain logic
- own schema, migrations, or connection pooling

### Capability-based transactions

Transactions are represented explicitly via `SqlTransaction`.
No ambient or implicit transaction context exists.

### Injected capabilities

Drizzle exposes no portable atomic multi-statement primitive, and its raw result
shape is dialect-specific. Both gaps are filled by explicit, injected ports
rather than by adapter guesswork:

| Gap                              | Port                         |
| -------------------------------- | ---------------------------- |
| Atomic all-or-nothing execution  | `DrizzleAtomicBatchExecutor` |
| Unrecognised driver result shape | `DrizzleResultNormalizer`    |

### Execution surface resolution

Drizzle exposes different methods per dialect family. The adapter resolves the
surface once, when the client is created:

```text
db.execute?   → PostgreSQL, MySQL
db.all?       → SQLite
db.transaction? → every database
```

A database with neither `execute()` nor `all()`, or without `transaction()`, is
rejected at construction with `invalid_configuration`. Nothing is executed
before that check.

## Execution flow

```text
SqlClient.query()
    ↓
binder: statement + params → SQL chunks
    ↓
db.execute(sql) | db.all(sql)
    ↓
result normalisation
    ↓
error mapping
    ↓
SqlResult
```

Transactions follow the same flow but are scoped to a single transaction
context. Batches bypass execution entirely and delegate to the injected
executor.
