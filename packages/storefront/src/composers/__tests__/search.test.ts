import type { ProductProjection } from "@comity/catalog";
import type { SearchPort } from "@comity/search";
import type { SearchError } from "@comity/search/errors";
import type { SearchResultModel } from "@comity/search";
import type { SearchPageEnricher } from "../contracts/search-page.js";

import { describe, expect, it, vi } from "vitest";
import { failure, success } from "@comity/primitives/result";
import { DefaultSearchPageComposer } from "../search.js";
import { SearchError as SearchErrorClass } from "@comity/search/errors";

const ctx = { locale: "en-US" };

const result: SearchResultModel<ProductProjection> = {
  items: [{ id: "p-1", name: "T-Shirt", status: "active", variants: [] }],
  total: 1,
  page: 1,
  pageSize: 20,
};

function makePort(
  response: Awaited<ReturnType<SearchPort<ProductProjection>["search"]>>
): SearchPort<ProductProjection> {
  return { search: vi.fn().mockResolvedValue(response) };
}

describe("DefaultSearchPageComposer", () => {
  it("should compose a search page from the search port result", async () => {
    const port = makePort(success(result));
    const composer = new DefaultSearchPageComposer(port);

    const composed = await composer.compose("t-shirt", ctx);

    expect(port.search).toHaveBeenCalledWith({ query: "t-shirt" });
    expect(composed.success).toBe(true);
    if (composed.success) {
      expect(composed.value).toMatchObject({
        type: "search",
        id: "search",
        url: "/search?q=t-shirt",
        title: "Search: t-shirt",
        query: "t-shirt",
        result,
      });
    }
  });

  it("should build the search url with encoding", async () => {
    const port = makePort(success(result));
    const composer = new DefaultSearchPageComposer(port);

    const composed = await composer.compose("blue shirt", ctx);

    expect(composed.success).toBe(true);
    if (composed.success) {
      expect(composed.value.url).toBe("/search?q=blue%20shirt");
    }
  });

  it("should use a default title for an empty query", async () => {
    const port = makePort(success(result));
    const composer = new DefaultSearchPageComposer(port);

    const composed = await composer.compose("", ctx);

    expect(composed.success).toBe(true);
    if (composed.success) {
      expect(composed.value.title).toBe("Search");
      expect(composed.value.url).toBe("/search?q=");
    }
  });

  it("should propagate a search port failure as SearchError", async () => {
    const error = new SearchErrorClass("index_unavailable");
    const port = makePort(failure(error));
    const composer = new DefaultSearchPageComposer(port);

    const composed = await composer.compose("t-shirt", ctx);

    expect(composed.success).toBe(false);
    if (!composed.success) {
      expect(composed.error).toBe(error);
      expect(composed.error.code).toBe("search:index_unavailable");
    }
  });

  it("should apply enrichers and keep their result", async () => {
    const port = makePort(success(result));
    const enrichers: SearchPageEnricher[] = [
      {
        enrich: vi.fn().mockImplementation(async (page) =>
          success({ ...page, breadcrumbs: [{ label: "Search", url: "/search" }] })
        ),
      },
    ];
    const composer = new DefaultSearchPageComposer(port, enrichers);

    const composed = await composer.compose("t-shirt", ctx);

    expect(composed.success).toBe(true);
    if (composed.success) {
      expect(composed.value.breadcrumbs).toEqual([{ label: "Search", url: "/search" }]);
    }
  });

  it("should ignore enrichers that return a failure", async () => {
    const port = makePort(success(result));
    const failingEnricher: SearchPageEnricher = {
      enrich: vi.fn().mockResolvedValue({ success: false, error: new Error("enrich") }),
    };
    const composer = new DefaultSearchPageComposer(port, [failingEnricher]);

    const composed = await composer.compose("t-shirt", ctx);

    expect(composed.success).toBe(true);
    if (composed.success) {
      expect(composed.value).toMatchObject({ query: "t-shirt", title: "Search: t-shirt" });
    }
  });

  it("does not require a ProductRepository to compose a search page", () => {
    // Phase 15 — the composer depends on `SearchPort<ProductProjection>`,
    // never on `ProductRepository`. Constructing it without a repository
    // must succeed (no implicit dependency injection on the catalog).
    const port = makePort(success(result));
    expect(() => new DefaultSearchPageComposer(port)).not.toThrow();
  });

  it("returns SearchError without raw exception leakage", async () => {
    // Phase 15 — failures surface as `SearchError`, not raw exceptions.
    const rawError: SearchError = new SearchErrorClass("transport_error");
    const port: SearchPort<ProductProjection> = {
      search: vi.fn().mockResolvedValue(failure(rawError)),
    };
    const composer = new DefaultSearchPageComposer(port);

    const composed = await composer.compose("x", ctx);
    expect(composed.success).toBe(false);
    if (!composed.success) {
      expect(composed.error).toBeInstanceOf(SearchErrorClass);
      expect((composed.error as Error).name).toBe("SearchError");
    }
  });
});