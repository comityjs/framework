# @comity/sql-kysely

## 0.9.2

### Patch Changes

- 82aee25: `begin()` now resolves only after Kysely has started the transaction and handed over the
  transactional handle. Previously the capability could be returned before the callback ran,
  so a query issued immediately after `begin()` failed with `query_failed` against a driver
  that acquires a pooled connection first.

  A transaction that fails before it starts is now reported as `transaction_failed`, a
  transaction function that returns no promise is rejected with `invalid_configuration`
  (`context.violation = "synchronous_transaction"`), and a transaction that fails while its
  capability is abandoned no longer surfaces as an unhandled rejection.

## 0.9.1

### Patch Changes

- 313ef0a: Add the required `SqlClient.atomicBatch` contract for atomic, all-or-nothing multi-statement execution, plus the non-generic `SqlBatchResult` type.

  BREAKING: `atomicBatch` is a required member of `SqlClient`, so every external `SqlClient` implementation must now provide it. `@comity/sql-kysely` does not implement it yet and must be updated in a follow-up.

  The `batch` value was added to `SqlErrorMeta.details.operation`. `SqlErrorReason` is unchanged.

- Updated dependencies [313ef0a]
  - @comity/sql@0.9.1
