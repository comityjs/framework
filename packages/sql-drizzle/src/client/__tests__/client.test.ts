import { describe, expect, it } from "vitest";

import { SqlError } from "@comity/sql/errors";
import { createDrizzleSqlClient } from "../create-drizzle.js";

type Row = { id: number; name?: string };

/**
 * Drizzle stand-in for PostgreSQL and MySQL databases.
 */
class FakeDrizzle {
  constructor(private readonly rows: Row[]) {}

  async execute(_query: unknown) {
    return { rows: this.rows, rowCount: this.rows.length };
  }

  async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    return await fn({ execute: async () => ({ rows: this.rows }) });
  }
}

/**
 * Drizzle stand-in for SQLite databases, which expose `all()` instead of
 * `execute()`.
 */
class FakeSqliteDrizzle {
  constructor(private readonly rows: Row[]) {}

  async all(_query: unknown) {
    return this.rows;
  }

  async transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    return await fn({ all: async () => this.rows });
  }
}

describe("@comity/sql-drizzle", () => {
  it("returns success for a simple query with rowCount fallback", async () => {
    const sql = createDrizzleSqlClient({ db: new FakeDrizzle([{ id: 1 }]), adapter: "postgres" });

    const res = await sql.query<Row>({ statement: "select 1", params: [] });

    expect(res.success).toBe(true);

    if (res.success) {
      expect(res.value.rows).toEqual([{ id: 1 }]);
      expect(res.value.rowCount).toBe(1);
    }
  });

  it("supports a SQLite database surface", async () => {
    const sql = createDrizzleSqlClient({
      db: new FakeSqliteDrizzle([{ id: 2 }]),
      adapter: "sqlite",
    });

    const res = await sql.query<Row>({ statement: "select 2" });

    expect(res.success).toBe(true);

    if (res.success) {
      expect(res.value.rows).toEqual([{ id: 2 }]);
      expect(res.value.rowCount).toBe(1);
    }
  });

  it("fails for named parameters", async () => {
    const sql = createDrizzleSqlClient({ db: new FakeDrizzle([]), adapter: "postgres" });

    const res = await sql.query<Row>({ statement: "select 1", params: { id: 1 } as never });

    expect(res.success).toBe(false);

    if (!res.success) {
      expect(res.error.meta["reason"]).toBe("invalid_query");
    }
  });

  it("supports transaction commit", async () => {
    const sql = createDrizzleSqlClient({ db: new FakeDrizzle([{ id: 2 }]), adapter: "postgres" });
    const txRes = await sql.begin();

    expect(txRes.success).toBe(true);

    if (txRes.success) {
      const qRes = await txRes.value.query<Row>({ statement: "select 2", params: [] });

      expect(qRes.success).toBe(true);

      const commitRes = await txRes.value.commit();

      expect(commitRes.success).toBe(true);
    }
  });

  it("applies a composed result normalizer", async () => {
    const sql = createDrizzleSqlClient({
      db: new FakeDrizzle([{ id: 3 }]),
      adapter: "postgres",
      normalizeResult: () => ({ rows: [{ id: 99 }], rowCount: 42 }),
    });

    const res = await sql.query<Row>({ statement: "select 3" });

    expect(res.success).toBe(true);

    if (res.success) {
      expect(res.value).toEqual({ rows: [{ id: 99 }], rowCount: 42 });
    }
  });

  it("reports invalid_configuration when the executor is missing", async () => {
    const sql = createDrizzleSqlClient({ db: new FakeDrizzle([]), adapter: "postgres" });

    const res = await sql.atomicBatch([{ statement: "select 1", params: [] }]);

    expect(res.success).toBe(false);

    if (!res.success) {
      expect(res.error.meta["reason"]).toBe("invalid_configuration");
    }
  });

  it("rejects a client with no execution surface", () => {
    expect(() =>
      createDrizzleSqlClient({
        db: { transaction: async () => undefined },
        adapter: "postgres",
      })
    ).toThrowError(SqlError);
  });

  it("rejects a client with no transaction surface", () => {
    expect(() =>
      createDrizzleSqlClient({
        db: { execute: async () => ({ rows: [] }) },
        adapter: "postgres",
      })
    ).toThrowError(SqlError);
  });
});
