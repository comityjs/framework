import type {
  KyselyAtomicBatchExecutor,
  KyselyAtomicStatement,
  KyselyAtomicStatementResult,
} from "../../client/types.js";

import { describe, expect, it, vi } from "vitest";
import { createKyselySqlClient } from "../../client/create-kysely.js";

/**
 * Minimal Kysely stand-in that records whether sequential or transactional
 * execution was attempted, so fallbacks can be detected.
 */
class FakeKysely {
  executeQueryCalls = 0;

  transactionCalls = 0;

  async executeQuery(_query: unknown) {
    this.executeQueryCalls += 1;

    return { rows: [{ id: 99 }] };
  }

  transaction() {
    this.transactionCalls += 1;

    return {
      execute: async <T>(fn: (trx: unknown) => Promise<T>): Promise<T> =>
        await fn({ executeQuery: async () => ({ rows: [] }) }),
    };
  }
}

/**
 * Test double for the composition-owned executor.
 *
 * It models the D1 binding contract: it receives already-normalised statements,
 * binds positional parameters itself, and returns one result per statement.
 */
function createExecutorDouble(
  results: readonly KyselyAtomicStatementResult[] = [],
  impl?: (statements: readonly KyselyAtomicStatement[]) => Promise<never>
) {
  const calls: (readonly KyselyAtomicStatement[])[] = [];

  const executor: KyselyAtomicBatchExecutor = {
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

function client(atomicBatchExecutor?: KyselyAtomicBatchExecutor) {
  const db = new FakeKysely();
  // @ts-expect-error - FakeKysely is a structural stand-in, not a real Kysely<DB>
  const sql = createKyselySqlClient({ db, adapter: "kysely", atomicBatchExecutor });

  return { sql, db };
}

describe("atomicBatch", () => {
  it("delegates to the executor and preserves positional order", async () => {
    const { executor, calls } = createExecutorDouble([
      { rows: [{ id: 1 }], numAffectedRows: 1n },
      { rows: [{ id: 2 }], numAffectedRows: 1n },
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
    expect(db.executeQueryCalls).toBe(0);
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
    describe("atomicBatch input validation", () => {
      it("rejects an empty batch without invoking the executor", async () => {
        const { executor } = createExecutorDouble();
        const { sql, db } = client(executor);

        const res = await sql.atomicBatch([]);

        expect(res.success).toBe(false);
        expect(executor.execute).not.toHaveBeenCalled();
        expect(db.executeQueryCalls).toBe(0);
        if (!res.success) {
          expect(res.error.meta["reason"]).toBe("invalid_query");
          expect(res.error.meta["details"]?.["operation"]).toBe("batch");
        }
      });

      it("rejects an empty batch identically when no executor is supplied", async () => {
        const { sql } = client();

        const res = await sql.atomicBatch([]);

        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.error.meta["reason"]).toBe("invalid_query");
          expect(res.error.meta["details"]?.["operation"]).toBe("batch");
        }
      });

      it("reports invalid_configuration when no executor is supplied", async () => {
        const { sql, db } = client();

        const res = await sql.atomicBatch([{ statement: "update t set a = 1", params: [] }]);

        expect(res.success).toBe(false);
        // No sequential fallback, no transaction fallback, nothing executed.
        expect(db.executeQueryCalls).toBe(0);
        expect(db.transactionCalls).toBe(0);
        if (!res.success) {
          expect(res.error.meta["reason"]).toBe("invalid_configuration");
          expect(res.error.meta["details"]?.["operation"]).toBe("batch");
        }
      });

      it("rejects named parameters before invoking the executor", async () => {
        const { executor } = createExecutorDouble();
        const { sql, db } = client(executor);

        const res = await sql.atomicBatch([
          { statement: "update t set a = ?", params: [] },
          // @ts-expect-error - named parameters are intentionally unsupported
          { statement: "update t set b = ?", params: { named: 1 } },
        ]);

        expect(res.success).toBe(false);

        describe("atomicBatch error mapping", () => {
          it("surfaces an executor failure without partial results", async () => {
            const { executor } = createExecutorDouble([], async () => {
              throw new Error("constraint violation");
            });
            const { sql, db } = client(executor);

            const res = await sql.atomicBatch([
              { statement: "update t set a = 1", params: [] },
              { statement: "update t set a = 2", params: [] },
            ]);

            expect(res.success).toBe(false);
            // Invoked exactly once; no sequential fallback.
            expect(executor.execute).toHaveBeenCalledTimes(1);
            expect(db.executeQueryCalls).toBe(0);
            expect(db.transactionCalls).toBe(0);
            if (!res.success) {
              expect(res.error.meta["reason"]).toBe("query_failed");
              expect(res.error.meta["details"]?.["operation"]).toBe("batch");
              // The contract does not define a failing-statement index.
              expect(res.error.meta["details"]).not.toHaveProperty("failedIndex");
            }
          });

          it("maps a cancellation to the cancelled reason", async () => {
            const { executor } = createExecutorDouble([], async () => {
              throw new DOMException("aborted", "AbortError");
            });
            const { sql } = client(executor);

            const res = await sql.atomicBatch([{ statement: "update t set a = 1", params: [] }]);

            expect(res.success).toBe(false);
            if (!res.success) {
              expect(res.error.meta["reason"]).toBe("cancelled");
              expect(res.error.meta["details"]?.["operation"]).toBe("batch");
            }
          });

          it("reuses the existing driver error code mapping for the batch operation", async () => {
            const { executor } = createExecutorDouble([], async () => {
              throw Object.assign(new Error("syntax error"), { code: "42601" });
            });
            const db = new FakeKysely();
            // @ts-expect-error - structural stand-in
            const sql = createKyselySqlClient({
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

        describe("kysely driver boundary", () => {
          it("exposes no batch method on the database object the adapter uses", () => {
            const db = new FakeKysely();
            expect("batch" in db).toBe(false);
            expect((db as unknown as Record<string, unknown>)["batch"]).toBeUndefined();
          });

          it("supports atomicBatch without any batch primitive on the database", async () => {
            // Proves the injected executor is the only source of atomicity.
            const { executor } = createExecutorDouble([
              { rows: [{ id: 1 }], numAffectedRows: 1n },
              { rows: [{ id: 2 }], numAffectedRows: 1n },
            ]);
            const { sql } = client(executor);

            const res = await sql.atomicBatch([
              { statement: "update t set a = 1", params: [] },
              { statement: "update t set a = 2", params: [] },
            ]);

            expect(res.success).toBe(true);
          });
        });

        // The whole batch is validated before execution, so nothing ran.
        expect(executor.execute).not.toHaveBeenCalled();
        expect(db.executeQueryCalls).toBe(0);
        if (!res.success) {
          expect(res.error.meta["reason"]).toBe("invalid_query");
          expect(res.error.meta["details"]?.["operation"]).toBe("batch");
        }
      });
    });

    const { executor, calls } = createExecutorDouble([{ rows: [] }]);
    const { sql } = client(executor);

    const res = await sql.atomicBatch([{ statement: "delete from t" }]);

    expect(res.success).toBe(true);
    expect(calls[0]![0]!.params).toEqual([]);
  });

  it("maps numAffectedRows to rowCount, including zero affected rows", async () => {
    const { executor } = createExecutorDouble([
      { rows: [], numAffectedRows: 1n },
      { rows: [], numAffectedRows: 0n },
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

  it("falls back to rows.length when numAffectedRows is absent", async () => {
    const { executor } = createExecutorDouble([{ rows: [{ id: 1 }, { id: 2 }] }]);
    const { sql } = client(executor);

    const res = await sql.atomicBatch([{ statement: "select 1", params: [] }]);

    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.value[0]!.rowCount).toBe(2);
    }
  });
});
