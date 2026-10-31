import { describe, expect, it, vi } from "vitest";

import { normalizeDrizzleResult } from "../../internal/normalize-result.js";
import { executeTransaction } from "../execute.js";

const adapter = "postgres";

/**
 * Build a database double whose transaction callback stays open until the
 * capability releases it.
 *
 * @param rows - Rows the transactional execute resolves with
 * @param failure - Error the transaction promise rejects with, if any
 *
 * @returns The database and its transactional execute spy
 */
function createDatabase(rows: readonly unknown[] = [{ id: 1 }], failure?: Error) {
  const trxExecute = vi.fn().mockResolvedValue({ rows, rowCount: rows.length });

  const db = {
    execute: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }),
    transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({ execute: trxExecute });

      if (failure !== undefined) {
        throw failure;
      }
    }),
  };

  return { db, trxExecute };
}

describe("executeTransaction", () => {
  it("should create a transaction capability", async () => {
    const { db } = createDatabase();

    const result = await executeTransaction(db, adapter, normalizeDrizzleResult);

    expect(result.success).toBe(true);

    if (result.success) {
      expect(typeof result.value.query).toBe("function");
      expect(typeof result.value.commit).toBe("function");
      expect(typeof result.value.rollback).toBe("function");
    }
  });

  it("should execute queries within the transaction", async () => {
    const { db, trxExecute } = createDatabase([{ id: 1 }]);
    const created = await executeTransaction(db, adapter, normalizeDrizzleResult);

    if (!created.success) throw new Error("expected transaction");

    const query = await created.value.query<{ id: number }>({
      statement: "select * from t where id = ?",
      params: [1],
    });

    expect(query.success).toBe(true);

    if (query.success) {
      expect(query.value).toEqual({ rows: [{ id: 1 }], rowCount: 1 });
    }

    expect(trxExecute).toHaveBeenCalledTimes(1);

    await created.value.commit();
  });

  it("should commit the transaction", async () => {
    const { db } = createDatabase();
    const created = await executeTransaction(db, adapter, normalizeDrizzleResult);

    if (!created.success) throw new Error("expected transaction");

    const committed = await created.value.commit();

    expect(committed.success).toBe(true);

    if (committed.success) {
      expect(committed.value).toBeUndefined();
    }
  });

  it("should roll the transaction back", async () => {
    const { db } = createDatabase();
    const created = await executeTransaction(db, adapter, normalizeDrizzleResult);

    if (!created.success) throw new Error("expected transaction");

    const rolledBack = await created.value.rollback();

    expect(rolledBack.success).toBe(true);
  });

  it("should report a commit failure as transaction_failed", async () => {
    const commitError = new Error("Commit failed");
    const { db } = createDatabase([{ id: 1 }], commitError);
    const created = await executeTransaction(db, adapter, normalizeDrizzleResult);

    if (!created.success) throw new Error("expected transaction");

    const committed = await created.value.commit();

    expect(committed.success).toBe(false);

    if (!committed.success) {
      expect(committed.error.meta["reason"]).toBe("transaction_failed");
      expect(committed.error.cause).toBe(commitError);
    }
  });

  it("should map a transaction that cannot be started", async () => {
    const creationError = new Error("Transaction creation failed");
    const db = {
      execute: vi.fn(),
      transaction: vi.fn().mockImplementation(() => {
        throw creationError;
      }),
    };

    const result = await executeTransaction(db, adapter, normalizeDrizzleResult);

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.message).toBe("The SQL transaction failed");
      expect(result.error.cause).toBe(creationError);
    }
  });

  it("should return invalid_configuration when the database has no transaction()", async () => {
    const result = await executeTransaction({ execute: vi.fn() }, adapter, normalizeDrizzleResult);

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.meta["reason"]).toBe("invalid_configuration");
      expect(result.error.meta["details"]?.["operation"]).toBe("transaction");
    }
  });

  it("should support a SQLite-style transaction surface", async () => {
    const all = vi.fn().mockResolvedValue([{ id: 2 }]);
    const db = {
      all,
      transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
        await fn({ all });
      }),
    };

    const created = await executeTransaction(db, "sqlite", normalizeDrizzleResult);

    if (!created.success) throw new Error("expected transaction");

    const query = await created.value.query<{ id: number }>({ statement: "select 2" });

    expect(query.success).toBe(true);
    expect(all).toHaveBeenCalledTimes(1);

    await created.value.commit();
  });

  it("should wait for the transaction to start before resolving", async () => {
    const trxExecute = vi.fn().mockResolvedValue({ rows: [{ id: 5 }], rowCount: 1 });

    // Pooled drivers acquire a connection and run BEGIN before invoking the
    // callback, so the handle is assigned several ticks after db.transaction().
    const db = {
      execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
        await new Promise((resolve) => setTimeout(resolve, 5));

        return await fn({ execute: trxExecute });
      }),
    };

    const created = await executeTransaction(db, adapter, normalizeDrizzleResult);

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
    const db = {
      execute: vi.fn(),
      transaction: vi.fn().mockImplementation(async () => {
        await Promise.resolve();
        throw connectionError;
      }),
    };

    const result = await executeTransaction(db, adapter, normalizeDrizzleResult);

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.meta["reason"]).toBe("transaction_failed");
      expect(result.error.cause).toBe(connectionError);
    }
  });

  it("should report a transaction that resolves without starting", async () => {
    const db = {
      execute: vi.fn(),
      // Resolves without ever invoking the transaction callback.
      transaction: vi.fn().mockResolvedValue(undefined),
    };

    const result = await executeTransaction(db, adapter, normalizeDrizzleResult);

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.meta["reason"]).toBe("transaction_failed");
    }
  });

  it("should not surface an unhandled rejection when the capability is abandoned", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };

    process.on("unhandledRejection", onUnhandled);

    try {
      const db = {
        execute: vi.fn(),
        transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
          // Start the transaction, then fail while nobody observes it.
          void fn({ execute: async () => ({ rows: [] }) });
          await new Promise((resolve) => setTimeout(resolve, 5));

          throw new Error("connection lost");
        }),
      };

      const created = await executeTransaction(db, adapter, normalizeDrizzleResult);

      expect(created.success).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 30));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toEqual([]);
  });

  it("should reject a synchronous transaction function", async () => {
    const db = {
      execute: vi.fn(),
      transaction: vi.fn().mockReturnValue(undefined),
    };

    const result = await executeTransaction(db, "sqlite", normalizeDrizzleResult);

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.meta["reason"]).toBe("invalid_configuration");
      expect(result.error.meta["details"]?.["expected"]).toBe(
        "drizzle database with an asynchronous transaction()"
      );
      expect(result.error.meta["context"]?.["violation"]).toBe("synchronous_transaction");
    }
  });
});
