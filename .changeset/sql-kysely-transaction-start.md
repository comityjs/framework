---
"@comity/sql-kysely": patch
---

`begin()` now resolves only after Kysely has started the transaction and handed over the
transactional handle. Previously the capability could be returned before the callback ran,
so a query issued immediately after `begin()` failed with `query_failed` against a driver
that acquires a pooled connection first.

A transaction that fails before it starts is now reported as `transaction_failed`, a
transaction function that returns no promise is rejected with `invalid_configuration`
(`context.violation = "synchronous_transaction"`), and a transaction that fails while its
capability is abandoned no longer surfaces as an unhandled rejection.
