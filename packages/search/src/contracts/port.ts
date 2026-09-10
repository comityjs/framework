import type { Result } from "@comity/primitives/result";

import type { SearchCriteriaModel } from "./criteria.js";
import type { SearchError } from "./error.js";
import type { SearchResultModel } from "./result.js";

/**
 * Generic search port.
 *
 * Owned by `@comity/search`. Implementations live in adapter or
 * application-layer packages; the port itself is projection-agnostic.
 *
 * The projection type `TProjection` is owned by the consuming
 * domain module (e.g., `ProductProjection` from `@comity/catalog`).
 * Search never imports a domain module; the projection flows in
 * through the generic.
 *
 * @typeParam TProjection - The domain projection returned in search results.
 */
export interface SearchPort<TProjection> {
  /**
   * Execute a search query against the underlying index and return
   * paginated projections matching the criteria.
   *
   * @param criteria - Search criteria (query text, filters, sort, pagination).
   *
   * @returns A `Result` wrapping either the search result envelope
   * or a `SearchError`. Raw exceptions MUST NOT leak across this
   * boundary; failures are surfaced as `SearchError` instances.
   */
  search(criteria: SearchCriteriaModel): Promise<Result<SearchResultModel<TProjection>, SearchError>>;
}