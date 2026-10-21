import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

interface Manifest {
  readonly name: string;
  readonly license: string;
  readonly comity: { readonly layer: string; readonly implements?: string };
  readonly exports: Record<string, unknown>;
  readonly peerDependencies?: Record<string, string>;
  readonly dependencies?: Record<string, string>;
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(resolve(here, "../../package.json"), "utf8")) as Manifest;
}

describe("@comity/queue-pg-boss public API", () => {
  it("should export only the factory as a runtime value", async () => {
    const module = await import("../index.js");

    expect(Object.keys(module)).toEqual(["createPgBossQueueClient"]);
  });

  it("should declare exactly the root and package.json subpaths", () => {
    const manifest = readManifest();

    expect(Object.keys(manifest.exports).sort()).toEqual([".", "./package.json"].sort());
  });

  it("should be classified as a technology adapter for @comity/queue", () => {
    const manifest = readManifest();

    expect(manifest.comity.layer).toBe("technology-adapter");
    expect(manifest.comity.implements).toBe("@comity/queue");
  });

  it("should declare the core contract and pg-boss as peers", () => {
    const manifest = readManifest();

    expect(manifest.peerDependencies?.["@comity/queue"]).toBe("workspace:*");
    expect(manifest.peerDependencies?.["pg-boss"]).toBe("^12.38.0");
    expect(manifest.dependencies?.["@comity/queue"]).toBe("workspace:*");
  });

  it("should be MIT licensed", () => {
    expect(readManifest().license).toBe("MIT");
  });
});
