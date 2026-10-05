import type { SqlClient } from "../../contracts/client.js";
import type { SqlQuery } from "../../contracts/query.js";
import type { SqlOperationResult, SqlResult } from "../../contracts/result.js";
import type { SqlErrorReason } from "../../errors/index.js";
import type { SqlOperationObserver } from "../../observers/operation.js";

import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { SqlError } from "../../errors/sql.js";

/**
 * Outcome of the fake atomic mechanism owned by the double.
 *
 * @remarks Test-only. @comity/sql declares no execution mechanism.
 */
type FakeOutcome =
  | { readonly kind: "ok"; readonly results: readonly SqlResult<unknown>[] }
  | { readonly kind: "error"; readonly reason: SqlErrorReason };

/**
 * Contract conformance double for `SqlClient`.
 *
 * @remarks
 * Encodes the `atomicBatch` obligations that `@comity/sql` declares but cannot
 * itself implement: empty-input rejection before the mechanism runs, one
 * observer lifecycle per batch, and single-error failure reporting.
 */
function createBatchClient(options: {
  readonly outcome: FakeOutcome;
  readonly observer?: SqlOperationObserver;
}) {
  const mechanism = vi.fn(async (queries: readonly Readonly<SqlQuery>[]) => {
    const outcome = options.outcome;

    if (outcome.kind === "error") {
      throw new SqlError(outcome.reason, {
        details: { operation: "batch", retriable: false },
      });
    }

    return outcome.results.slice(0, queries.length);
  });

  const invoke = vi.fn(
    async (
      queries: readonly Readonly<SqlQuery>[]
    ): Promise<SqlOperationResult<readonly SqlResult<unknown>[]>> => {
      // Guarantee 10: empty input is rejected before any mechanism invocation.
      if (queries.length === 0) {
        return {
          success: false,
          error: new SqlError("invalid_query", {
            details: { operation: "batch", retriable: false },
          }),
        };
      }

      const started = performance.now();
      options.observer?.onAtomicBatchStarted({ id: "batch-1" });

      try {
        const results = await mechanism(queries);

        // Guarantees 4 and 5.
        if (results.length !== queries.length) {
          throw new SqlError("query_failed", {
            details: { operation: "batch", retriable: false },
          });
        }

        options.observer?.onAtomicBatchCompleted({
          id: "batch-1",
          duration: performance.now() - started,
          statementCount: queries.length,
        });

        return { success: true, value: results };
      } catch (error) {
        const sqlError =
          error instanceof SqlError
            ? error
            : new SqlError("query_failed", {
                details: { operation: "batch", retriable: false },
                cause: error,
              });

        options.observer?.onAtomicBatchFailed({
          id: "batch-1",
          reason: sqlError.meta["reason"],
          duration: performance.now() - started,
          statementCount: queries.length,
        });

        // Guarantee 11: one error, no partial result.
        return { success: false, error: sqlError };
      }
    }
  );

  const client: SqlClient = {
    query: async () => ({ success: true, value: { rows: [] } }),
    begin: async () => ({ success: false, error: new SqlError("invalid_configuration") }),
    atomicBatch: invoke,
  };

  return { client, invoke, mechanism };
}

/**
 * Create an observer double recording every SQL lifecycle event.
 *
 * @returns Observer double backed by spies.
 */
function createObserver() {
  return {
    onQueryStarted: vi.fn(),
    onQueryCompleted: vi.fn(),
    onQueryFailed: vi.fn(),
    onTransactionStarted: vi.fn(),
    onTransactionCommitted: vi.fn(),
    onTransactionRolledBack: vi.fn(),
    onAtomicBatchStarted: vi.fn(),
    onAtomicBatchCompleted: vi.fn(),
    onAtomicBatchFailed: vi.fn(),
  } satisfies SqlOperationObserver;
}

describe("SqlClient atomicBatch contract", () => {
  describe("contract shape", () => {
    it("exposes atomicBatch as a required method", () => {
      expectTypeOf<SqlClient["atomicBatch"]>().toBeFunction();

      const { client } = createBatchClient({ outcome: { kind: "ok", results: [] } });

      expect(typeof client.atomicBatch).toBe("function");
      expect(client.atomicBatch.length).toBe(1);
    });

    it("is not modelled as a transaction call", () => {
      const { client } = createBatchClient({ outcome: { kind: "ok", results: [] } });

      expect(client).not.toHaveProperty("batch");
      expect("transaction" in client).toBe(false);
      expect(Object.keys(client).sort()).toEqual(["atomicBatch", "begin", "query"]);
    });
  });

  describe("empty input", () => {
    it("fails with invalid_query and operation batch", async () => {
      const { client } = createBatchClient({ outcome: { kind: "ok", results: [] } });

      const result = await client.atomicBatch([]);

      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.meta["reason"]).toBe("invalid_query");
        expect(result.error.meta["details"]?.["operation"]).toBe("batch");
        expect(result.error.code).toBe("sql:invalid_query");
      }
    });

    it("does not invoke the execution mechanism", async () => {
      const { client, mechanism } = createBatchClient({ outcome: { kind: "ok", results: [] } });

      await client.atomicBatch([]);

      expect(mechanism).not.toHaveBeenCalled();
    });
  });

  describe("result contract", () => {
    it("keeps results positionally aligned with input statements", async () => {
      const { client } = createBatchClient({
        outcome: {
          kind: "ok",
          results: [
            { rows: [{ id: 1 }], rowCount: 1 },
            { rows: [], rowCount: 0 },
          ],
        },
      });

      const queries: readonly Readonly<SqlQuery>[] = [
        { statement: "select 1", params: [] },
        { statement: "delete from t where false", params: [] },
      ];

      const result = await client.atomicBatch(queries);

      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.value).toHaveLength(queries.length);
        expect(result.value[0]?.rows).toEqual([{ id: 1 }]);
        expect(result.value[1]?.rowCount).toBe(0);
      }
    });

    it("represents heterogeneous statement results without a shared row type", () => {
      const heterogeneous = [
        { rows: [{ id: 1 }], rowCount: 1 },
        { rows: [], rowCount: 0 },
      ] satisfies readonly SqlResult<unknown>[];

      expectTypeOf(heterogeneous).toMatchTypeOf<readonly SqlResult<unknown>[]>();
      expect(heterogeneous).toHaveLength(2);
    });

    it("treats a zero-row mutation as a successful operation", async () => {
      const { client } = createBatchClient({
        outcome: { kind: "ok", results: [{ rows: [], rowCount: 0 }] },
      });

      const result = await client.atomicBatch([{ statement: "delete from t where false" }]);

      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.value[0]?.rowCount).toBe(0);
      }
    });
  });

  describe("error semantics", () => {
    it("maps an execution failure to query_failed", async () => {
      const { client } = createBatchClient({
        outcome: { kind: "error", reason: "query_failed" },
      });

      const result = await client.atomicBatch([{ statement: "select 1" }]);

      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.meta["reason"]).toBe("query_failed");
        expect(result.error.meta["details"]?.["operation"]).toBe("batch");
      }
    });

    it("represents an adapter without atomicity as invalid_configuration", async () => {
      const { client, mechanism } = createBatchClient({
        outcome: { kind: "error", reason: "invalid_configuration" },
      });

      const result = await client.atomicBatch([{ statement: "select 1" }]);

      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.meta["reason"]).toBe("invalid_configuration");
      }

      expect(mechanism).toHaveBeenCalledTimes(1);
    });

    it("represents cancellation as cancelled", () => {
      const cancelled = new SqlError("cancelled", {
        details: { operation: "batch", retriable: false },
      });

      expect(cancelled.code).toBe("sql:cancelled");
      expect(cancelled.meta["details"]?.["operation"]).toBe("batch");
    });

    it("does not expose a failing statement index", async () => {
      const { client } = createBatchClient({
        outcome: { kind: "error", reason: "query_failed" },
      });

      const result = await client.atomicBatch([
        { statement: "select 1" },
        { statement: "select bad" },
      ]);

      if (!result.success) {
        expect(result.error.meta).not.toHaveProperty("failedIndex");
        expect(result.error.meta["details"]).not.toHaveProperty("failedIndex");
        expect(JSON.stringify(result.error.meta)).not.toContain("select");
      }
    });

    it("exposes no partial result when a batch fails", async () => {
      const { client } = createBatchClient({
        outcome: { kind: "error", reason: "query_failed" },
      });

      const result = await client.atomicBatch([
        { statement: "insert into t values (1)" },
        { statement: "select bad" },
      ]);

      expect(result).not.toHaveProperty("value");
      expect(result.success).toBe(false);
    });
  });

  describe("observer", () => {
    it("emits exactly one started and one completed event per batch", async () => {
      const observer = createObserver();
      const { client } = createBatchClient({
        outcome: {
          kind: "ok",
          results: [
            { rows: [], rowCount: 0 },
            { rows: [], rowCount: 0 },
          ],
        },
        observer,
      });

      await client.atomicBatch([{ statement: "select 1" }, { statement: "select 2" }]);

      expect(observer.onAtomicBatchStarted).toHaveBeenCalledTimes(1);
      expect(observer.onAtomicBatchCompleted).toHaveBeenCalledTimes(1);
      expect(observer.onAtomicBatchFailed).not.toHaveBeenCalled();
    });

    it("reports the submitted statement count", async () => {
      const observer = createObserver();
      const { client } = createBatchClient({
        outcome: {
          kind: "ok",
          results: [
            { rows: [], rowCount: 0 },
            { rows: [], rowCount: 0 },
            { rows: [], rowCount: 0 },
          ],
        },
        observer,
      });

      await client.atomicBatch([
        { statement: "select 1" },
        { statement: "select 2" },
        { statement: "select 3" },
      ]);

      expect(observer.onAtomicBatchCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ statementCount: 3 })
      );
    });

    it("emits exactly one started and one failed event on failure", async () => {
      const observer = createObserver();
      const { client } = createBatchClient({
        outcome: { kind: "error", reason: "query_failed" },
        observer,
      });

      await client.atomicBatch([{ statement: "select 1" }, { statement: "select bad" }]);

      expect(observer.onAtomicBatchStarted).toHaveBeenCalledTimes(1);
      expect(observer.onAtomicBatchFailed).toHaveBeenCalledTimes(1);
      expect(observer.onAtomicBatchCompleted).not.toHaveBeenCalled();
    });

    it("exposes no statement contents or per-statement lifecycle", async () => {
      const observer = createObserver();
      const { client } = createBatchClient({
        outcome: { kind: "error", reason: "query_failed" },
        observer,
      });

      await client.atomicBatch([
        { statement: "insert into users values ('secret')", params: ["secret"] },
      ]);

      const payload = observer.onAtomicBatchFailed.mock.calls[0]?.[0];

      expect(Object.keys(payload ?? {}).sort()).toEqual([
        "duration",
        "id",
        "reason",
        "statementCount",
      ]);
      expect(JSON.stringify(payload)).not.toContain("secret");
      expect(JSON.stringify(payload)).not.toContain("insert");
      expect(observer.onQueryStarted).not.toHaveBeenCalled();
      expect(observer.onQueryCompleted).not.toHaveBeenCalled();
      expect(observer.onQueryFailed).not.toHaveBeenCalled();
    });

    it("does not emit lifecycle events for empty input", async () => {
      const observer = createObserver();
      const { client } = createBatchClient({
        outcome: { kind: "ok", results: [] },
        observer,
      });

      await client.atomicBatch([]);

      expect(observer.onAtomicBatchStarted).not.toHaveBeenCalled();
      expect(observer.onAtomicBatchCompleted).not.toHaveBeenCalled();
      expect(observer.onAtomicBatchFailed).not.toHaveBeenCalled();
    });
  });
});
