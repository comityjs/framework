import { describe, expect, it } from "vitest";

import { SqlError } from "@comity/sql/errors";
import { compileStatement } from "../../__tests__/compile-sql.js";
import { bindParameters } from "../bind-parameters.js";

/**
 * Bind parameters and compile the result with the given placeholder style.
 *
 * @param statement - SQL text
 * @param params - Positional parameters
 * @param style - Placeholder syntax to emit
 *
 * @returns The compiled statement
 */
function bind(
  statement: string,
  params: readonly unknown[],
  style: "dollar" | "question" = "dollar"
) {
  const result = bindParameters(statement, params, "query", "test-adapter");

  if (!result.success) {
    throw new Error(`binding failed: ${result.error.code}`);
  }

  return compileStatement(result.value, style);
}

/**
 * Bind parameters and return the failure.
 *
 * @param statement - SQL text
 * @param params - Positional parameters
 *
 * @returns The SqlError reason, violation, and operation, or `null` on success
 */
function bindFailure(statement: string, params: readonly unknown[]) {
  const result = bindParameters(statement, params, "query", "test-adapter");

  if (result.success) {
    return null;
  }

  expect(result.error).toBeInstanceOf(SqlError);

  return {
    reason: result.error.meta["reason"],
    violation: result.error.meta["context"]?.["violation"],
    operation: result.error.meta["details"]?.["operation"],
  };
}

describe("bindParameters", () => {
  it("binds question-mark placeholders in order", () => {
    const compiled = bind("select * from t where id = ? and name = ?", [1, "a"], "question");

    expect(compiled).toEqual({
      sql: "select * from t where id = ? and name = ?",
      params: [1, "a"],
    });
  });

  it("lets the dialect decide the placeholder syntax", () => {
    const compiled = bind("select * from t where id = ? and name = ?", [1, "a"], "dollar");

    expect(compiled).toEqual({
      sql: "select * from t where id = $1 and name = $2",
      params: [1, "a"],
    });
  });

  it("binds dollar placeholders, including a repeated index", () => {
    const compiled = bind("select * from t where a = $1 or b = $1", [5]);

    expect(compiled).toEqual({
      sql: "select * from t where a = $1 or b = $2",
      params: [5, 5],
    });
  });

  it("binds dollar placeholders out of order", () => {
    const compiled = bind("select * from t where a = $2 and b = $1", ["b", "a"]);

    expect(compiled).toEqual({
      sql: "select * from t where a = $1 and b = $2",
      params: ["a", "b"],
    });
  });

  it("ignores placeholders inside quoted strings and identifiers", () => {
    const compiled = bind(
      `select "we?ird" from t where a = ? and b = 'literal ? and $1'`,
      ["value"],
      "question"
    );

    expect(compiled).toEqual({
      sql: `select "we?ird" from t where a = ? and b = 'literal ? and $1'`,
      params: ["value"],
    });
  });

  it("ignores placeholders inside comments", () => {
    const compiled = bind(
      "select * from t -- where a = ?\n/* and b = ? */ where c = ?",
      [3],
      "question"
    );

    expect(compiled).toEqual({
      sql: "select * from t -- where a = ?\n/* and b = ? */ where c = ?",
      params: [3],
    });
  });

  it("keeps PostgreSQL hash operators intact", () => {
    const compiled = bind("select data #> '{a}' #>> '{b}' from t where id = $1", [1]);

    expect(compiled).toEqual({
      sql: "select data #> '{a}' #>> '{b}' from t where id = $1",
      params: [1],
    });
  });

  it("ignores placeholders inside dollar-quoted strings", () => {
    const compiled = bind("select $fn$ ? $1 $fn$ as body where id = $1", [7]);

    expect(compiled).toEqual({
      sql: "select $fn$ ? $1 $fn$ as body where id = $1",
      params: [7],
    });
  });

  it("keeps a backtick-quoted identifier intact", () => {
    const compiled = bind("select `we?ird` from t where a = ?", [1], "question");

    expect(compiled).toEqual({
      sql: "select `we?ird` from t where a = ?",
      params: [1],
    });
  });

  it("returns the statement unchanged when nothing is bound", () => {
    const compiled = bind("select 1", []);

    expect(compiled).toEqual({ sql: "select 1", params: [] });
  });

  it("rejects a parameter list with an unused parameter", () => {
    expect(bindFailure("select * from t where id = $1", [1, 2])).toEqual({
      reason: "invalid_query",
      violation: "parameter_count_mismatch",
      operation: "query",
    });
  });

  it("rejects a placeholder with no parameter", () => {
    expect(bindFailure("select * from t where id = ?", [])).toEqual({
      reason: "invalid_query",
      violation: "parameter_count_mismatch",
      operation: "query",
    });
  });

  it("rejects a dollar index outside the parameter list", () => {
    expect(bindFailure("select * from t where id = $2", [1])).toEqual({
      reason: "invalid_query",
      violation: "invalid_parameter_index",
      operation: "query",
    });
  });

  it("rejects a zero dollar index", () => {
    expect(bindFailure("select * from t where id = $0", [1])).toEqual({
      reason: "invalid_query",
      violation: "invalid_parameter_index",
      operation: "query",
    });
  });
});
