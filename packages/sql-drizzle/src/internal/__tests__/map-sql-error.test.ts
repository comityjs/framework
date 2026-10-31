import { describe, expect, it } from "vitest";

import { SqlError } from "@comity/sql/errors";
import { mapSqlError, unwrapDrizzleError } from "../map-sql-error.js";

/**
 * Build the wrapper Drizzle raises around a driver failure.
 *
 * @param cause - Driver failure
 *
 * @returns An error shaped like `DrizzleQueryError`
 */
function drizzleQueryError(cause: unknown) {
  return Object.assign(new Error("Failed query: select * from t\nparams: 1"), {
    query: "select * from t",
    params: [1],
    cause,
  });
}

describe("mapSqlError", () => {
  it("should map AbortError to cancelled", () => {
    const cause = new DOMException("Aborted", "AbortError");

    const error = mapSqlError(cause, "query", "postgres");

    expect(error).toBeInstanceOf(SqlError);
    expect(error.meta.reason).toBe("cancelled");
    expect(error.meta.details?.retriable).toBe(true);
    expect(error.cause).toBe(cause);
  });

  it("should map postgres 57014 to cancelled", () => {
    const error = mapSqlError({ code: "57014" }, "query", "postgres");

    expect(error.meta.reason).toBe("cancelled");
    expect(error.meta.details?.retriable).toBe(true);
    expect(error.meta.context).toEqual({ originalCode: "57014" });
  });

  it("should map postgres 42601 to invalid_query", () => {
    const error = mapSqlError({ code: "42601" }, "query", "postgres");

    expect(error.meta.reason).toBe("invalid_query");
    expect(error.meta.details?.retriable).toBe(false);
  });

  it("should map postgres 08006 to connection_failed", () => {
    const error = mapSqlError({ code: "08006" }, "query", "postgres");

    expect(error.meta.reason).toBe("connection_failed");
    expect(error.meta.details?.retriable).toBe(true);
  });

  it("should map postgres 42883 to invalid_query", () => {
    const error = mapSqlError({ code: "42883" }, "query", "postgres");

    expect(error.meta.reason).toBe("invalid_query");
  });

  it("should map mysql 1317 to cancelled", () => {
    const error = mapSqlError({ code: "1317" }, "query", "mysql");

    expect(error.meta.reason).toBe("cancelled");
    expect(error.meta.details?.retriable).toBe(true);
  });

  it("should map mysql 1064 to invalid_query", () => {
    const error = mapSqlError({ code: "1064" }, "query", "mysql");

    expect(error.meta.reason).toBe("invalid_query");
    expect(error.meta.details?.retriable).toBe(false);
  });

  it("should map sqlite constraint codes, including extended codes", () => {
    expect(mapSqlError({ code: "SQLITE_BUSY" }, "query", "sqlite").meta.details?.retriable).toBe(
      true
    );

    const extended = mapSqlError({ code: "SQLITE_CONSTRAINT_UNIQUE" }, "query", "sqlite");

    expect(extended.meta.reason).toBe("query_failed");
    expect(extended.meta.details?.retriable).toBe(false);
    expect(extended.meta.context).toEqual({ originalCode: "SQLITE_CONSTRAINT_UNIQUE" });
  });

  it("should fall back to query_failed for unknown errors during a query", () => {
    const cause = new Error("boom");

    const error = mapSqlError(cause, "query", "postgres");

    expect(error.meta.reason).toBe("query_failed");
    expect(error.meta.details?.retriable).toBe(false);
    expect(error.cause).toBe(cause);
  });

  it("should fall back to transaction_failed for unknown errors during a transaction", () => {
    const cause = new Error("boom");

    const error = mapSqlError(cause, "transaction", "postgres");

    expect(error.meta.reason).toBe("transaction_failed");
    expect(error.meta.details?.operation).toBe("transaction");
    expect(error.meta.details?.retriable).toBe(false);
  });

  it("should fall back to query_failed for unknown adapters", () => {
    const error = mapSqlError({ code: "57014" }, "query", "unknown-adapter");

    expect(error.meta.reason).toBe("query_failed");
  });

  it("should ignore non-string error codes", () => {
    const error = mapSqlError({ code: 57014 }, "query", "postgres");

    expect(error.meta.reason).toBe("query_failed");
  });

  it("should ignore unmapped driver codes", () => {
    const error = mapSqlError({ code: "99999" }, "query", "postgres");

    expect(error.meta.reason).toBe("query_failed");
  });

  it("should fall back to query_failed for null causes", () => {
    const error = mapSqlError(null, "query", "postgres");

    expect(error.meta.reason).toBe("query_failed");
  });

  it("should map connect operations with the operation preserved", () => {
    const cause = { code: "08006" };

    const error = mapSqlError(cause, "connect", "postgres");

    expect(error.meta.reason).toBe("connection_failed");
    expect(error.meta.details?.operation).toBe("connect");
  });
});

describe("unwrapDrizzleError", () => {
  it("unwraps the driver error Drizzle wraps", () => {
    const driverError = Object.assign(new Error("syntax error"), { code: "42601" });
    const wrapper = drizzleQueryError(driverError);

    expect(unwrapDrizzleError(wrapper)).toBe(driverError);
  });

  it("maps the wrapped driver code and keeps the SQL text out of the error", () => {
    const driverError = Object.assign(new Error("syntax error"), { code: "42601" });

    const error = mapSqlError(drizzleQueryError(driverError), "query", "postgres");

    expect(error.meta.reason).toBe("invalid_query");
    expect(error.cause).toBe(driverError);
    expect(error.message).not.toContain("select * from t");
  });

  it("returns the input unchanged when there is nothing to unwrap", () => {
    const error = new Error("boom");

    expect(unwrapDrizzleError(error)).toBe(error);
    expect(unwrapDrizzleError("boom")).toBe("boom");
  });
});
