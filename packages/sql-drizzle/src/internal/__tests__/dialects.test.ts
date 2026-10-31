import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { PgDialect } from "drizzle-orm/pg-core";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";

import { bindParameters } from "../bind-parameters.js";

/**
 * Bind a statement and compile it with a real Drizzle dialect.
 *
 * @param statement - SQL text
 * @param params - Positional parameters
 * @param dialect - Drizzle dialect to compile with
 *
 * @returns The compiled statement text and parameters
 */
function compile(
  statement: string,
  params: readonly unknown[],
  dialect: { sqlToQuery(query: unknown): { sql: string; params: unknown[] } }
) {
  const bound = bindParameters(statement, params, "query", "test-adapter");

  if (!bound.success) {
    throw new Error(`binding failed: ${bound.error.code}`);
  }

  const compiled = dialect.sqlToQuery(bound.value);

  return { sql: compiled.sql, params: compiled.params };
}

describe("drizzle dialects", () => {
  it("emits PostgreSQL positional placeholders", () => {
    const dialect = new PgDialect();

    expect(compile("select * from t where a = ? and b = ?", [1, 2], dialect)).toEqual({
      sql: "select * from t where a = $1 and b = $2",
      params: [1, 2],
    });

    expect(compile("select * from t where a = $1", [1], dialect)).toEqual({
      sql: "select * from t where a = $1",
      params: [1],
    });
  });

  it("emits MySQL placeholders", () => {
    const dialect = new MySqlDialect();

    expect(compile("select * from t where a = ? and b = $2", [1, 2], dialect)).toEqual({
      sql: "select * from t where a = ? and b = ?",
      params: [1, 2],
    });
  });

  it("emits SQLite placeholders", () => {
    const dialect = new SQLiteSyncDialect();

    expect(compile("update t set a = ? where id = ?", ["a", 1], dialect)).toEqual({
      sql: "update t set a = ? where id = ?",
      params: ["a", 1],
    });
  });
});
