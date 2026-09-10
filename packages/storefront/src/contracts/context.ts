/**
 * Storefront context
 */
export interface StorefrontContext {
  /** Locale for the request. */
  readonly locale?: string;

  /** Currency for the request. */
  readonly currency?: string;

  /** Optional tenant ID to fetch catalog data for a specific tenant. */
  readonly tenant?: string;
}

/**
 * Transport-neutral request input used to resolve the storefront context.
 */
export interface StorefrontContextInput {
  /** Request URL. */
  readonly url: URL;

  /** Request headers. */
  readonly headers: Readonly<Record<string, string>>;

  /** Request cookies. */
  readonly cookies: Readonly<Record<string, string>>;
}

/**
 * Resolves the storefront context for incoming requests, including locale, currency, and tenant information.
 */
export interface StorefrontContextResolver {
  /** Resolves the storefront context for the given request input. */
  resolve(input: StorefrontContextInput): Promise<StorefrontContext>;
}
