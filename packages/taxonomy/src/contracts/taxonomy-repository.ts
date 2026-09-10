import type { RepositoryError } from "@comity/primitives/errors";
import type { Result } from "@comity/primitives/result";
import type { TaxonomyRepositoryContext } from "./repository-context.js";
import type { TaxonomyModel } from "./taxonomy.js";

/**
 * Taxonomy repository contract.
 *
 * Search-shaped retrieval is intentionally NOT part of this contract.
 * Taxonomy search is consumed via `@comity/search`'s
 * `SearchPort<TaxonomyModel>` at the application/composition layer,
 * not on the domain repository.
 */
export interface TaxonomyRepository {
  /**
   * Retrieve a taxonomy item by identifier.
   *
   * @param id - Taxonomy ID.
   * @param ctx - Context for the repository request, including fields selection, locale, and tenant information.
   *
   * @returns Taxonomy model or null if not found.
   */
  getById(
    id: string,
    ctx?: TaxonomyRepositoryContext
  ): Promise<Result<TaxonomyModel | null, RepositoryError>>;

  /**
   * Retrieve a taxonomy item by URL slug.
   *
   * @param slug - URL-friendly slug.
   * @param ctx - Context for the repository request, including fields selection, locale, and tenant information.
   *
   * @returns Taxonomy model or null if not found.
   */
  getBySlug(
    slug: string,
    ctx?: TaxonomyRepositoryContext
  ): Promise<Result<TaxonomyModel | null, RepositoryError>>;
}