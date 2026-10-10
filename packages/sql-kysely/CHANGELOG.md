# @comity/sql-kysely

## 0.9.1

### Patch Changes

- 313ef0a: Add the required `SqlClient.atomicBatch` contract for atomic, all-or-nothing multi-statement execution, plus the non-generic `SqlBatchResult` type.

  BREAKING: `atomicBatch` is a required member of `SqlClient`, so every external `SqlClient` implementation must now provide it. `@comity/sql-kysely` does not implement it yet and must be updated in a follow-up.

  The `batch` value was added to `SqlErrorMeta.details.operation`. `SqlErrorReason` is unchanged.

- Updated dependencies [313ef0a]
  - @comity/sql@0.9.1
