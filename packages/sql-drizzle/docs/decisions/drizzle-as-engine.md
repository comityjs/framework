# ADR: Drizzle as SQL execution engine

## Decision

Use Drizzle ORM internally as the SQL execution engine.

## Rationale

- Strong typing for schema-aware code in the application, with no schema
  knowledge required by the adapter
- Broad database support across PostgreSQL, MySQL, and SQLite drivers
- A public `SQL` chunk API that lets the adapter bind a statement plus a
  parameter array without inlining values
- Dialects own placeholder syntax, so the adapter never rewrites statements
- Alignment with Comity's explicitness principles: what Drizzle cannot do
  portably is declared and injected, not emulated

## Consequences

- Drizzle is not exposed publicly, beyond the opaque `db` value and the `SQL`
  values that stay inside the adapter
- Applications are insulated from Drizzle's per-dialect database types
- The adapter must normalise driver result shapes, because Drizzle does not;
  the mapping is documented and replaceable through `normalizeResult`
- The adapter must unwrap `DrizzleQueryError`, whose message embeds SQL text
- Atomic multi-statement execution remains an injected capability
- Swapping the adapter remains possible: consumers only ever see `@comity/sql`
