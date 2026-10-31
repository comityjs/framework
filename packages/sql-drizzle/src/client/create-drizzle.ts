import type { SqlClient, SqlClientOptions } from "@comity/sql";
import type {
  DrizzleAtomicBatchExecutor,
  DrizzleDatabase,
  DrizzleResultNormalizer,
} from "./types.js";

import { executeAtomicBatch } from "../batch/execute.js";
import { assertDrizzleClient } from "../internal/assert-client.js";
import { normalizeDrizzleResult } from "../internal/normalize-result.js";
import { executeQuery } from "../query/execute.js";
import { executeTransaction } from "../transaction/execute.js";

/**
 * Drizzle client factory options.
 *
 * @typeParam DB - Drizzle database instance type, for example `NodePgDatabase<typeof schema>`
 */
export interface DrizzleSqlClientOptions<DB = unknown> extends SqlClientOptions {
  /** Drizzle database instance */
  readonly db: DB;

  /**
   * Adapter name for diagnostics.
   *
   * @remarks
   * `postgres`, `mysql`, and `sqlite` additionally select the driver error-code
   * mapping; any other value leaves failures on the operation-aware fallback.
   */
  readonly adapter: string;

  /**
   * Normaliser applied to the value Drizzle resolves a statement with.
   *
   * @remarks
   * Defaults to the adapter's built-in normalisation, which understands the
   * documented driver result shapes. Supply a replacement only for a driver
   * that returns something else; see `docs/results.md`.
   */
  readonly normalizeResult?: DrizzleResultNormalizer;

  /**
   * Executor providing atomic all-or-nothing multi-statement execution.
   *
   * @remarks
   * Injected by composition because Drizzle exposes no portable atomic
   * multi-statement primitive. When omitted, `atomicBatch` reports
   * `invalid_configuration` rather than falling back to sequential execution.
   */
  readonly atomicBatchExecutor?: DrizzleAtomicBatchExecutor;
}

/**
 * Create a SqlClient backed by a Drizzle database instance.
 *
 * @typeParam DB - Drizzle database instance type
 *
 * @param options - Immutable client configuration including db and adapter name
 *
 * @returns SqlClient implementation that executes queries and transactions via Drizzle
 *
 * @throws SqlError with reason `invalid_configuration` when `options.db` exposes
 * no `execute()` or `all()` method, or no `transaction()` method
 *
 * @remarks
 * - Public API does not expose Drizzle types
 * - Error reasons use kebab-case domain format (sql:<error-kind>)
 * - The execution surface is resolved once, at construction
 */
export function createDrizzleSqlClient<DB = unknown>(
  options: DrizzleSqlClientOptions<DB>
): SqlClient {
  assertDrizzleClient(options.db);

  const db: DrizzleDatabase = options.db;
  const normalize = options.normalizeResult ?? normalizeDrizzleResult;

  return {
    /** @inheritdoc  */
    query: (q) => executeQuery(db, q, options.adapter, normalize),

    /** @inheritdoc */
    begin: () => executeTransaction(db, options.adapter, normalize),

    /** @inheritdoc */
    atomicBatch: (queries) =>
      executeAtomicBatch(queries, options.atomicBatchExecutor, options.adapter),
  };
}
