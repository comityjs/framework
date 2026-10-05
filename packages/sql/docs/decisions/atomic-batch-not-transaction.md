# Decision: Atomic batch is not a transaction

`SqlClient.atomicBatch` executes multiple statements atomically, all or nothing.

Rationale:

- many databases expose atomic multi-statement execution without interactive transactions
- a transaction capability cannot express "no partial results across N statements" for those databases
- naming it `atomicBatch` keeps the atomicity guarantee distinct from transaction boundaries

Consequences:

- `atomicBatch` is a required `SqlClient` method; every implementation must provide it
- it MUST NOT be implemented by opening an interactive transaction
- `SqlTransaction` is unchanged and remains the transaction-only capability
- adapters that cannot guarantee atomicity report `invalid_configuration`
- the execution mechanism belongs to the adapter; this package defines no mechanism
