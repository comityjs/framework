import { describe, expect, it } from "vitest";
import { failure, success } from "@comity/primitives/result";
import type { SearchCriteriaModel } from "../criteria.js";
import { SearchError } from "../error.js";
import type { SearchPort } from "../port.js";
import type { SearchResultModel } from "../result.js";

interface Projection {
  readonly id: string;
  readonly name: string;
}

const result: SearchResultModel<Projection> = {
  items: [{ id: "p-1", name: "T-Shirt" }],
  total: 1,
  page: 1,
  pageSize: 20,
};

describe("SearchPort<TProjection>", () => {
  it("should accept a generic projection type at the type level", async () => {
    const port: SearchPort<Projection> = {
      async search(_criteria: SearchCriteriaModel) {
        return success(result);
      },
    };

    const out = await port.search({ query: "shirt" });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.value.items[0]?.id).toBe("p-1");
    }
  });

  it("should return SearchError on failure without raw exceptions", async () => {
    const port: SearchPort<Projection> = {
      async search(_criteria: SearchCriteriaModel) {
        return failure(new SearchError("index_unavailable"));
      },
    };

    const out = await port.search({ query: "shirt" });
    expect(out.success).toBe(false);
    if (!out.success) {
      expect(out.error).toBeInstanceOf(SearchError);
      expect(out.error.code).toBe("search:index_unavailable");
    }
  });
});