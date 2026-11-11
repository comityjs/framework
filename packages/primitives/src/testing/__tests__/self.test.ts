import { describe, expect, it } from "vitest";
import { RepositoryError } from "../../errors/repository.js";
import { failure, success } from "../../result/index.js";
import type { Result } from "../../result/index.js";
import { runVersionedRepositoryTests } from "../run.js";
import type {
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

function makeAdapter(mode: Mode): VersionedRepositoryTestAdapter<Doc, Doc, string> {
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
  };
}

/** Run the suite and collect pass/fail per test without a real test runner. */
async function collect(mode: Mode): Promise<Map<string, string | null>> {
  const tests: [string, () => Promise<void>][] = [];
  const framework: TestFrameworkAdapter = {
    describe: (_name, fn) => fn(),
    it: (name, fn) => void tests.push([name, fn]),
    assert: (condition, message) => {
      if (!condition) throw new Error(message ?? "assertion failed");
    },
    assertEqual: (actual, expected, message) => {
      if (actual !== expected)
        throw new Error(message ?? `expected ${String(expected)}, got ${String(actual)}`);
    },
  };

  runVersionedRepositoryTests(makeAdapter(mode), framework, "self");

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

  return results;
}

describe("conformance kit self-test", () => {
  it("a correct CAS repository passes every case (TC-6 reported unsupported)", async () => {
    const results = await collect("cas");

    expect([...results.entries()].filter(([, failureMessage]) => failureMessage !== null)).toEqual(
      []
    );
    expect(results.size).toBe(9);
  });

  it("detects last-write-wins (stale update / version cases)", async () => {
    const results = await collect("lww");

    expect(results.get("TC-4")).not.toBeNull();
    expect(results.get("TC-2b")).not.toBeNull();
    expect(results.get("TC-1c")).not.toBeNull();
    expect(results.get("TC-5")).not.toBeNull();
  });

  it("detects a read-then-write repository through the concurrency cases", async () => {
    const results = await collect("read-then-write");

    expect(results.get("TC-1c")).not.toBeNull();
    expect(results.get("TC-5")).not.toBeNull();
  });

  it("detects infrastructure failures masquerading as conflict", async () => {
    const results = await collect("masks-infra");

    expect(results.get("TC-2c")).not.toBeNull();
  });
});
