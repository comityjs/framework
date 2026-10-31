import type { SqlOperationResult, SqlQuery, SqlResult } from "@comity/sql";
import type { DrizzleDatabase, DrizzleResultNormalizer } from "../client/types.js";

import { SqlError } from "@comity/sql/errors";
import { bindParameters } from "../internal/bind-parameters.js";
import { executeStatement } from "../internal/execute-statement.js";
import { toSqlError } from "../internal/map-sql-error.js";

/**
 * Execute a SQL query via Drizzle and return an explicit operation result.
 *
 * @typeParam T - Row shape produced by the query
 *
 * @param db - Drizzle database port
 * @param query - Immutable SQL query payload
 * @param adapter - Adapter name for diagnostics
 * @param normalize - Result normalizer for the driver in use
 *
 * @returns Operation result wrapping a SqlResult<T>
 *
 * @throws Errors are not thrown; failures are returned via SqlOperationResult
 */
export async function executeQuery<T>(
  db: DrizzleDatabase,
  query: Readonly<SqlQuery>,
  adapter: string,
  normalize: DrizzleResultNormalizer
): Promise<SqlOperationResult<SqlResult<T>>> {
  if (query.params && !Array.isArray(query.params)) {
    return {
      success: false,
      error: new SqlError("invalid_query", {
        details: {
          retriable: false,
          adapter,
          operation: "query",
        },
        context: {
          violation: "named_parameters",
        },
      }),
    };
  }

  const bound = bindParameters(
    query.statement,
    (query.params ?? []) as unknown[],
    "query",
    adapter
  );

  if (!bound.success) {
    return bound;
  }

  try {
    const raw = await executeStatement(db, bound.value, "query", adapter);
    const result = normalize(raw);

    return {
      success: true,
      value:
        result.rowCount === undefined
          ? { rows: result.rows as readonly T[] }
          : { rows: result.rows as readonly T[], rowCount: result.rowCount },
    };
  } catch (e) {
    return {
      success: false,
      error: toSqlError(e, "query", adapter),
    };
  }
}
