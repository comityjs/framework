import type { RepositoryError } from "@comity/primitives/errors";
import type { Result } from "@comity/primitives/result";

import type { ProductProjection } from "./product.js";
import type { CatalogRepositoryContext } from "./repository-context.js";

/**
 * Product repository contract.
 *
 * A read-projection port: exposes only read operations and returns stable,
 * immutable projection models. Mutations live in the application layer.
 *
 * Search-shaped retrieval is intentionally NOT part of this contract.
 * Product search is consumed via `@comity/search`'s
 * `SearchPort<ProductProjection>` at the application/composition layer,
 * not on the domain repository.
 */
export interface ProductRepository {
  /**
   * Retrieve a product by identifier.
   *
   * @param id - Product ID.
   * @param ctx - Context for the repository request, including fields selection, locale, and tenant information.
   *
   * @returns Product model or null if not found.
   */
  getById(
    id: string,
    ctx?: CatalogRepositoryContext
  ): Promise<Result<ProductProjection | null, RepositoryError>>;

  /**
   * Retrieve a product by URL slug.
   *
   * @param slug - URL-friendly slug.
   * @param ctx - Context for the repository request, including fields selection, locale, and tenant information.
   *
   * @returns Product model or null if not found.
   */
  getBySlug(
    slug: string,
    ctx?: CatalogRepositoryContext
  ): Promise<Result<ProductProjection | null, RepositoryError>>;
}