import { describe, expect, it } from "vitest";

import { normalizeDrizzleResult } from "../normalize-result.js";

describe("normalizeDrizzleResult", () => {
  it("reads a node-postgres result object", () => {
    expect(normalizeDrizzleResult({ rows: [{ id: 1 }], rowCount: 1 })).toEqual({
      rows: [{ id: 1 }],
      rowCount: 1,
    });
  });

  it("keeps a zero affected-row count", () => {
    expect(normalizeDrizzleResult({ rows: [], rowCount: 0 })).toEqual({ rows: [], rowCount: 0 });
  });

  it("falls back to the row count when the driver reports null", () => {
    expect(normalizeDrizzleResult({ rows: [{ id: 1 }, { id: 2 }], rowCount: null })).toEqual({
      rows: [{ id: 1 }, { id: 2 }],
      rowCount: 2,
    });
  });

  it("reads a postgres-js rows array", () => {
    expect(normalizeDrizzleResult([{ id: 1 }])).toEqual({ rows: [{ id: 1 }], rowCount: 1 });
  });

  it("reads a mysql2 result set", () => {
    const raw = [[{ id: 1 }], [{ name: "id", columnType: 3 }]];

    expect(normalizeDrizzleResult(raw)).toEqual({ rows: [{ id: 1 }], rowCount: 1 });
  });

  it("reads a mysql2 mutation header", () => {
    const raw = [{ affectedRows: 3, insertId: 0 }, [{ name: "id", columnType: 3 }]];

    expect(normalizeDrizzleResult(raw)).toEqual({ rows: [], rowCount: 3 });
  });

  it("does not mistake a two-row result for a mysql2 tuple", () => {
    const raw = [[{ id: 1 }], [{ name: "x" }]];

    expect(normalizeDrizzleResult(raw)).toEqual({
      rows: [[{ id: 1 }], [{ name: "x" }]],
      rowCount: 2,
    });
  });

  it("reads a libsql result set, keeping a zero affected count", () => {
    expect(normalizeDrizzleResult({ rows: [{ id: 1 }], rowsAffected: 0 })).toEqual({
      rows: [{ id: 1 }],
      rowCount: 0,
    });
  });

  it("reads a D1 result, preferring the meta change count", () => {
    expect(normalizeDrizzleResult({ results: [{ id: 1 }], meta: { changes: 2 } })).toEqual({
      rows: [{ id: 1 }],
      rowCount: 2,
    });
  });

  it("reads a SQLite run result", () => {
    expect(normalizeDrizzleResult({ changes: 4, lastInsertRowid: 9 })).toEqual({
      rows: [],
      rowCount: 4,
    });
  });

  it("reads a bigint affected-row count", () => {
    expect(normalizeDrizzleResult({ rows: [], numAffectedRows: 2n })).toEqual({
      rows: [],
      rowCount: 2,
    });
  });

  it("returns no rows for a driver that resolves with nothing", () => {
    expect(normalizeDrizzleResult(undefined)).toEqual({ rows: [] });
    expect(normalizeDrizzleResult(null)).toEqual({ rows: [] });
  });

  it("returns no rows for an unrecognised shape", () => {
    expect(normalizeDrizzleResult("ok")).toEqual({ rows: [] });
  });
});
