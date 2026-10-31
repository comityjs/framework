# Parameters and results

## Parameter binding

`@comity/sql` carries a statement and, optionally, positional parameters.
Drizzle has no API for handing over that pair: a statement is an `SQL` value
whose parameters are bound as chunks, and the dialect writes the placeholders
itself. The adapter therefore turns the statement into chunks — literal text plus
one `Param` per placeholder — and lets Drizzle compile it.

Consequences:

- Both positional conventions are accepted: `?` binds the next unused
  parameter, `$n` binds parameter `n` (one-based, repeatable).
- PostgreSQL statements may use either convention; both compile to `$1`, `$2`, …
- MySQL and SQLite statements compile to `?`, whichever convention they use.
- Placeholders inside single-quoted strings, quoted identifiers (`"…"`,
  `` `…` ``), PostgreSQL dollar-quoted strings (`$$…$$`, `$tag$…$tag$`), line
  comments (`--`) and block comments (`/* … */`) are text, not bind markers.
- Named parameters (`:name`, `@name`) are rejected with `invalid_query` and
  `context.violation = "named_parameters"`.
- A parameter without a placeholder, a placeholder without a parameter, `$0`, or
  an index beyond the parameter list is rejected with `invalid_query` before
  anything is executed. No statement is ever executed with a partially bound
  parameter list.

Values are passed as-is: the adapter applies no encoder, so JSON, arrays, and
temporal values keep the representation the driver expects.

### PostgreSQL tokens that look like placeholders

The binder cannot ask the database which dialect it is talking to, so it treats
every unquoted `?` as a bind marker — including where PostgreSQL uses `?` as an
operator:

- JSONB existence: `data ? 'key'`, `data ?| array['a']`, `data ?& array['a']`
- JSONPath: `data @? '$.a'`

Use `$n` placeholders in those statements and write the predicate in functional
form (`jsonb_exists(data, 'key')`, `jsonb_exists_any(data, array['a'])`), or the
operator is rewritten into a placeholder. When the parameter count still matches,
the adapter cannot detect the mistake: the statement reaches the database and
fails as a syntax error rather than as `invalid_query`.

`#>` and `#>>` are handled correctly: `#` is never treated as a comment, because
MySQL `#` comments would otherwise swallow the rest of a line in PostgreSQL
statements. Use `--` when a MySQL statement needs a comment.

### Escape sequences

String literals are scanned with the standard doubled-quote escape (`''`, `""`).
Backslash escapes — MySQL `'it\'s'`, PostgreSQL `E'\''` — are not understood, so
a backslash-escaped quote can hide or expose a placeholder. Bind the value as a
parameter instead of inlining it.

`atomicBatch` is different: the statements handed to the injected executor keep
their original placeholders, because the adapter never executes them. The
executor binds them using the database's own convention, and `params` is always
a positional list — named parameters are rejected before the executor is called.

## Raw result shapes

Drizzle resolves with the driver's own result object. The adapter's default
normaliser recognises these shapes:

| Driver                                        | Raw shape                          | `rows`    | `rowCount`                 |
| --------------------------------------------- | ---------------------------------- | --------- | -------------------------- |
| `node-postgres`, `neon`, `vercel-postgres`    | `{ rows, rowCount }`               | `rows`    | `rowCount`, else row count |
| `postgres-js`, `better-sqlite3`, `bun-sqlite` | an array of rows                   | the array | array length               |
| `mysql2` (select)                             | `[rows, FieldPacket[]]`            | `rows`    | row count                  |
| `mysql2` (mutation)                           | `[ResultSetHeader, FieldPacket[]]` | `[]`      | `affectedRows`             |
| `libsql`                                      | `{ rows, rowsAffected }`           | `rows`    | `rowsAffected`             |
| `d1`                                          | `{ results, meta: { changes } }`   | `results` | `meta.changes`, else count |
| any driver with no result                     | `undefined` / `null`               | `[]`      | omitted                    |

`rowCount` is omitted — not zeroed — when the driver reports no count at all. A
reported `0` is preserved: a mutation that affected no rows is still a
successful SQL operation.

### Affected rows on SQLite

SQLite databases expose `all()`, which resolves with rows only. A mutation
therefore reports `rowCount` equal to the number of returned rows — normally `0`
— because the driver's affected-row count is not part of that result.

A caller that needs an exact mutation count on SQLite must compose a database
wrapper that exposes `execute()` and routes `run()`-style statements through the
driver's `run()`, or supply `normalizeResult`. The adapter does not inspect the
statement text to guess whether a statement returns rows.

## Replacing the normaliser

`DrizzleSqlClientOptions.normalizeResult` receives the raw value and returns
`{ rows, rowCount? }`:

```ts
const sql = createDrizzleSqlClient({
  db,
  adapter: "postgres",
  normalizeResult: (raw) => ({ rows: (raw as { data: unknown[] }).data }),
});
```

Supply it only for a driver whose shape is not listed above. A normaliser
failure surfaces as `query_failed`.
