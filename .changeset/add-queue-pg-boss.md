---
"@comity/queue-pg-boss": minor
---

Added `@comity/queue-pg-boss`, the first Technology Adapter for `@comity/queue`.
Implements the queue producer and worker contracts on PostgreSQL through pg-boss,
with conservative publication-outcome classification and an adapter-owned drain
barrier that keeps `stop()` pending until every accepted handler settles.
