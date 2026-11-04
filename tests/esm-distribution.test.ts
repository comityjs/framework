import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

type Manifest = {
  name: string;
  type?: string;
  private?: boolean;
  main?: string;
  module?: string;
  types?: string;
  exports?: Record<string, unknown>;
};

type Condition = { types?: string; node?: string; default?: string };

const packageDirs = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter(
    (entry) => entry.isDirectory() && existsSync(join(PACKAGES_DIR, entry.name, "package.json"))
  )
  .map((entry) => entry.name)
  .sort();

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(PACKAGES_DIR, dir, "package.json"), "utf8")) as Manifest;
}

/** Published packages only: ADR-034 governs everything published. */
const published = packageDirs.filter((dir) => readManifest(dir).private !== true);

/** Export subpaths declared with the condition-object form. */
function subpaths(manifest: Manifest): [string, Record<string, Condition>][] {
  return Object.entries(manifest.exports ?? {})
    .filter(
      (entry): entry is [string, Record<string, Condition>] =>
        typeof entry[1] === "object" && entry[1] !== null
    )
    .map(([path, value]) => [path, value as Record<string, Condition>]);
}

describe("ADR-034: the published package set", () => {
  it("discovers every community package", () => {
    expect(packageDirs.length).toBe(54);
    expect(published.length).toBe(54);
  });
});

describe.each(published)("ADR-034: %s is ESM-only with a flat dist/", (dir) => {
  const manifest = readManifest(dir);
  const raw = readFileSync(join(PACKAGES_DIR, dir, "package.json"), "utf8");

  it("declares type: module", () => {
    expect(manifest.type).toBe("module");
  });

  it("points main and types at flat dist/ artifacts", () => {
    expect(manifest.main).toBeDefined();
    expect(manifest.main).toMatch(/^\.\/dist\/(?!esm\/|types\/|cjs\/).+\.js$/);
    expect(manifest.types).toMatch(/^\.\/dist\/(?!esm\/|types\/|cjs\/).+\.d\.ts$/);
  });

  it("has no module field, no legacy output tree and no CommonJS reference", () => {
    expect(manifest.module).toBeUndefined();
    expect(raw).not.toMatch(/dist\/(esm|types|cjs)\b/);
  });

  it("exposes types + default (no import/require branches) on every exported subpath", () => {
    const entries = subpaths(manifest);

    expect(entries.length).toBeGreaterThan(0);

    for (const [subpath, conditions] of entries) {
      expect(conditions["import"], `${subpath} has an import branch`).toBeUndefined();
      expect(conditions["require"], `${subpath} has a require branch`).toBeUndefined();

      const keys = Object.keys(conditions);

      expect(keys[0], `${subpath}: types must be first`).toBe("types");
      expect(keys[keys.length - 1], `${subpath}: default must be last`).toBe("default");
      expect(conditions.default, `${subpath} default is not flat ESM`).toMatch(
        /^\.\/dist\/.+\.js$/
      );
      expect(conditions.types, `${subpath} types is not a flat declaration`).toBe(
        conditions.default?.replace(/\.js$/, ".d.ts")
      );
    }
  });

  it("keeps typesVersions on flat declaration paths", () => {
    const typesVersions = (manifest as { typesVersions?: Record<string, Record<string, string[]>> })
      .typesVersions;

    for (const mapping of Object.values(typesVersions ?? {})) {
      for (const targets of Object.values(mapping)) {
        for (const target of targets) {
          expect(target).toMatch(/^\.\/dist\/.+\.d\.ts$/);
          expect(target).not.toMatch(/dist\/(esm|types|cjs)\//);
        }
      }
    }
  });
});

describe("ADR-034: no package-level CommonJS exception", () => {
  it("treats @comity/queue-pg-boss like every other package", () => {
    const manifest = readManifest("queue-pg-boss");
    const root = subpaths(manifest).find(([subpath]) => subpath === ".");

    expect(root).toBeDefined();
    expect(manifest.main).toBe("./dist/index.js");
    expect(root?.[1]).toEqual({
      types: "./dist/index.d.ts",
      default: "./dist/index.js",
    });
  });

  it("treats the CLI packages like every other package", () => {
    for (const dir of ["cli", "cli-commander"]) {
      const manifest = readManifest(dir);

      expect(manifest.main).toBe("./dist/index.js");
      expect(manifest.types).toBe("./dist/index.d.ts");
    }
  });

  it("preserves intentional environment conditions between types and default", () => {
    for (const dir of ["html-react", "html-preact"]) {
      const streaming = subpaths(readManifest(dir)).find(([subpath]) => subpath === "./streaming");

      expect(Object.keys(streaming?.[1] ?? {})).toEqual(["types", "node", "default"]);
      expect(streaming?.[1].node).toBe("./dist/streaming/node/index.js");
    }
  });
});
