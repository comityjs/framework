import type { SqlBatchResult, SqlOperationResult, SqlQuery } from "@comity/sql";
import type {
  KyselyAtomicBatchExecutor,
  KyselyAtomicStatement,
  KyselyAtomicStatementResult,
} from "../client/types.js";

import { SqlError } from "@comity/sql/errors";
import { mapSqlError } from "../internal/map-sql-error.js";

/**
 * Validate the complete batch before any execution is attempted.
 *
 * @param queries - Immutable SQL query payloads
 * @param adapter - Adapter name for diagnostics
 *
 * @returns The normalised statements, or a failure when validation fails
 */
function prepareBatch(
  queries: readonly Readonly<SqlQuery>[],
  adapter: string
): SqlOperationResult<readonly KyselyAtomicStatement[]> {
  const statements: KyselyAtomicStatement[] = [];

  for (const query of queries) {
    // Named parameters are unsupported by the existing execution path, so the
    // batch path MUST NOT introduce a second parameter model.
    if (query.params && !Array.isArray(query.params)) {
      return {
        success: false,
        error: new SqlError("invalid_query", {
          details: { retriable: false, adapter, operation: "batch" },
          context: { violation: "named_parameters" },
        }),
      };
    }

    statements.push({
      statement: query.statement,
      params: (query.params ?? []) as readonly unknown[],
    });
  }

  return { success: true, value: statements };
}

/**
 * Map an executor statement result onto the generic SqlResult representation.
 *
 * @param result - Executor result for a single statement
 *
 * @returns SqlResult with mapped row count
 */
function toSqlResult(result: KyselyAtomicStatementResult) {
  return {
    rows: result.rows,
    rowCount:
      typeof result.numAffectedRows === "bigint"
        ? Number(result.numAffectedRows)
        : result.rows.length,
  };
}

/**
 * Execute a batch of statements atomically via the injected executor.
 *
 * @param queries - Immutable SQL query payloads, executed in order
 * @param executor - Atomic batch executor supplied by composition
 * @param adapter - Adapter name for diagnostics
 *
 * @returns Operation result wrapping a SqlBatchResult aligned with `queries`
 *
 * @throws Errors are not thrown; failures are returned via SqlOperationResult
 *
 * @remarks
 * Validation of the whole batch completes before the executor is invoked, so an
 * invalid statement can never result in a partial execution.
 *
 * Atomicity is provided by the executor, not by this function. This function
 * MUST NOT fall back to sequential execution or to a transaction, because either
 * would violate the all-or-nothing guarantee. A failure yields exactly one
 * SqlError and no partial result; the failing statement index is not reported
 * because the contract does not define one.
 */
export async function executeAtomicBatch(
  queries: readonly Readonly<SqlQuery>[],
  executor: KyselyAtomicBatchExecutor | undefined,
  adapter: string
): Promise<SqlOperationResult<SqlBatchResult>> {
  // An empty batch is rejected before the executor is consulted, so behaviour is
  // deterministic and independent of whether an executor was supplied.
  if (queries.length === 0) {
    return {
      success: false,
      error: new SqlError("invalid_query", {
        details: { retriable: false, adapter, operation: "batch" },
        context: { violation: "empty_batch" },
      }),
    };
  }

  // An unsupported capability is a configuration failure, not an exception.
  if (!executor) {
    return {
      success: false,
      error: new SqlError("invalid_configuration", {
        details: { retriable: false, adapter, operation: "batch" },
        context: { violation: "atomic_batch_executor_missing" },
      }),
    };
  }

  const prepared = prepareBatch(queries, adapter);

  if (!prepared.success) {
    return prepared;
  }

  try {
    const results = await executor.execute(prepared.value);

    // The executor guarantees positional alignment; a mismatch is a defect in
    // the injected implementation and is surfaced rather than silently accepted.
    if (results.length !== queries.length) {
      return {
        success: false,
        error: new SqlError("query_failed", {
          details: { retriable: false, adapter, operation: "batch" },
          context: { violation: "executor_result_count_mismatch" },
        }),
      };
    }

    return {
      success: true,
      value: results.map(toSqlResult),
    };
  } catch (e) {
    return {
      success: false,
      error: mapSqlError(e, "batch", adapter),
    };
  }
}
