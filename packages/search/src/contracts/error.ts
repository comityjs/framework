import type { ErrorMeta } from "@comity/primitives/errors";

import { BaseError } from "@comity/primitives/errors";

/**
 * Stable search error reasons.
 */
export type SearchErrorReason =
  | "invalid_criteria"
  | "unsupported_query"
  | "index_unavailable"
  | "transport_error"
  | "timeout"
  | "unknown";

/**
 * Metadata attached to search errors.
 */
export interface SearchErrorMeta extends ErrorMeta {
  /** Error reason. */
  readonly reason: SearchErrorReason;

  /** Optional diagnostic details. */
  readonly details?: Readonly<{
    /** Originating search port name (e.g., `@comity/catalog:product-search`). */
    readonly port?: string;
  }>;
}

/**
 * Human-friendly messages mapped by reason.
 */
export const SEARCH_ERROR_MESSAGES: Record<SearchErrorReason, string> = {
  invalid_criteria: "Invalid search criteria",
  unsupported_query: "Unsupported search query",
  index_unavailable: "Search index unavailable",
  transport_error: "Search transport error",
  timeout: "Search timed out",
  unknown: "Unknown search error",
};

/**
 * Default HTTP status mapped by reason.
 */
export const SEARCH_ERROR_HTTP_STATUS: Record<SearchErrorReason, number> = {
  invalid_criteria: 400,
  unsupported_query: 422,
  index_unavailable: 503,
  transport_error: 502,
  timeout: 504,
  unknown: 500,
};

/**
 * Search port error.
 *
 * Owned by `@comity/search`. Used by `SearchPort<TProjection>`
 * implementations to surface typed failures without leaking raw
 * exceptions across the contract boundary.
 */
export class SearchError extends BaseError<SearchErrorMeta> {
  /** Namespaced error code. */
  readonly code: `search:${SearchErrorReason}`;

  /**
   * @param reason - The reason for the search error.
   * @param meta - Additional metadata for the error.
   */
  constructor(reason: SearchErrorReason, meta?: Omit<SearchErrorMeta, "reason">) {
    super(SEARCH_ERROR_MESSAGES[reason], {
      httpStatus: SEARCH_ERROR_HTTP_STATUS[reason],
      ...meta,
      reason,
    });

    this.code = `search:${reason}`;
  }
}