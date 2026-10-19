import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

interface Manifest {
  readonly exports: Record<string, unknown>;
  readonly typesVersions?: Record<string, Record<string, readonly string[]>>;
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(resolve(here, "../../package.json"), "utf8")) as Manifest;
}

/**
 * Public API surface fixed by ADR-028 D7.
 *
 * The root barrel carries contracts only, so it contributes no runtime export;
 * `./errors` carries the module's single error class.
 */
describe("@comity/queue public API", () => {
  it("should export no runtime value from the root barrel", async () => {
    const root = await import("../index.js");

    expect(Object.keys(root)).toEqual([]);
  });

  it("should export only QueueError as a runtime value from ./errors", async () => {
    const errors = await import("../errors/index.js");

    expect(Object.keys(errors)).toEqual(["QueueError"]);
  });

  it("should declare exactly the root, errors and package.json subpaths", () => {
    const manifest = readManifest();

    expect(Object.keys(manifest.exports).sort()).toEqual(
      [".", "./errors", "./package.json"].sort()
    );
  });

  it("should resolve the errors subpath for both module systems", () => {
    const manifest = readManifest();

    expect(manifest.exports["./errors"]).toEqual({
      import: {
        types: "./dist/types/errors/index.d.ts",
        default: "./dist/esm/errors/index.js",
      },
      require: {
        types: "./dist/types/errors/index.d.ts",
        default: "./dist/cjs/errors/index.js",
      },
    });
  });

  it("should map the errors subpath for legacy TypeScript resolution", () => {
    const manifest = readManifest();

    expect(manifest.typesVersions?.["*"]?.["errors"]).toEqual(["./dist/types/errors/index.d.ts"]);
  });
});
