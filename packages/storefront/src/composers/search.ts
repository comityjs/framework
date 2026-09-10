import type { ProductProjection } from "@comity/catalog";
import type { SearchPort } from "@comity/search";
import type { SearchError } from "@comity/search/errors";
import { isSuccess, success, type Result } from "@comity/primitives/result";
import type { StorefrontContext } from "../contracts/context.js";
import type {
    SearchPageComposer,
    SearchPageEnricher,
    SearchPageModel,
} from "../contracts/search-page.js";

/**
 * Default implementation of the SearchPageComposer interface.
 *
 * Phase 15 — product search is consumed via the search-owned
 * `SearchPort<ProductProjection>` port, NOT via `ProductRepository.search`.
 * The storefront composition layer is the only place that wires a
 * `ProductRepository` together with a `SearchPort<ProductProjection>`.
 */
export class DefaultSearchPageComposer implements SearchPageComposer {
  /** Product search port. */
  #search: SearchPort<ProductProjection>;

  /** Page enrichers. */
  #enrichers: ReadonlyArray<SearchPageEnricher>;

  /**
   * @param search - Search port used to execute product search queries.
   * @param enrichers - Optional enrichers to apply after base composition.
   */
  constructor(search: SearchPort<ProductProjection>, enrichers?: ReadonlyArray<SearchPageEnricher>) {
    this.#search = search;
    this.#enrichers = enrichers ?? [];
  }

  /**
   * @inheritdoc
   */
  async compose(
    query: string,
    ctx: StorefrontContext
  ): Promise<Result<SearchPageModel, SearchError>> {
    const result = await this.#search.search({ query });

    if (isSuccess(result)) {
      let page: SearchPageModel = {
        type: "search",
        id: "search",
        url: `/search?q=${encodeURIComponent(query)}`,
        title: query ? `Search: ${query}` : "Search",
        query,
        result: result.value,
      };

      for (const enricher of this.#enrichers) {
        const enriched = await enricher.enrich(page, ctx);

        if (isSuccess(enriched)) {
          page = enriched.value;
        }
      }

      return success(page);
    }

    return result;
  }
}
