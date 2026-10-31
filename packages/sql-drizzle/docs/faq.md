# FAQ

### Is this an ORM?

No. This is an adapter. Drizzle is the ORM; `@comity/sql` is the contract.

### Can I access the raw Drizzle client?

Yes — the adapter never hides it, because it never owns it. Composition creates
the Drizzle client, passes it to `createDrizzleSqlClient`, and keeps its own
reference. The adapter does not expose it again through its public API.

### Can I execute raw SQL?

Yes. That is all the `@comity/sql` contract offers: `statement` plus positional
`params`.

### Can I use Drizzle's query builder?

Not through this adapter. The contract models SQL execution, not query building;
`docs/decisions/no-query-builder.md` in `@comity/sql` records that decision.

### Why is `atomicBatch` not implemented with `db.batch()`?

Drizzle's `batch()` is dialect-specific and accepts query builders, not raw
statements. The contract requires atomic all-or-nothing execution of raw
statements, so composition injects an executor that can guarantee it.

### Why does `rowCount` come back as `0` for a SQLite mutation?

SQLite databases expose `all()`, which resolves with rows only; the affected-row
count is dropped by the driver call. See docs/results.md.

### Is this meant for domain logic?

No. Use repositories or services in the application layer.

### Does it work with Prisma, or with a hand-written SQL client?

No. Adapters are per technology; this one compiles against Drizzle's public
`SQL` API.
