import type {
  DrizzleAtomicBatchExecutor,
  DrizzleAtomicStatement,
  DrizzleAtomicStatementResult,
} from "../../client/types.js";

import { describe, expect, it, vi } from "vitest";
import { createDrizzleSqlClient } from "../../client/create-drizzle.js";

/**
 * Minimal Drizzle stand-in that records whether sequential or transactional
 * execution was attempted, so fallbacks can be detected.
 */
class FakeDrizzle {
  executeCalls = 0;

  transactionCalls = 0;

  async execute(_query: unknown) {
    this.executeCalls += 1;

    return { rows: [{ id: 99 }] };
  }

  transaction() {
    this.transactionCalls += 1;

    return {
      execute: async <T>(fn: (trx: unknown) => Promise<T>): Promise<T> =>
        await fn({ execute: async () => ({ rows: [] }) }),
    };
  }
}

/**
 * Test double for the composition-owned executor.
 *
 * It models a database batch binding: it receives already-normalised
 * statements, binds positional parameters itself, and returns one result per
 * statement.
 *
 * @param results - Results to return, positionally aligned with the input
 * @param impl - Failure implementation, when the executor must reject
 *
 * @returns The executor and a record of the calls it received
 */
function createExecutorDouble(
  results: readonly DrizzleAtomicStatementResult[] = [],
  impl?: (statements: readonly DrizzleAtomicStatement[]) => Promise<never>
) {
  const calls: (readonly DrizzleAtomicStatement[])[] = [];

  const executor: DrizzleAtomicBatchExecutor = {
    execute: vi.fn(async (statements) => {
      calls.push(statements);

      if (impl) {
        return await impl(statements);
      }

      return results;
    }),
  };

  return { executor, calls };
}

/**
 * Build a client over the fake database.
 *
 * @param atomicBatchExecutor - Optional atomic batch executor
 *
 * @returns The client and the fake database
 */
function client(atomicBatchExecutor?: DrizzleAtomicBatchExecutor) {
  const db = new FakeDrizzle();

  const sql = createDrizzleSqlClient(
    atomicBatchExecutor === undefined
      ? { db, adapter: "postgres" }
      : { db, adapter: "postgres", atomicBatchExecutor }
  );

  return { sql, db };
}

describe("atomicBatch", () => {
  it("delegates to the executor and preserves positional order", async () => {
    const { executor, calls } = createExecutorDouble([
      { rows: [{ id: 1 }], affectedRows: 1 },
      { rows: [{ id: 2 }], affectedRows: 1 },
    ]);
    const { sql, db } = client(executor);

    const res = await sql.atomicBatch([
      { statement: "update t set a = ? where id = ?", params: [1, 1] },
      { statement: "update t set a = ? where id = ?", params: [2, 2] },
    ]);

    expect(res.success).toBe(true);
    // Exactly one executor invocation.
    expect(executor.execute).toHaveBeenCalledTimes(1);
    // No sequential fallback and no transaction attempt.
    expect(db.executeCalls).toBe(0);
    expect(db.transactionCalls).toBe(0);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.map((s) => s.statement)).toEqual([
      "update t set a = ? where id = ?",
      "update t set a = ? where id = ?",
    ]);
    expect(calls[0]!.map((s) => s.params)).toEqual([
      [1, 1],
      [2, 2],
    ]);

    if (res.success) {
      expect(res.value).toHaveLength(2);
      expect(res.value[0]!.rows).toEqual([{ id: 1 }]);
      expect(res.value[0]!.rowCount).toBe(1);
      expect(res.value[1]!.rows).toEqual([{ id: 2 }]);
      expect(res.value[1]!.rowCount).toBe(1);
    }
  });

  it("defaults missing params to an empty positional list", async () => {
    const { executor, calls } = createExecutorDouble([{ rows: [] }]);
    const { sql } = client(executor);

    const res = await sql.atomicBatch([{ statement: "update t set a = 1" }]);

    expect(res.success).toBe(true);
    expect(calls[0]![0]!.params).toEqual([]);
  });

  describe("rejections", () => {
    it("rejects an empty batch without consulting the executor", async () => {
      const { executor } = createExecutorDouble([]);
      const { sql } = client(executor);

      const res = await sql.atomicBatch([]);

      expect(res.success).toBe(false);
      expect(executor.execute).not.toHaveBeenCalled();

      if (!res.success) {
        expect(res.error.meta["reason"]).toBe("invalid_query");
        expect(res.error.meta["context"]?.["violation"]).toBe("empty_batch");
        expect(res.error.meta["details"]?.["operation"]).toBe("batch");
      }
    });

    it("reports invalid_configuration when no executor is configured", async () => {
      const { sql } = client();

      const res = await sql.atomicBatch([{ statement: "update t set a = 1", params: [] }]);

      expect(res.success).toBe(false);

      if (!res.success) {
        expect(res.error.meta["reason"]).toBe("invalid_configuration");
        expect(res.error.meta["context"]?.["violation"]).toBe("atomic_batch_executor_missing");
      }
    });

    it("rejects named parameters before invoking the executor", async () => {
      const { executor } = createExecutorDouble([]);
      const { sql } = client(executor);

      const res = await sql.atomicBatch([
        { statement: "update t set a = :a", params: { a: 1 } as never },
      ]);

      expect(res.success).toBe(false);
      expect(executor.execute).not.toHaveBeenCalled();

      if (!res.success) {
        expect(res.error.meta["reason"]).toBe("invalid_query");
        expect(res.error.meta["context"]?.["violation"]).toBe("named_parameters");
      }
    });

    it("maps an executor failure through the driver error mapping", async () => {
      const { executor } = createExecutorDouble([], async () => {
        const driverError = Object.assign(new Error("syntax error"), { code: "42601" });
        const wrapped = Object.assign(new Error("Failed query: selct 1\nparams: "), {
          query: "selct 1",
          params: [],
          cause: driverError,
        });

        throw wrapped;
      });
      const db = new FakeDrizzle();
      const sql = createDrizzleSqlClient({
        db,
        adapter: "postgres",
        atomicBatchExecutor: executor,
      });

      const res = await sql.atomicBatch([{ statement: "selct 1", params: [] }]);

      expect(res.success).toBe(false);

      if (!res.success) {
        expect(res.error.meta["reason"]).toBe("invalid_query");
        expect(res.error.meta["details"]?.["operation"]).toBe("batch");
        expect(res.error.meta["details"]?.["adapter"]).toBe("postgres");
      }
    });

    it("rejects an executor that does not return one result per statement", async () => {
      const { executor } = createExecutorDouble([{ rows: [] }]);
      const { sql } = client(executor);

      const res = await sql.atomicBatch([
        { statement: "update t set a = 1", params: [] },
        { statement: "update t set a = 2", params: [] },
      ]);

      expect(res.success).toBe(false);

      if (!res.success) {
        expect(res.error.meta["reason"]).toBe("query_failed");
        expect(res.error.meta["details"]?.["operation"]).toBe("batch");
      }
    });
  });

  it("maps affectedRows to rowCount, including zero affected rows", async () => {
    const { executor } = createExecutorDouble([
      { rows: [], affectedRows: 1 },
      { rows: [], affectedRows: 0 },
    ]);
    const { sql } = client(executor);

    const res = await sql.atomicBatch([
      { statement: "update t set a = 1 where id = 1", params: [] },
      { statement: "update t set a = 1 where id = 2", params: [] },
    ]);

    expect(res.success).toBe(true);

    if (res.success) {
      expect(res.value[0]!.rowCount).toBe(1);
      // A zero-row mutation is still a successful SQL operation.
      expect(res.value[1]!.rowCount).toBe(0);
      expect(res.value[1]!.rows).toEqual([]);
    }
  });

  it("maps a bigint affectedRows count", async () => {
    const { executor } = createExecutorDouble([{ rows: [], affectedRows: 4n }]);
    const { sql } = client(executor);

    const res = await sql.atomicBatch([{ statement: "update t set a = 1", params: [] }]);

    expect(res.success).toBe(true);

    if (res.success) {
      expect(res.value[0]!.rowCount).toBe(4);
    }
  });

  it("falls back to rows.length when affectedRows is absent", async () => {
    const { executor } = createExecutorDouble([{ rows: [{ id: 1 }, { id: 2 }] }]);
    const { sql } = client(executor);

    const res = await sql.atomicBatch([{ statement: "select 1", params: [] }]);

    expect(res.success).toBe(true);

    if (res.success) {
      expect(res.value[0]!.rowCount).toBe(2);
    }
  });

  describe("drizzle driver boundary", () => {
    it("exposes no batch method on the database object the adapter uses", () => {
      const db = new FakeDrizzle();

      expect("batch" in db).toBe(false);
      expect((db as unknown as Record<string, unknown>)["batch"]).toBeUndefined();
    });

    it("supports atomicBatch without any batch primitive on the database", async () => {
      // Proves the injected executor is the only source of atomicity.
      const { executor } = createExecutorDouble([
        { rows: [{ id: 1 }], affectedRows: 1 },
        { rows: [{ id: 2 }], affectedRows: 1 },
      ]);
      const { sql } = client(executor);

      const res = await sql.atomicBatch([
        { statement: "update t set a = 1", params: [] },
        { statement: "update t set a = 2", params: [] },
      ]);

      expect(res.success).toBe(true);
    });
  });
});
