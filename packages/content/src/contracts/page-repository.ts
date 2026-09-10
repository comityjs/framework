import type { RepositoryError } from "@comity/primitives/errors";
import type { Result } from "@comity/primitives/result";
import type { PageModel } from "./page.js";
import type { ContentRepositoryContext } from "./repository-context.js";

/**
 * Page repository contract.
 *
 * Search-shaped retrieval is intentionally NOT part of this contract.
 * Page search is consumed via `@comity/search`'s
 * `SearchPort<PageModel>` at the application/composition layer, not on
 * the domain repository.
 */
export interface PageRepository {
  /**
   * Retrieve a page by identifier.
   *
   * @param id - Page ID.
   * @param ctx - Context for the repository request, including fields selection, locale, currency, and tenant information.
   *
   * @returns Page model or null if not found.
   */
  getById(
    id: string,
    ctx?: ContentRepositoryContext
  ): Promise<Result<PageModel | null, RepositoryError>>;

  /**
   * Retrieve a page by URL slug.
   *
   * @param slug - URL-friendly slug.
   * @param ctx - Context for the repository request, including fields selection, locale, currency, and tenant information.
   *
   * @returns Page model or null if not found.
   */
  getBySlug(
    slug: string,
    ctx?: ContentRepositoryContext
  ): Promise<Result<PageModel | null, RepositoryError>>;
}
