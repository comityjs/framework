import type { SqlClient, SqlClientOptions } from "@comity/sql";
import type { Kysely } from "kysely";
import type { KyselyAtomicBatchExecutor } from "./types.js";

import { executeAtomicBatch } from "../batch/execute.js";
import { executeQuery } from "../query/execute.js";
import { executeTransaction } from "../transaction/execute.js";

/**
 * Kysely client factory options.
 *
 * @typeParam DB - Database shape used by Kysely
 */
export interface KyselySqlClientOptions<DB> extends SqlClientOptions {
  /** Kysely database instance */
  readonly db: Kysely<DB>;

  /** Adapter name for diagnostics */
  readonly adapter: string;

  /**
   * Executor providing atomic all-or-nothing multi-statement execution.
   *
   * @remarks
   * Injected by composition because Kysely exposes no such primitive. When
   * omitted, `atomicBatch` reports `invalid_configuration` rather than falling
   * back to sequential execution.
   */
  readonly atomicBatchExecutor?: KyselyAtomicBatchExecutor;
}

/**
 * Create a SqlClient backed by a Kysely database instance.
 *
 * @typeParam DB - Database shape used by Kysely
 *
 * @param options - Immutable client configuration including db and adapter name
 *
 * @returns SqlClient implementation that executes queries and transactions via Kysely
 *
 * @throws Errors are not thrown; failures are returned via SqlOperationResult
 *
 * @remarks
 * - Public API does not expose Kysely types
 * - Error reasons use kebab-case domain format (sql:<error-kind>)
 */
export function createKyselySqlClient<DB = unknown>(
  options: KyselySqlClientOptions<DB>
): SqlClient {
  return {
    /** @inheritdoc  */
    query: (q) => executeQuery(options.db, q, options.adapter),

    /** @inheritdoc */
    begin: () => executeTransaction(options.db, options.adapter),

    /** @inheritdoc */
    atomicBatch: (queries) =>
      executeAtomicBatch(queries, options.atomicBatchExecutor, options.adapter),
  };
}
