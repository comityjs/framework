import type {
  SqlClient,
  SqlOperationResult,
  SqlQuery,
  SqlResult,
  SqlTransaction,
} from "@comity/sql";
import type { Pool, PoolClient } from "pg";

import { failure, success } from "@comity/primitives/result";
import { SqlError } from "@comity/sql/errors";

/**
 * Maps a driver error to a `SqlError` the way a SQL adapter would.
 *
 * @param error - Thrown driver error.
 * @param operation - Failed operation.
 *
 * @returns The mapped error.
 */
function toSqlError(error: unknown, operation: "query" | "transaction" | "connect"): SqlError {
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const connection = code.startsWith("08") || code.startsWith("ECONN") || code === "57P01";

  return new SqlError(connection ? "connection_failed" : "query_failed", {
    cause: error,
    details: { operation, adapter: "pg-test" },
  });
}

/**
 * Wraps one checked-out pg connection as a `SqlTransaction`.
 *
 * @param client - Checked-out connection with an open transaction.
 *
 * @returns The transaction.
 */
function wrapTransaction(client: PoolClient): SqlTransaction {
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      client.release();
    }
  };

  return {
    async query<T>(query: Readonly<SqlQuery>): Promise<SqlOperationResult<SqlResult<T>>> {
      try {
        const result = await client.query<T>(
          query.statement,
          "params" in query && Array.isArray(query.params) ? query.params : []
        );

        return success({
          rows: result.rows,
          ...(result.rowCount !== null ? { rowCount: result.rowCount } : {}),
        });
      } catch (error) {
        return failure(toSqlError(error, "query"));
      }
    },
    async commit() {
      try {
        await client.query("COMMIT");

        return success(undefined);
      } catch (error) {
        return failure(toSqlError(error, "transaction"));
      } finally {
        release();
      }
    },
    async rollback() {
      try {
        await client.query("ROLLBACK");

        return success(undefined);
      } catch (error) {
        return failure(toSqlError(error, "transaction"));
      } finally {
        release();
      }
    },
  };
}

/**
 * Test-only `SqlClient` over a `pg` pool: every `begin()` checks out its own connection.
 *
 * @param pool - Connection pool.
 *
 * @returns The client.
 */
export function createPgSqlClient(pool: Pool): SqlClient {
  return {
    async query<T>(query: Readonly<SqlQuery>): Promise<SqlOperationResult<SqlResult<T>>> {
      try {
        const result = await pool.query<T>(
          query.statement,
          "params" in query && Array.isArray(query.params) ? query.params : []
        );

        return success({
          rows: result.rows,
          ...(result.rowCount !== null ? { rowCount: result.rowCount } : {}),
        });
      } catch (error) {
        return failure(toSqlError(error, "query"));
      }
    },
    async begin() {
      let client: PoolClient;

      try {
        client = await pool.connect();
        await client.query("BEGIN");
      } catch (error) {
        return failure(toSqlError(error, "connect"));
      }

      return success(wrapTransaction(client));
    },
    async atomicBatch(queries: readonly Readonly<SqlQuery>[]) {
      const begun = await this.begin();

      if (!begun.success) return begun;

      const results: SqlResult<unknown>[] = [];

      for (const q of queries) {
        const r = await begun.value.query<unknown>(q);

        if (!r.success) {
          await begun.value.rollback();

          return r;
        }

        results.push(r.value);
      }

      const committed = await begun.value.commit();

      return committed.success ? success(results) : committed;
    },
  };
}
