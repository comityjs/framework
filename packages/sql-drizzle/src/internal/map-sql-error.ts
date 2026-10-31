/** @internal */

import type { SqlErrorReason } from "@comity/sql/errors";

import { SqlError } from "@comity/sql/errors";

/**
 * SQL operation recorded in `SqlErrorMeta.details.operation`.
 */
export type SqlOperation = "connect" | "query" | "transaction" | "batch";

/**
 * Internal type for driver-specific error code mappings.
 */
interface ErrorDetails {
  /** Error reason */
  readonly reason: SqlErrorReason;

  /** Indicates if the error is retriable */
  readonly retriable: boolean;
}

/**
 * Driver-specific error code mappings, keyed by adapter name.
 *
 * @remarks
 * Keys are matched exactly first and then by longest prefix, so an extended
 * SQLite code such as `SQLITE_CONSTRAINT_UNIQUE` resolves through the
 * `SQLITE_CONSTRAINT` entry.
 */
export const DRIVER_ERROR_MAPPINGS: Record<string, Record<string, ErrorDetails>> = {
  postgres: {
    "57014": { reason: "cancelled", retriable: true },
    "42601": { reason: "invalid_query", retriable: false },
    "08006": { reason: "connection_failed", retriable: true },
    "42883": { reason: "invalid_query", retriable: false },
  },

  mysql: {
    "1317": { reason: "cancelled", retriable: true },
    "1064": { reason: "invalid_query", retriable: false },
  },

  sqlite: {
    SQLITE_BUSY: { reason: "query_failed", retriable: true },
    SQLITE_LOCKED: { reason: "query_failed", retriable: true },
    SQLITE_CONSTRAINT: { reason: "query_failed", retriable: false },
    SQLITE_CANTOPEN: { reason: "connection_failed", retriable: false },
  },
} as const;

/**
 * Read an unknown value as a property bag.
 *
 * @param value - Value to inspect
 *
 * @returns The object form, or `null` for primitives
 */
function errorRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Unwrap Drizzle's query error wrapper.
 *
 * @param error - Value thrown by Drizzle
 *
 * @returns The underlying driver error when one is wrapped, otherwise the input
 *
 * @remarks
 * Drizzle wraps every driver failure in a `DrizzleQueryError` whose message
 * contains the SQL text and the bound parameters. The wrapper is discarded so
 * that neither the adapter nor its callers can leak a statement — or its
 * parameters — into a log. Driver codes live on the wrapped error, so unwrapping
 * is also what makes error classification work.
 */
export function unwrapDrizzleError(error: unknown): unknown {
  let current: unknown = error;

  for (let depth = 0; depth < 4; depth += 1) {
    const record = errorRecord(current);

    if (record === null) {
      return current;
    }

    // Duck-typed rather than `instanceof`: the wrapper must be recognised even
    // when two copies of drizzle-orm are loaded (ESM and CJS).
    const looksWrapped = typeof record["query"] === "string" && Array.isArray(record["params"]);

    if (!looksWrapped || record["cause"] === undefined) {
      return current;
    }

    current = record["cause"];
  }

  return current;
}

/**
 * Resolve a driver code against the adapter's mapping table.
 *
 * @param adapter - Adapter name selecting the mapping table
 * @param code - Driver error code
 *
 * @returns The mapped details, or `undefined` when the code is unmapped
 */
function mappedDetails(adapter: string, code: string): ErrorDetails | undefined {
  const mappings = DRIVER_ERROR_MAPPINGS[adapter];

  if (mappings === undefined) {
    return undefined;
  }

  const exact = mappings[code];

  if (exact !== undefined) {
    return exact;
  }

  let matchedKey: string | undefined;
  let matchedDetails: ErrorDetails | undefined;

  for (const [key, details] of Object.entries(mappings)) {
    if (!code.startsWith(key)) {
      continue;
    }

    if (matchedKey === undefined || key.length > matchedKey.length) {
      matchedKey = key;
      matchedDetails = details;
    }
  }

  return matchedDetails;
}

/**
 * Normalise a thrown value without reclassifying an adapter-raised error.
 *
 * @param cause - Value thrown by the adapter or by Drizzle
 * @param operation - The type of SQL operation being performed
 * @param adapter - Optional database adapter name
 *
 * @returns The original SqlError when one was thrown, otherwise a mapped error
 *
 * @remarks
 * The adapter itself raises `invalid_configuration` when a database cannot
 * provide a required capability. Re-mapping that through the driver table would
 * turn a configuration failure into a query failure.
 */
export function toSqlError(cause: unknown, operation: SqlOperation, adapter: string): SqlError {
  return cause instanceof SqlError ? cause : mapSqlError(cause, operation, adapter);
}

/**
 * Maps various error types and messages into a standardized SqlError.
 *
 * @param cause - The original error thrown during a SQL operation
 * @param operation - The type of SQL operation being performed
 * @param adapter - Optional database adapter name
 *
 * @returns A standardized SqlError instance
 */
export function mapSqlError(cause: unknown, operation: SqlOperation, adapter: string): SqlError {
  const driverError = unwrapDrizzleError(cause);

  // 1. Abort / cancellation
  if (driverError instanceof DOMException && driverError.name === "AbortError") {
    return new SqlError("cancelled", {
      details: { operation, adapter, retriable: true },
      cause: driverError,
    });
  }

  // 2. Driver-specific error code mappings
  const record = errorRecord(driverError);
  const code = record?.["code"];

  if (typeof code === "string") {
    const details = mappedDetails(adapter, code);

    if (details !== undefined) {
      return new SqlError(details.reason, {
        details: { operation, adapter, retriable: details.retriable },
        context: { originalCode: code },
        cause: driverError,
      });
    }
  }

  // 3. Operation-aware fallback
  if (operation === "transaction") {
    return new SqlError("transaction_failed", {
      details: { operation, adapter, retriable: false },
      cause: driverError,
    });
  }

  // 4. Last-resort fallback
  return new SqlError("query_failed", {
    details: { operation, adapter, retriable: false },
    cause: driverError,
  });
}
