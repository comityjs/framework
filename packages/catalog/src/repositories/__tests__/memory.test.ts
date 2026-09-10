import { beforeEach, describe, expect, it } from "vitest";
import { MemoryProductRepository } from "../memory.js";
import type { ProductProjection } from "../../contracts/product.js";

let productIdCounter = 0;

function makeProduct(overrides: Partial<ProductProjection> = {}): ProductProjection {
  return {
    id: `prod-${++productIdCounter}`,
    name: "Test Product",
    slug: "test-product",
    status: "active",
    ...overrides,
  };
}

describe("MemoryProductRepository", () => {
  let repository: MemoryProductRepository;

  beforeEach(() => {
    repository = new MemoryProductRepository();
  });

  it("returns null when no product exists", async () => {
    const result = await repository.getById("missing");

    expect(result).toEqual({ success: true, value: null });
  });

  it("returns a product saved by id", async () => {
    const product = makeProduct({ id: "prod-1", name: "Test Product" });
    repository.add(product);

    const result = await repository.getById("prod-1");

    expect(result.success).toBe(true);
    expect(result.value?.id).toBe("prod-1");
    expect(result.value?.name).toBe("Test Product");
  });

  it("returns null for a different id", async () => {
    repository.add(makeProduct({ id: "prod-1" }));

    const result = await repository.getById("prod-2");

    expect(result).toEqual({ success: true, value: null });
  });

  it("returns a product by slug", async () => {
    const product = makeProduct({ slug: "test-product" });
    repository.add(product);

    const result = await repository.getBySlug("test-product");

    expect(result.success).toBe(true);
    expect(result.value?.slug).toBe("test-product");
  });

  it("returns null for a different slug", async () => {
    repository.add(makeProduct({ slug: "test-product" }));

    const result = await repository.getBySlug("other-product");

    expect(result).toEqual({ success: true, value: null });
  });

  it("add and clear utility methods work", async () => {
    repository.add(makeProduct({ id: "prod-1" }));
    expect((await repository.getById("prod-1")).value).not.toBeNull();

    repository.clear();
    expect((await repository.getById("prod-1")).value).toBeNull();
  });

  it("does not expose a search() method on the repository contract", () => {
    // Phase 15 — search-shaped retrieval lives on `SearchPort<TProjection>`,
    // not on `ProductRepository`. The implementation must not reintroduce
    // a `search` method that would re-couple the catalog to `@comity/search`.
    const repo = new MemoryProductRepository();
    expect((repo as unknown as Record<string, unknown>)["search"]).toBeUndefined();
  });
});