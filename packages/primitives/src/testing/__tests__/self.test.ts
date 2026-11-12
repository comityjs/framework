import { describe, expect, it } from "vitest";
import { RepositoryError } from "../../errors/repository.js";
import { failure, success } from "../../result/index.js";
import type { Result } from "../../result/index.js";
import { runVersionedRepositoryTests } from "../run.js";
import type {
  ConformanceReport,
  TestFixture,
  TestFrameworkAdapter,
  VersionedRepositoryTestAdapter,
} from "../types.js";

/** Minimal aggregate used only to exercise the kit. */
interface Doc {
  readonly id: string;
  readonly version: number;
  readonly body: string;
}

type Store = Map<string, Doc>;
type Mode = "cas" | "lww" | "read-then-write" | "masks-infra";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function conflict(): Result<void, RepositoryError> {
  return failure(
    new RepositoryError("conflict", { details: { repository: "doc", operation: "save" } })
  );
}

function makeRepo(store: Store, mode: Mode, armed: { value: boolean }) {
  return {
    async save(doc: Doc, tenant: string): Promise<Result<void, RepositoryError>> {
      const key = `${tenant}/${doc.id}`;

      if (armed.value) {
        armed.value = false;

        return failure(
          new RepositoryError(mode === "masks-infra" ? "conflict" : "service_unavailable", {
            details: { repository: "doc", operation: "save" },
          })
        );
      }

      if (mode === "lww") {
        store.set(key, { ...doc, version: (store.get(key)?.version ?? 0) + 1 });

        return success(undefined);
      }

      if (mode === "read-then-write") {
        const stored = store.get(key);

        await tick();

        if ((stored?.version ?? 0) !== doc.version) return conflict();

        store.set(key, { ...doc, version: doc.version + 1 });

        return success(undefined);
      }

      // Synchronous check-and-set: atomic with respect to the event loop.
      const stored = store.get(key);

      if ((stored?.version ?? 0) !== doc.version) return conflict();

      store.set(key, { ...doc, version: doc.version + 1 });

      return success(undefined);
    },
  };
}

function makeAdapter(
  mode: Mode,
  options: { readonly multiRecord?: boolean } = {}
): VersionedRepositoryTestAdapter<Doc, Doc, string> {
  const fixtureOver = (store: Store, tenant: string, armed: { value: boolean }) => {
    const repo = makeRepo(store, mode, armed);
    const fixture: TestFixture<Doc, Doc, string> = {
      repository: repo,
      context: tenant,
      readSnapshot: (identity) => Promise.resolve(store.get(`${tenant}/${identity}`) ?? null),
      loadAggregate: (identity) => {
        const doc = store.get(`${tenant}/${identity}`);

        return Promise.resolve(doc === undefined ? null : { ...doc });
      },
    };

    return fixture;
  };

  return {
    createFixture: () => fixtureOver(new Map(), "t1", { value: false }),
    createAggregate: (version, _ctx, identity) => ({
      id: identity ?? crypto.randomUUID(),
      version,
      body: "a",
    }),
    createCompetingAggregate: (original) => ({ ...original, body: "b" }),
    getIdentity: (doc) => doc.id,
    getVersion: (snapshot) => snapshot.version,
    getAggregateVersion: (doc) => doc.version,
    snapshotsEqual: (a, b) => a.id === b.id && a.version === b.version && a.body === b.body,
    reflectsAggregate: (snapshot, doc) => snapshot.body === doc.body && snapshot.id === doc.id,
    getTenant: (ctx) => ctx,
    createSharedFixture: () => {
      const store: Store = new Map();

      return Promise.resolve({
        fixtureA: fixtureOver(store, "t1", { value: false }),
        fixtureB: fixtureOver(store, "t1", { value: false }),
        sharedIdentity: crypto.randomUUID(),
        dispose: () => undefined,
      });
    },
    createFailureInjectionFixture: () => {
      const armed = { value: false };
      const base = fixtureOver(new Map(), "t1", armed);

      return Promise.resolve({
        ...base,
        expectedReason: "service_unavailable" as const,
        armSaveFailure: () => {
          armed.value = true;
        },
      });
    },
    ...(options.multiRecord === true
      ? {
          // A single-record "scenario" is enough to exercise the kit's TC-6 flow.
          createMultiRecordAtomicityScenario: () => {
            const store: Store = new Map();
            const fixture = fixtureOver(store, "t1", { value: false });
            const identity = crypto.randomUUID();

            return Promise.resolve({
              fixture,
              identity,
              createInitialAggregate: () => ({ id: identity, version: 0, body: "a" }),
              deriveAdvancingAggregate: (persisted: Doc) => ({ ...persisted, body: "advanced" }),
              deriveStaleAggregate: (persisted: Doc) => ({ ...persisted, body: "stale" }),
              captureFullState: () =>
                Promise.resolve([...store.values()].map((doc) => ({ ...doc }))),
              statesEqual: (a: Doc[], b: Doc[]) => JSON.stringify(a) === JSON.stringify(b),
              dispose: () => undefined,
            });
          },
        }
      : {}),
  };
}

interface Collected {
  readonly results: Map<string, string | null>;
  readonly skipped: string[];
  readonly report: ConformanceReport;
}

/** Run the suite and collect pass/fail per test without a real test runner. */
async function collect(
  mode: Mode,
  options: { readonly multiRecord?: boolean; readonly withSkip?: boolean } = {}
): Promise<Collected> {
  const tests: [string, () => Promise<void>][] = [];
  const skipped: string[] = [];
  const framework: TestFrameworkAdapter = {
    describe: (_name, fn) => fn(),
    it: (name, fn) => void tests.push([name, fn]),
    ...(options.withSkip === true ? { skip: (name: string) => void skipped.push(name) } : {}),
    assert: (condition, message) => {
      if (!condition) throw new Error(message ?? "assertion failed");
    },
    assertEqual: (actual, expected, message) => {
      if (actual !== expected)
        throw new Error(message ?? `expected ${String(expected)}, got ${String(actual)}`);
    },
  };

  const report = runVersionedRepositoryTests(
    makeAdapter(mode, options.multiRecord === true ? { multiRecord: true } : {}),
    framework,
    "self"
  );

  const results = new Map<string, string | null>();

  for (const [name, fn] of tests) {
    try {
      await fn();
      results.set(name.split(":")[0] ?? name, null);
    } catch (error) {
      results.set(
        name.split(":")[0] ?? name,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  return { results, skipped, report };
}

describe("conformance kit self-test", () => {
  it("a correct CAS repository passes every applicable case", async () => {
    const { results } = await collect("cas");

    expect([...results.entries()].filter(([, failureMessage]) => failureMessage !== null)).toEqual(
      []
    );
    // TC-1, TC-1c, TC-2a, TC-2b, TC-2c, TC-3, TC-4, TC-5: nothing is registered for TC-6.
    expect([...results.keys()].sort()).toEqual(
      ["TC-1", "TC-1c", "TC-2a", "TC-2b", "TC-2c", "TC-3", "TC-4", "TC-5"].sort()
    );
  });

  it("TC-6 undeclared: reported unsupported, never registered as an executed test", async () => {
    const { results, skipped, report } = await collect("cas");
    const tc6 = report.cases.find((entry) => entry.id === "TC-6");

    expect(tc6).toEqual({
      id: "TC-6",
      applicability: "unsupported",
      reason: "multi-record atomicity not declared",
    });
    expect(results.has("TC-6")).toBe(false);
    expect(skipped).toEqual([]);
    expect(report.cases.filter((entry) => entry.applicability === "applicable")).toHaveLength(8);
  });

  it("TC-6 undeclared with a skipping runner: registered as skipped, never run", async () => {
    const { results, skipped, report } = await collect("cas", { withSkip: true });

    expect(skipped).toEqual(["TC-6: unsupported (multi-record atomicity not declared)"]);
    expect(results.has("TC-6")).toBe(false);
    expect(report.cases.find((entry) => entry.id === "TC-6")?.applicability).toBe("unsupported");
  });

  it("TC-6 declared: applicable, executed, and passes for a correct repository", async () => {
    const { results, skipped, report } = await collect("cas", {
      multiRecord: true,
      withSkip: true,
    });

    expect(report.cases.find((entry) => entry.id === "TC-6")).toEqual({
      id: "TC-6",
      applicability: "applicable",
    });
    expect(skipped).toEqual([]);
    expect(results.get("TC-6")).toBeNull();
  });

  it("TC-6 declared: a repository that overwrites a stale save fails it", async () => {
    const { results } = await collect("lww", { multiRecord: true });

    expect(results.get("TC-6")).not.toBeNull();
  });

  it("detects last-write-wins (stale update / version cases)", async () => {
    const { results } = await collect("lww");

    expect(results.get("TC-4")).not.toBeNull();
    expect(results.get("TC-2b")).not.toBeNull();
    expect(results.get("TC-1c")).not.toBeNull();
    expect(results.get("TC-5")).not.toBeNull();
  });

  it("detects a read-then-write repository through the concurrency cases", async () => {
    const { results } = await collect("read-then-write");

    expect(results.get("TC-1c")).not.toBeNull();
    expect(results.get("TC-5")).not.toBeNull();
  });

  it("detects infrastructure failures masquerading as conflict", async () => {
    const { results } = await collect("masks-infra");

    expect(results.get("TC-2c")).not.toBeNull();
  });
});
