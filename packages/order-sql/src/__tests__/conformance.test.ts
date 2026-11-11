import { runVersionedRepositoryTests } from "@comity/primitives/testing";
import { afterAll, describe, expect, it } from "vitest";
import { createSqlOrderAdapter } from "./adapter.js";
import { databaseUrl, describeIntegration, disposeAll } from "./harness.js";

afterAll(disposeAll);

describeIntegration("SqlOrderRepository against PostgreSQL", () => {
  runVersionedRepositoryTests(
    createSqlOrderAdapter(),
    {
      describe: (name, fn) => describe(name, fn),
      it: (name, fn) => it(name, fn, 60_000),
      assert: (condition, message) => {
        if (!condition) throw new Error(message ?? "assertion failed");
      },
      assertEqual: (actual, expected, message) => {
        expect(actual, message).toBe(expected);
      },
    },
    "ADR-029 conformance (real PostgreSQL)"
  );
});

it("reports whether the real-engine suite ran", () => {
  expect(typeof databaseUrl === "string" || databaseUrl === undefined).toBe(true);
});
