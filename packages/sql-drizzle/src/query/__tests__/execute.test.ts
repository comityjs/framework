import type { SqlQuery } from "@comity/sql";

import { describe, expect, it, vi } from "vitest";
import { SqlError } from "@comity/sql/errors";
import { compileStatement } from "../../__tests__/compile-sql.js";
import { normalizeDrizzleResult } from "../../internal/normalize-result.js";
import { executeQuery } from "../execute.js";

const adapter = "postgres";

/**
 * Build a database double whose `execute` resolves with a fixed raw result.
 *
 * @param raw - Value the driver resolves with
 *
 * @returns The database and its `execute` spy
 */
function createDatabase(raw: unknown) {
  const execute = vi.fn().mockResolvedValue(raw);

  return { db: { execute }, execute };
}

describe("executeQuery", () => {
  it("should execute a query and return rows with the driver row count", async () => {
    const { db, execute } = createDatabase({ rows: [{ id: 1 }], rowCount: 1 });

    const result = await executeQuery<{ id: number }>(
      db,
      { statement: "select * from t where id = ?", params: [1] },
      adapter,
      normalizeDrizzleResult
    );

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.value).toEqual({ rows: [{ id: 1 }], rowCount: 1 });
    }

    expect(execute).toHaveBeenCalledTimes(1);
    expect(compileStatement(execute.mock.calls[0]![0], "dollar")).toEqual({
      sql: "select * from t where id = $1",
      params: [1],
    });
  });

  it("should fall back to the row count when the driver reports none", async () => {
    const { db } = createDatabase([{ id: 1 }, { id: 2 }]);

    const result = await executeQuery<{ id: number }>(
      db,
      { statement: "select * from t" },
      adapter,
      normalizeDrizzleResult
    );

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.value.rowCount).toBe(2);
    }
  });

  it("should omit rowCount when the driver reports no result", async () => {
    const { db } = createDatabase(undefined);

    const result = await executeQuery(
      db,
      { statement: "create table t (id int)" },
      adapter,
      normalizeDrizzleResult
    );

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.value).toEqual({ rows: [] });
    }
  });

  it("should map a mysql2 mutation header to rowCount", async () => {
    const { db } = createDatabase([{ affectedRows: 3 }, [{ name: "id", columnType: 3 }]]);

    const result = await executeQuery(
      db,
      { statement: "update t set a = ?", params: [1] },
      "mysql",
      normalizeDrizzleResult
    );

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.value.rowCount).toBe(3);
    }
  });

  it("should use all() when the database has no execute()", async () => {
    const all = vi.fn().mockResolvedValue([{ id: 7 }]);

    const result = await executeQuery<{ id: number }>(
      { all },
      { statement: "select * from t where id = ?", params: [7] },
      "sqlite",
      normalizeDrizzleResult
    );

    expect(result.success).toBe(true);
    expect(all).toHaveBeenCalledTimes(1);

    if (result.success) {
      expect(result.value.rows).toEqual([{ id: 7 }]);
    }
  });

  it("should apply a composed normalizer", async () => {
    const { db } = createDatabase({ custom: true });

    const result = await executeQuery(db, { statement: "select 1" }, adapter, () => ({
      rows: [{ normalized: true }],
      rowCount: 0,
    }));

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.value).toEqual({ rows: [{ normalized: true }], rowCount: 0 });
    }
  });

  it("should return error for named params", async () => {
    const { db, execute } = createDatabase({ rows: [] });

    const query: SqlQuery = {
      statement: "select * from t where id = :id",
      params: { id: 1 },
    };

    const result = await executeQuery(db, query, adapter, normalizeDrizzleResult);

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error).toBeInstanceOf(SqlError);
      expect(result.error.meta["reason"]).toBe("invalid_query");
      expect(result.error.meta["context"]?.["violation"]).toBe("named_parameters");
      expect(result.error.meta["details"]?.["retriable"]).toBe(false);
    }

    expect(execute).not.toHaveBeenCalled();
  });

  it("should reject a parameter mismatch before executing", async () => {
    const { db, execute } = createDatabase({ rows: [] });

    const result = await executeQuery(
      db,
      { statement: "select * from t where id = ?", params: [] },
      adapter,
      normalizeDrizzleResult
    );

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.meta["reason"]).toBe("invalid_query");
      expect(result.error.meta["context"]?.["violation"]).toBe("parameter_count_mismatch");
    }

    expect(execute).not.toHaveBeenCalled();
  });

  it("should map execution errors", async () => {
    const executionError = new Error("Database connection failed");
    const db = { execute: vi.fn().mockRejectedValue(executionError) };

    const result = await executeQuery(
      db,
      { statement: "select * from t" },
      adapter,
      normalizeDrizzleResult
    );

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error).toBeInstanceOf(SqlError);
      expect(result.error.meta["reason"]).toBe("query_failed");
      expect(result.error.cause).toBe(executionError);
    }
  });

  it("should map a failure wrapped by Drizzle to the driver reason", async () => {
    const driverError = Object.assign(new Error("syntax error"), { code: "42601" });
    const wrapped = Object.assign(new Error("Failed query: selct 1\nparams: "), {
      query: "selct 1",
      params: [],
      cause: driverError,
    });
    const db = { execute: vi.fn().mockRejectedValue(wrapped) };

    const result = await executeQuery(
      db,
      { statement: "selct 1" },
      adapter,
      normalizeDrizzleResult
    );

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.meta["reason"]).toBe("invalid_query");
      expect(result.error.cause).toBe(driverError);
      expect(result.error.message).not.toContain("selct 1");
    }
  });

  it("should handle DOMException errors during execution", async () => {
    const abortError = new DOMException("Aborted", "AbortError");
    const db = { execute: vi.fn().mockRejectedValue(abortError) };

    const result = await executeQuery(
      db,
      { statement: "select * from t" },
      adapter,
      normalizeDrizzleResult
    );

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error).toBeInstanceOf(SqlError);
      expect(result.error.meta["reason"]).toBe("cancelled");
      expect(result.error.meta["details"]?.["retriable"]).toBe(true);
    }
  });

  it("should return invalid_configuration when the database cannot execute", async () => {
    const result = await executeQuery(
      {},
      { statement: "select * from t" },
      adapter,
      normalizeDrizzleResult
    );

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.meta["reason"]).toBe("invalid_configuration");
      expect(result.error.meta["details"]?.["expected"]).toBe(
        "drizzle database with execute() or all()"
      );
    }
  });
});
