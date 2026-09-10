import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
// packages/search/src/contracts/__tests__ -> monorepo root
const repoRoot = resolve(here, "../../../../..");

interface Manifest {
  name: string;
  dependencies?: Record<string, string>;
}

function readManifest(pkg: string): Manifest {
  return JSON.parse(
    readFileSync(resolve(repoRoot, "packages", pkg, "package.json"), "utf8"),
  ) as Manifest;
}

/**
 * Search contract isolation.
 *
 * Verifies the architectural invariant:
 * domain repositories MUST NOT depend on @comity/search, while
 * @comity/storefront retains its approved capability dependency.
 */
describe("Search contract isolation (package level)", () => {
  it("catalog must not depend on @comity/search", () => {
    const manifest = readManifest("catalog");
    expect(manifest.dependencies?.["@comity/search"]).toBeUndefined();
  });

  it("content must not depend on @comity/search", () => {
    const manifest = readManifest("content");
    expect(manifest.dependencies?.["@comity/search"]).toBeUndefined();
  });

  it("taxonomy must not depend on @comity/search", () => {
    const manifest = readManifest("taxonomy");
    expect(manifest.dependencies?.["@comity/search"]).toBeUndefined();
  });

  it("storefront -> search remains a valid capability dependency", () => {
    const manifest = readManifest("storefront");
    expect(manifest.dependencies?.["@comity/search"]).toBeDefined();
  });

  it("search must not depend on catalog, content, taxonomy, or storefront", () => {
    const manifest = readManifest("search");
    const deps = Object.keys(manifest.dependencies ?? {});
    for (const domain of [
      "@comity/catalog",
      "@comity/content",
      "@comity/taxonomy",
      "@comity/storefront",
    ]) {
      expect(deps, `search must not depend on ${domain}`).not.toContain(domain);
    }
  });
});