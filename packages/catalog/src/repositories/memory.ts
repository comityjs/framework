import type { RepositoryError } from "@comity/primitives/errors";
import type { Result } from "@comity/primitives/result";
import type { CatalogRepositoryContext } from "../contracts/repository-context.js";
import type { ProductProjection } from "../contracts/product.js";
import type { ProductRepository } from "../contracts/product-repository.js";

import { success } from "@comity/primitives/result";

/**
 * In-memory implementation of `ProductRepository` for testing and development purposes.
 *
 * Note: This implementation is not suitable for production use as it does not persist
 * products and is not shared across multiple instances of the application.
 *
 * Search-shaped retrieval is intentionally NOT implemented here.
 * Product search is provided via `@comity/search`'s
 * `SearchPort<ProductProjection>` at the application/composition layer.
 */
export class MemoryProductRepository implements ProductRepository {
  /** */
  #products = new Map<string, ProductProjection>();

  /**
   * @inheritdoc
   */
  async getById(
    id: string,
    _ctx?: CatalogRepositoryContext
  ): Promise<Result<ProductProjection | null, RepositoryError>> {
    const product = this.#products.get(id);

    if (!product) {
      return success(null);
    }

    return success(product);
  }

  /**
   * @inheritdoc
   */
  async getBySlug(
    slug: string,
    _ctx?: CatalogRepositoryContext
  ): Promise<Result<ProductProjection | null, RepositoryError>> {
    const product = [...this.#products.values()].find((p) => p.slug === slug);

    if (!product) {
      return success(null);
    }

    return success(product);
  }

  /**
   * Adds a product to the in-memory store for testing.
   * Not part of the ProductRepository contract.
   */
  add(product: ProductProjection): void {
    this.#products.set(product.id, product);
  }

  /**
   * Clears all products from the in-memory store.
   * Not part of the ProductRepository contract.
   */
  clear(): void {
    this.#products.clear();
  }
}