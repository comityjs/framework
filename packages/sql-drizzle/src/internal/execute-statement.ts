/** @internal */

import type { SQL } from "drizzle-orm";
import type { DrizzleDatabase } from "../client/types.js";
import type { SqlOperation } from "./map-sql-error.js";

import { SqlError } from "@comity/sql/errors";

/**
 * Execute one compiled statement through the Drizzle surface the database
 * provides.
 *
 * @param db - Drizzle database port
 * @param statement - SQL value produced by the parameter binder
 * @param operation - Operation that triggered the execution
 * @param adapter - Adapter name for diagnostics
 *
 * @returns The driver result, unnormalised
 *
 * @throws SqlError with reason `invalid_configuration` when the database offers
 * no execution surface
 *
 * @remarks
 * PostgreSQL and MySQL databases expose `execute()`; SQLite databases expose
 * `all()`. Preferring `execute()` keeps a database that offers both on the
 * richer surface.
 */
export async function executeStatement(
  db: DrizzleDatabase,
  statement: SQL,
  operation: SqlOperation,
  adapter: string
): Promise<unknown> {
  if (typeof db.execute === "function") {
    return await db.execute(statement);
  }

  if (typeof db.all === "function") {
    return await db.all(statement);
  }

  throw new SqlError("invalid_configuration", {
    details: {
      retriable: false,
      adapter,
      operation,
      expected: "drizzle database with execute() or all()",
    },
  });
}
