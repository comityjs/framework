/**
 * Options for content repository requests, including fields selection, locale, and tenant information.
 */
export interface ContentRepositoryContext<T = unknown> {
  /** Fields to include in the response. */
  readonly fields?: T;

  /** Locale for the request. */
  readonly locale?: string;

  /** Optional tenant ID to fetch content data for a specific tenant. */
  readonly tenant?: string;
}
