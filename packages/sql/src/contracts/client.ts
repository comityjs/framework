import type { SqlQuery } from "./query.js";
import type { SqlBatchResult, SqlOperationResult, SqlResult } from "./result.js";
import type { SqlTransaction } from "./transaction.js";

/**
 * SQL client boundary contract.
 *
 * @remarks
 * Executes SQL queries and starts transactions. Returns errors as data.
 * Implementations MUST be side-effect free except for actual SQL execution.
 */
export interface SqlClient {
  /**
   * Execute a SQL query.
   *
   * @typeParam T - Row shape produced by the query.
   *
   * @param query Immutable SQL query payload.
   *
   * @returns Operation result wrapping a SqlResult<T>.
   *
   * @throws Errors are not thrown; failures are returned via SqlOperationResult.
   *
   * @remarks
   * No implicit retries or logging at this boundary.
   */
  query<T>(query: Readonly<SqlQuery>): Promise<SqlOperationResult<SqlResult<T>>>;

  /**
   * Begin a new transaction.
   *
   * @returns Operation result wrapping a SqlTransaction capability.
   *
   * @throws Errors are not thrown; failures are returned via SqlOperationResult.
   *
   * @remarks
   * Nested transactions must be handled explicitly by implementations.
   */
  begin(): Promise<SqlOperationResult<SqlTransaction>>;

  /**
   * Execute multiple statements atomically, all or nothing.
   *
   * @param queries Non-empty list of immutable SQL query payloads.
   *
   * @returns Operation result wrapping a SqlBatchResult aligned with `queries`.
   *
   * @throws Errors are not thrown; failures are returned via SqlOperationResult.
   *
   * @remarks
   * Semantic guarantees:
   *
   * 1. Statements are executed in input order.
   * 2. On success, every statement is durable.
   * 3. On failure, no statement is durable.
   * 4. On success, `results.length === queries.length`.
   * 5. On success, `results[i]` corresponds to `queries[i]`.
   * 6. A statement affecting zero rows is still a successful SQL operation.
   * 7. Callers MUST inspect `rowCount` when they require an exact mutation count.
   * 8. Statements MUST be independent; a statement cannot consume the output of
   *    another statement.
   * 9. The operation is never automatically retried.
   * 10. An empty batch is invalid and yields `invalid_query`.
   * 11. A failure yields exactly one SqlError; no partial result is exposed.
   * 12. The index of a failing statement is NOT part of the contract.
   *
   * Failure classification uses the `batch` operation:
   * `invalid_query` for empty input, `invalid_configuration` when the adapter
   * cannot provide atomic multi-statement execution, `query_failed` for an
   * execution failure, and `cancelled` for cancellation or abort.
   *
   * This is not a transaction. Implementations MUST NOT implement it by opening
   * an interactive transaction, and it remains valid for databases that support
   * atomic multi-statement execution without interactive transactions.
   *
   * The execution mechanism belongs to the adapter.
   */
  atomicBatch(queries: readonly Readonly<SqlQuery>[]): Promise<SqlOperationResult<SqlBatchResult>>;
}
