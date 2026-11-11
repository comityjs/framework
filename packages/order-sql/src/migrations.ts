import type { SqlClient, SqlOperationResult } from "@comity/sql";

import { failure, success } from "@comity/primitives/result";

/** A versioned, append-only schema migration owned by this adapter. */
export interface OrderSqlMigration {
  /** Stable, sortable migration identifier. */
  readonly id: string;

  /** Statements applied, in order, inside one transaction. */
  readonly statements: readonly string[];
}

/**
 * Schema migrations of the PostgreSQL Order adapter.
 *
 * @remarks
 * The `version` column follows ADR-029: `NOT NULL`, `CHECK (version >= 1)`, no default. It is
 * `bigint` so every JavaScript safe-integer version is representable; the adapter converts it
 * losslessly (see `decodeVersion`). The
 * repository supplies `1` on the first save. `has_payments` preserves the difference between an
 * order without payment facts and one with an empty list.
 */
export const ORDER_SQL_MIGRATIONS: readonly OrderSqlMigration[] = [
  {
    id: "0001_order_tables",
    statements: [
      `CREATE TABLE comity_order_orders (
  tenant       text    NOT NULL,
  id           text    NOT NULL,
  version      bigint  NOT NULL CHECK (version >= 1),
  status       text    NOT NULL,
  channel_id   text    NOT NULL,
  currency     jsonb   NOT NULL,
  price        jsonb   NOT NULL,
  customer     jsonb,
  addresses    jsonb,
  meta         jsonb,
  has_payments boolean NOT NULL,
  created_at   bigint  NOT NULL,
  updated_at   bigint  NOT NULL,
  PRIMARY KEY (tenant, id)
)`,
      `CREATE TABLE comity_order_lines (
  tenant   text    NOT NULL,
  order_id text    NOT NULL,
  position integer NOT NULL,
  line     jsonb   NOT NULL,
  PRIMARY KEY (tenant, order_id, position),
  FOREIGN KEY (tenant, order_id) REFERENCES comity_order_orders (tenant, id) ON DELETE CASCADE
)`,
      `CREATE TABLE comity_order_payments (
  tenant   text    NOT NULL,
  order_id text    NOT NULL,
  position integer NOT NULL,
  payment  jsonb   NOT NULL,
  PRIMARY KEY (tenant, order_id, position),
  FOREIGN KEY (tenant, order_id) REFERENCES comity_order_orders (tenant, id) ON DELETE CASCADE
)`,
    ],
  },
];

/**
 * Applies pending migrations in one transaction, serialised across processes by an advisory lock.
 *
 * @param client - SQL client for a PostgreSQL database.
 * @param migrations - Migrations to apply; defaults to {@link ORDER_SQL_MIGRATIONS}.
 *
 * @returns The identifiers applied by this call.
 */
export async function migrateOrderSql(
  client: SqlClient,
  migrations: readonly OrderSqlMigration[] = ORDER_SQL_MIGRATIONS
): Promise<SqlOperationResult<readonly string[]>> {
  const begun = await client.begin();

  if (!begun.success) return begun;

  const tx = begun.value;
  /**
   * Runs one statement inside the migration transaction.
   *
   * @param statement - SQL text.
   * @param params - Positional parameters.
   *
   * @returns The statement result.
   */
  const run = async (statement: string, params?: readonly unknown[]) =>
    tx.query<Record<string, unknown>>({ statement, ...(params ? { params } : {}) });
  const applied: string[] = [];

  for (const step of [
    () => run("SELECT pg_advisory_xact_lock(hashtext('comity_order_sql_migrations'))"),
    () =>
      run(
        "CREATE TABLE IF NOT EXISTS comity_order_migrations (id text PRIMARY KEY, applied_at bigint NOT NULL)"
      ),
  ]) {
    const result = await step();

    if (!result.success) {
      await tx.rollback();

      return failure(result.error);
    }
  }

  const done = await run("SELECT id FROM comity_order_migrations");

  if (!done.success) {
    await tx.rollback();

    return failure(done.error);
  }

  const seen = new Set(done.value.rows.map((r) => r["id"]));

  for (const migration of migrations) {
    if (seen.has(migration.id)) continue;

    for (const statement of migration.statements) {
      const result = await run(statement);

      if (!result.success) {
        await tx.rollback();

        return failure(result.error);
      }
    }

    const recorded = await run(
      "INSERT INTO comity_order_migrations (id, applied_at) VALUES ($1, $2)",
      [migration.id, Date.now()]
    );

    if (!recorded.success) {
      await tx.rollback();

      return failure(recorded.error);
    }

    applied.push(migration.id);
  }

  const committed = await tx.commit();

  return committed.success ? success(applied) : failure(committed.error);
}
