/** @internal */

import type { DrizzleDatabase } from "../client/types.js";

import { SqlError } from "@comity/sql/errors";

/**
 * Shape checked before the database is used.
 */
type MaybeDrizzleDatabase = {
  /** */
  execute?: unknown;

  /** */
  all?: unknown;

  /** */
  transaction?: unknown;
};

/**
 * Validate the client shape and throw a structured error if invalid.
 *
 * @param client - Value to validate as DrizzleDatabase
 *
 * @throws SqlError with reason "sql:invalid_configuration" if invalid
 *
 * @remarks
 * Drizzle's database types differ per dialect, so the adapter resolves the
 * execution surface at runtime instead of relying on a shared type. A client
 * must expose `transaction()` plus either `execute()` or `all()`.
 */
export function assertDrizzleClient(client: unknown): asserts client is DrizzleDatabase {
  const candidate =
    typeof client === "object" && client !== null ? (client as MaybeDrizzleDatabase) : null;

  const canExecute =
    typeof candidate?.execute === "function" || typeof candidate?.all === "function";

  if (candidate === null || !canExecute || typeof candidate.transaction !== "function") {
    throw new SqlError("invalid_configuration", {
      details: {
        retriable: false,
        expected: "DrizzleDatabase",
      },
    });
  }
}
