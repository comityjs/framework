# @comity/sql-drizzle

## 0.9.0

### Minor Changes

- Added `@comity/sql-drizzle`, a Technology Adapter for `@comity/sql` built on Drizzle ORM.
  Implements query execution, capability-based transactions, and the injected atomic-batch
  port, with documented driver result normalisation and error mapping. Positional parameters
  are bound through Drizzle's own dialect, so PostgreSQL keeps `$1` placeholders while MySQL
  and SQLite keep `?`.

### Patch Changes

- `begin()` resolves only after Drizzle has started the transaction and handed over the
  transactional handle, so a query issued immediately after `begin()` no longer races a
  driver that acquires a pooled connection first. A transaction that fails before it starts
  is reported as `transaction_failed`, a transaction function that returns no promise is
  rejected with `invalid_configuration`, and a transaction that fails while its capability is
  abandoned no longer surfaces as an unhandled rejection.
- The parameter binder no longer treats `#` as a comment, so PostgreSQL `#>` and `#>>`
  operators are preserved. Documented that PostgreSQL `?`, `?|`, `?&`, and `@?` operators are
  indistinguishable from placeholders, and that backslash-escaped string literals are not
  understood.
- A two-element result whose second element only carries `name` is no longer mistaken for a
  mysql2 `[rows, FieldPacket[]]` tuple.
