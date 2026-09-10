import type { RepositoryError } from "@comity/primitives/errors";
import type { Result } from "@comity/primitives/result";
import type { BlockModel } from "./block.js";
import type { ContentRepositoryContext } from "./repository-context.js";

/**
 * Block repository contract.
 *
 * Search-shaped retrieval is intentionally NOT part of this contract.
 * Block search is consumed via `@comity/search`'s
 * `SearchPort<T extends BlockModel>` at the application/composition
 * layer, not on the domain repository.
 */
export interface BlockRepository {
  /**
   * Retrieve a block by identifier.
   *
   * @param id - Block ID.
   * @param ctx - Context for the repository request, including fields selection, locale, currency, and tenant information.
   *
   * @returns Block model or null if not found.
   */
  getById<T extends BlockModel = BlockModel>(
    id: string,
    ctx?: ContentRepositoryContext
  ): Promise<Result<T | null, RepositoryError>>;

  /**
   * Retrieve a block by URL slug.
   *
   * @param slug - URL-friendly slug.
   * @param ctx - Context for the repository request, including fields selection, locale, currency, and tenant information.
   *
   * @returns Block model or null if not found.
   */
  getBySlug<T extends BlockModel = BlockModel>(
    slug: string,
    ctx?: ContentRepositoryContext
  ): Promise<Result<T | null, RepositoryError>>;
}
