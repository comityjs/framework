import { describe, expect, it } from "vitest";
import { SearchError } from "../error.js";

describe("SearchError", () => {
  it("should expose reason-based code, message, and http status", () => {
    const error = new SearchError("invalid_criteria");

    expect(error.code).toBe("search:invalid_criteria");
    expect(error.message).toBe("Invalid search criteria");
    expect(error.meta.httpStatus).toBe(400);
    expect(error.meta.reason).toBe("invalid_criteria");
  });

  it("should expose port metadata in details", () => {
    const error = new SearchError("transport_error", {
      details: { port: "@comity/catalog:product-search" },
    });

    expect(error.meta.details).toEqual({
      port: "@comity/catalog:product-search",
    });
  });

  it("should map index_unavailable to 503", () => {
    const error = new SearchError("index_unavailable");
    expect(error.meta.httpStatus).toBe(503);
  });

  it("should be an instance of BaseError", () => {
    const error = new SearchError("unknown");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("SearchError");
  });
});