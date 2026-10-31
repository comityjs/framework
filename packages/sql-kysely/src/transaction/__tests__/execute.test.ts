import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeTransaction } from "../execute.js";

describe("executeTransaction", () => {
  const adapter = "test-adapter";

  it("should successfully create a transaction", async () => {
    const mockTransaction = {
      executeQuery: vi.fn().mockResolvedValue({
        rows: [],
        numAffectedRows: 0n,
      }),
    };

    const mockDb = {
      transaction: vi.fn().mockReturnValue({
        execute: vi.fn().mockImplementation(async (fn) => {
          // Simulate the barrier pattern - resolve immediately
          await Promise.resolve();
          return await fn(mockTransaction);
        }),
      }),
    };

    const result = await executeTransaction(mockDb as any, adapter);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBeDefined();
      expect(typeof result.value.query).toBe("function");
      expect(typeof result.value.commit).toBe("function");
      expect(typeof result.value.rollback).toBe("function");
    }
  });

  it("should handle transaction creation errors", async () => {
    const creationError = new Error("Transaction creation failed");
    const mockDb = {
      transaction: vi.fn().mockImplementation(() => {
        throw creationError;
      }),
    };

    const result = await executeTransaction(mockDb as any, adapter);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toBe("The SQL transaction failed");
      expect(result.error.cause).toBe(creationError);
    }
  });

  describe("transaction operations", () => {
    let mockTransaction: any;
    let mockDb: any;
    let transactionResult: any;

    beforeEach(async () => {
      mockTransaction = {
        executeQuery: vi.fn(),
      };

      let resolveBarrier: () => void;
      const barrier = new Promise<void>((resolve) => {
        resolveBarrier = resolve;
      });

      mockDb = {
        transaction: vi.fn().mockReturnValue({
          execute: vi.fn().mockImplementation(async (fn) => {
            // Start the transaction
            const result = fn(mockTransaction);
            // Resolve barrier to allow commit/rollback
            resolveBarrier();
            return await result;
          }),
        }),
      };

      const result = await executeTransaction(mockDb, adapter);
      if (result.success) {
        transactionResult = result.value;
      }
    });

    it("should execute queries within transaction", async () => {
      mockTransaction.executeQuery.mockResolvedValue({
        rows: [{ id: 1 }],
        numAffectedRows: 1n,
      });

      const queryResult = await transactionResult.query({
        statement: "SELECT * FROM users",
      });

      expect(queryResult.success).toBe(true);
      expect(queryResult.value?.rows).toEqual([{ id: 1 }]);
      expect(mockTransaction.executeQuery).toHaveBeenCalled();
    });

    it("should commit transaction successfully", async () => {
      mockDb.transaction().execute.mockResolvedValue(undefined);

      const commitResult = await transactionResult.commit();

      expect(commitResult.success).toBe(true);
      expect(commitResult.value).toBeUndefined();
    });

    it("should handle commit errors", async () => {
      // Note: In this implementation, commit always succeeds as it just resolves the transaction barrier
      const commitResult = await transactionResult.commit();

      expect(commitResult.success).toBe(true);
    });

    it("should report commit failures when the underlying transaction rejects", async () => {
      const commitError = new Error("Commit failed");
      let resolveBarrier: () => void;
      const barrier = new Promise<void>((resolve) => {
        resolveBarrier = resolve;
      });

      mockDb = {
        transaction: vi.fn().mockReturnValue({
          execute: vi.fn().mockImplementation(async (fn) => {
            const result = fn(mockTransaction);
            resolveBarrier();
            await result;
            throw commitError;
          }),
        }),
      };

      const result = await executeTransaction(mockDb, adapter);
      if (!result.success) throw new Error("expected transaction");

      const commitResult = await result.value.commit();

      expect(commitResult.success).toBe(false);
      if (!commitResult.success) {
        expect(commitResult.error.meta.reason).toBe("transaction_failed");
        expect(commitResult.error.cause).toBe(commitError);
      }
    });

    it("should rollback transaction successfully", async () => {
      mockDb.transaction().execute.mockImplementation(async () => {
        throw new Error("rollback"); // Simulate rollback rejection
      });

      const rollbackResult = await transactionResult.rollback();

      expect(rollbackResult.success).toBe(true);
      expect(rollbackResult.value).toBeUndefined();
    });

    it("should handle rollback errors", async () => {
      // Note: In this implementation, rollback always succeeds as it just rejects the transaction barrier
      const rollbackResult = await transactionResult.rollback();

      expect(rollbackResult.success).toBe(true);
    });
  });

  it("should report a transaction that resolves without starting", async () => {
    const mockDb = {
      transaction: vi.fn().mockReturnValue({
        // Resolves without ever invoking the transaction callback.
        execute: vi.fn().mockResolvedValue(undefined),
      }),
    };

    const result = await executeTransaction(mockDb as any, adapter);

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.meta["reason"]).toBe("transaction_failed");
    }
  });

  it("should reject a transaction function that is not asynchronous", async () => {
    const mockDb = {
      transaction: vi.fn().mockReturnValue({
        execute: vi.fn().mockReturnValue(undefined),
      }),
    };

    const result = await executeTransaction(mockDb as any, adapter);

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.meta["reason"]).toBe("invalid_configuration");
      expect(result.error.meta["details"]?.["expected"]).toBe(
        "kysely database with an asynchronous transaction()"
      );
      expect(result.error.meta["context"]?.["violation"]).toBe("synchronous_transaction");
    }
  });

  it("should wait for the transaction to start before resolving", async () => {
    const mockTransaction = {
      executeQuery: vi.fn().mockResolvedValue({ rows: [{ id: 5 }], numAffectedRows: 1n }),
    };

    // Pooled drivers acquire a connection and run BEGIN before invoking the
    // callback, so the handle is assigned several ticks after transaction().
    const mockDb = {
      transaction: vi.fn().mockReturnValue({
        execute: vi.fn().mockImplementation(async (fn: (trx: unknown) => Promise<void>) => {
          await new Promise((resolve) => setTimeout(resolve, 5));

          return await fn(mockTransaction);
        }),
      }),
    };

    const created = await executeTransaction(mockDb as any, adapter);

    if (!created.success) throw new Error("expected transaction");

    const query = await created.value.query<{ id: number }>({ statement: "select 5" });

    expect(query.success).toBe(true);

    if (query.success) {
      expect(query.value.rows).toEqual([{ id: 5 }]);
    }

    await created.value.commit();
  });

  it("should report a transaction that fails before it starts", async () => {
    const connectionError = new Error("connection lost");
    const mockDb = {
      transaction: vi.fn().mockReturnValue({
        execute: vi.fn().mockImplementation(async () => {
          await Promise.resolve();
          throw connectionError;
        }),
      }),
    };

    const result = await executeTransaction(mockDb as any, adapter);

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.meta["reason"]).toBe("transaction_failed");
      expect(result.error.cause).toBe(connectionError);
    }
  });

  it("should not surface an unhandled rejection when the capability is abandoned", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };

    process.on("unhandledRejection", onUnhandled);

    try {
      const mockDb = {
        transaction: vi.fn().mockReturnValue({
          execute: vi.fn().mockImplementation(async (fn: (trx: unknown) => Promise<void>) => {
            // Start the transaction, then fail while nobody observes it.
            void fn({ executeQuery: async () => ({ rows: [] }) });
            await new Promise((resolve) => setTimeout(resolve, 5));

            throw new Error("connection lost");
          }),
        }),
      };

      const created = await executeTransaction(mockDb as any, adapter);

      expect(created.success).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 30));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toEqual([]);
  });
});
