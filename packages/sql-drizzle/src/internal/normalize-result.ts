/** @internal */

import type { DrizzleQueryResult } from "../client/types.js";

/**
 * Read an unknown value as a property bag.
 *
 * @param value - Value to inspect
 *
 * @returns The object form, or `null` for primitives
 */
function resultRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Read the first numeric affected-row count a result object exposes.
 *
 * @param record - Result object to inspect
 *
 * @returns The count, or `undefined` when none is present
 */
function affectedCount(record: Record<string, unknown> | null): number | undefined {
  if (record === null) {
    return undefined;
  }

  for (const key of ["rowCount", "affectedRows", "changes", "rowsAffected", "numAffectedRows"]) {
    const value = record[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "bigint") {
      return Number(value);
    }
  }

  return undefined;
}

/**
 * Whether a value looks like mysql2's `FieldPacket[]`.
 *
 * @param value - Value to inspect
 *
 * @returns True for an array of field descriptors
 *
 * @remarks
 * `columnType` is required: mysql2 always sets it, while a plain row object can
 * carry a `name` column, and accepting that would turn a two-element result into
 * a false mysql2 tuple.
 */
function isFieldPacketList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((field) => typeof field === "object" && field !== null && "columnType" in field)
  );
}

/**
 * Normalise a driver result into rows and an optional row count.
 *
 * @param raw - Value Drizzle resolved the statement with
 *
 * @returns Rows and the affected-row count when the driver reports one
 *
 * @remarks
 * Drizzle does not normalise results, so this function recognises the shapes of
 * the supported drivers:
 *
 * - `node-postgres`, `neon`, `vercel-postgres`: `{ rows, rowCount }`
 * - `postgres-js`, `better-sqlite3`, `bun-sqlite`: an array of rows
 * - `mysql2`: `[rows | ResultSetHeader, FieldPacket[]]`
 * - `libsql`: `{ rows, rowsAffected }`
 * - `d1`: `{ results, meta: { changes } }`
 *
 * `docs/results.md` documents the mapping. Replace it through
 * `DrizzleSqlClientOptions.normalizeResult` when a driver returns something
 * else.
 */
export function normalizeDrizzleResult(raw: unknown): DrizzleQueryResult {
  if (Array.isArray(raw)) {
    // mysql2 resolves with a positional tuple, not with a result object.
    if (raw.length === 2 && isFieldPacketList(raw[1])) {
      const [first] = raw;

      if (Array.isArray(first)) {
        return { rows: first, rowCount: first.length };
      }

      const count = affectedCount(resultRecord(first));

      return count === undefined ? { rows: [] } : { rows: [], rowCount: count };
    }

    return { rows: raw, rowCount: raw.length };
  }

  const record = resultRecord(raw);

  if (record === null) {
    // Drivers resolve DDL with `undefined` or `null` when they produce no rows.
    return { rows: [] };
  }

  const rows = record["rows"];

  if (Array.isArray(rows)) {
    const count = affectedCount(record);

    return count === undefined ? { rows, rowCount: rows.length } : { rows, rowCount: count };
  }

  // D1 nests the affected count under `meta`.
  const results = record["results"];

  if (Array.isArray(results)) {
    const count = affectedCount(resultRecord(record["meta"])) ?? affectedCount(record);

    return count === undefined
      ? { rows: results, rowCount: results.length }
      : { rows: results, rowCount: count };
  }

  const count = affectedCount(record);

  return count === undefined ? { rows: [] } : { rows: [], rowCount: count };
}
