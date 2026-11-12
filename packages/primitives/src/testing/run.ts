import type {
  ConformanceCaseId,
  ConformanceCaseReport,
  ConformanceReport,
  TestFixture,
  TestFrameworkAdapter,
  VersionedRepositoryTestAdapter,
} from "./types.js";

import { ConformanceError } from "./errors.js";
import { attemptSave, establishVersion } from "./helpers.js";

/**
 * Read a snapshot that must exist.
 *
 * @param fixture - Fixture to read through
 * @param identity - Identity to read
 * @param label - Label used in the failure message
 *
 * @returns The persisted snapshot
 *
 * @throws If nothing is persisted for the identity
 */
async function readRequired<A, S, C>(
  fixture: TestFixture<A, S, C>,
  identity: string,
  label: string
): Promise<S> {
  const snapshot = await fixture.readSnapshot(identity);

  if (snapshot === null) {
    throw new ConformanceError(`${label}: no record persisted`);
  }

  return snapshot;
}

/**
 * Run the full versioned-repository conformance suite (ADR-029 section 5).
 *
 * @param adapter - Consumer-supplied adapter normalising their repository to the generic contract
 * @param framework - Consumer's test-framework adapter (describe, it, assert, assertEqual)
 * @param suiteName - Name for the test suite
 *
 * @returns A machine-readable report of which cases apply to the adapter. TC-6 is `unsupported`
 * (and not executed) unless the adapter declares multi-record atomicity; an unsupported case is
 * never registered as a passing test.
 */
export function runVersionedRepositoryTests<Aggregate, Snapshot, Context>(
  adapter: VersionedRepositoryTestAdapter<Aggregate, Snapshot, Context>,
  framework: TestFrameworkAdapter,
  suiteName: string
): ConformanceReport {
  const { assert, assertEqual } = framework;
  const multiRecordDeclared = adapter.createMultiRecordAtomicityScenario !== undefined;
  const mandatory: readonly ConformanceCaseId[] = [
    "TC-1",
    "TC-1c",
    "TC-2a",
    "TC-2b",
    "TC-2c",
    "TC-3",
    "TC-4",
    "TC-5",
  ];
  const report: ConformanceReport = {
    suite: suiteName,
    cases: [
      ...mandatory.map((id): ConformanceCaseReport => ({ id, applicability: "applicable" })),
      multiRecordDeclared
        ? { id: "TC-6", applicability: "applicable" }
        : {
            id: "TC-6",
            applicability: "unsupported",
            reason: "multi-record atomicity not declared",
          },
    ],
  };

  framework.describe(suiteName, () => {
    framework.it("TC-1: first persistence persists version 1", async () => {
      const fixture = adapter.createFixture();
      const aggregate = adapter.createAggregate(0, fixture.context);
      const outcome = await attemptSave(adapter, fixture, aggregate);

      if (outcome.kind !== "success") {
        throw new ConformanceError(`TC-1: expected success, got ${outcome.kind}`);
      }

      assertEqual(adapter.getVersion(outcome.snapshot), 1, "TC-1: persisted version must be 1");
      assertEqual(
        adapter.getAggregateVersion(aggregate),
        0,
        "TC-1: in-memory aggregate must keep its pre-save version"
      );
    });

    framework.it("TC-1c: concurrent creation yields exactly one success", async () => {
      const scope = await adapter.createSharedFixture();

      try {
        const { fixtureA, fixtureB, sharedIdentity } = scope;

        assert(
          adapter.getTenant(fixtureA.context) === adapter.getTenant(fixtureB.context),
          "TC-1c: fixtures must resolve to the same tenant scope"
        );

        const aggA = adapter.createAggregate(0, fixtureA.context, sharedIdentity);
        const aggB = adapter.createCompetingAggregate(aggA, fixtureB.context);

        assertEqual(adapter.getIdentity(aggA), sharedIdentity, "TC-1c: aggA identity");
        assertEqual(adapter.getIdentity(aggB), sharedIdentity, "TC-1c: aggB identity");

        const [outA, outB] = await Promise.all([
          attemptSave(adapter, fixtureA, aggA),
          attemptSave(adapter, fixtureB, aggB),
        ]);

        const successes = [outA, outB].filter((o) => o.kind === "success").length;
        const conflicts = [outA, outB].filter((o) => o.kind === "conflict").length;

        assertEqual(successes, 1, "TC-1c: exactly one create must succeed");
        assertEqual(conflicts, 1, "TC-1c: exactly one create must return conflict");

        const final = await readRequired(fixtureA, sharedIdentity, "TC-1c");

        assertEqual(adapter.getVersion(final), 1, "TC-1c: final version must be 1");

        const winner = outA.kind === "success" ? aggA : aggB;
        const loser = outA.kind === "success" ? aggB : aggA;

        assert(
          adapter.reflectsAggregate(final, winner),
          "TC-1c: final state must reflect the successful save"
        );
        assert(
          !adapter.reflectsAggregate(final, loser),
          "TC-1c: final state must not reflect the conflicting save"
        );
      } finally {
        await scope.dispose();
      }
    });

    framework.it("TC-2a: non-zero version with no row conflicts", async () => {
      const fixture = adapter.createFixture();
      const aggregate = adapter.createAggregate(5, fixture.context);
      const outcome = await attemptSave(adapter, fixture, aggregate);

      assertEqual(outcome.kind, "conflict", "TC-2a: must conflict");
      assertEqual(
        await fixture.readSnapshot(adapter.getIdentity(aggregate)),
        null,
        "TC-2a: no row may be created"
      );
    });

    framework.it("TC-2b: version-zero save over an existing row conflicts", async () => {
      const fixture = adapter.createFixture();
      const identity = adapter.getIdentity(adapter.createAggregate(0, fixture.context));

      await establishVersion(adapter, fixture, identity, 3);

      const before = await readRequired(fixture, identity, "TC-2b");
      const outcome = await attemptSave(
        adapter,
        fixture,
        adapter.createAggregate(0, fixture.context, identity)
      );

      assertEqual(outcome.kind, "conflict", "TC-2b: must conflict");

      const after = await readRequired(fixture, identity, "TC-2b");

      assertEqual(adapter.getVersion(after), 3, "TC-2b: stored version must remain 3");
      assert(adapter.snapshotsEqual(before, after), "TC-2b: stored row must be unchanged");
    });

    framework.it("TC-2c: infrastructure failure is propagated, never a conflict", async () => {
      const fixture = await adapter.createFailureInjectionFixture();
      const identity = adapter.getIdentity(adapter.createAggregate(0, fixture.context));

      await establishVersion(adapter, fixture, identity, 1);

      const baseline = await readRequired(fixture, identity, "TC-2c");

      assertEqual(adapter.getVersion(baseline), 1, "TC-2c setup: initial version must be 1");

      const loaded = await fixture.loadAggregate(identity);

      if (loaded === null) {
        throw new ConformanceError("TC-2c setup: record not loadable");
      }

      await fixture.armSaveFailure();

      const outcome = await attemptSave(adapter, fixture, loaded);

      if (outcome.kind !== "error") {
        throw new ConformanceError(`TC-2c: expected infrastructure error, got ${outcome.kind}`);
      }

      assertEqual(
        outcome.error.meta.reason,
        fixture.expectedReason,
        "TC-2c: original error reason must be preserved"
      );
      assert(
        outcome.error.meta.reason !== "conflict",
        "TC-2c: infrastructure failure must not be reported as conflict"
      );

      const after = await readRequired(fixture, identity, "TC-2c");

      assert(adapter.snapshotsEqual(baseline, after), "TC-2c: persisted state must be unchanged");
    });

    framework.it("TC-3: successful update increments the version exactly once", async () => {
      const fixture = adapter.createFixture();
      const identity = adapter.getIdentity(adapter.createAggregate(0, fixture.context));

      await establishVersion(adapter, fixture, identity, 3);

      const outcome = await attemptSave(
        adapter,
        fixture,
        adapter.createAggregate(3, fixture.context, identity)
      );

      if (outcome.kind !== "success") {
        throw new ConformanceError(`TC-3: expected success, got ${outcome.kind}`);
      }

      assertEqual(adapter.getVersion(outcome.snapshot), 4, "TC-3: version must be 4");
    });

    framework.it("TC-4: stale update conflicts and leaves the row unchanged", async () => {
      const fixture = adapter.createFixture();
      const identity = adapter.getIdentity(adapter.createAggregate(0, fixture.context));

      await establishVersion(adapter, fixture, identity, 5);

      const before = await readRequired(fixture, identity, "TC-4");
      const outcome = await attemptSave(
        adapter,
        fixture,
        adapter.createAggregate(3, fixture.context, identity)
      );

      assertEqual(outcome.kind, "conflict", "TC-4: must conflict");

      const after = await readRequired(fixture, identity, "TC-4");

      assertEqual(adapter.getVersion(after), 5, "TC-4: stored version must remain 5");
      assert(adapter.snapshotsEqual(before, after), "TC-4: stored row must be unchanged");
    });

    framework.it("TC-5: concurrent same-version update yields exactly one success", async () => {
      const scope = await adapter.createSharedFixture();

      try {
        const { fixtureA, fixtureB, sharedIdentity } = scope;

        assert(
          adapter.getTenant(fixtureA.context) === adapter.getTenant(fixtureB.context),
          "TC-5: fixtures must resolve to the same tenant scope"
        );

        await establishVersion(adapter, fixtureA, sharedIdentity, 1);

        const initial = await readRequired(fixtureA, sharedIdentity, "TC-5 setup");

        assertEqual(adapter.getVersion(initial), 1, "TC-5 setup: initial version must be 1");

        const loadedA = await fixtureA.loadAggregate(sharedIdentity);
        const loadedB = await fixtureB.loadAggregate(sharedIdentity);

        if (loadedA === null || loadedB === null) {
          throw new ConformanceError("TC-5 setup: record not loadable from both fixtures");
        }

        const aggA = loadedA;
        const aggB = adapter.createCompetingAggregate(loadedB, fixtureB.context);

        const [outA, outB] = await Promise.all([
          attemptSave(adapter, fixtureA, aggA),
          attemptSave(adapter, fixtureB, aggB),
        ]);

        const successes = [outA, outB].filter((o) => o.kind === "success").length;
        const conflicts = [outA, outB].filter((o) => o.kind === "conflict").length;

        assertEqual(successes, 1, "TC-5: exactly one save must succeed");
        assertEqual(conflicts, 1, "TC-5: exactly one save must return conflict");

        const final = await readRequired(fixtureA, sharedIdentity, "TC-5");

        assertEqual(adapter.getVersion(final), 2, "TC-5: final version must be 2");

        const winner = outA.kind === "success" ? aggA : aggB;
        const loser = outA.kind === "success" ? aggB : aggA;

        assert(
          adapter.reflectsAggregate(final, winner),
          "TC-5: final state must reflect the successful save"
        );
        assert(
          !adapter.reflectsAggregate(final, loser),
          "TC-5: final state must not reflect the conflicting save"
        );

        const finalB = await readRequired(fixtureB, sharedIdentity, "TC-5 (fixtureB)");

        assert(
          adapter.snapshotsEqual(final, finalB),
          "TC-5: fixtures must observe the same persisted state"
        );
      } finally {
        await scope.dispose();
      }
    });

    if (adapter.createMultiRecordAtomicityScenario === undefined) {
      // An undeclared capability is never an executed (or passing) test: a runner that can skip
      // reports it as skipped; otherwise nothing is registered. The report above says "unsupported".
      framework.skip?.("TC-6: unsupported (multi-record atomicity not declared)", async () => {});

      return;
    }

    const createScenario = adapter.createMultiRecordAtomicityScenario.bind(adapter);

    framework.it("TC-6: stale multi-record save leaves all records unchanged", async () => {
      const scenario = await createScenario();

      try {
        const { fixture, identity } = scenario;
        const initial = await attemptSave(adapter, fixture, scenario.createInitialAggregate());

        if (initial.kind !== "success") {
          throw new ConformanceError(`TC-6 setup: initial save was ${initial.kind}`);
        }

        const n = adapter.getVersion(initial.snapshot);
        const loaded = await fixture.loadAggregate(identity);

        if (loaded === null) {
          throw new ConformanceError("TC-6 setup: record not loadable");
        }

        assertEqual(
          adapter.getAggregateVersion(loaded),
          n,
          "TC-6: loaded aggregate must be at version N"
        );

        const staleAggregate = scenario.deriveStaleAggregate(loaded);
        const advancingAggregate = scenario.deriveAdvancingAggregate(loaded);

        assertEqual(
          adapter.getAggregateVersion(staleAggregate),
          n,
          "TC-6: stale aggregate must be at version N"
        );
        assertEqual(
          adapter.getAggregateVersion(advancingAggregate),
          n,
          "TC-6: advancing aggregate must be at version N"
        );

        const initialBaseline = await scenario.captureFullState();
        const advance = await attemptSave(adapter, fixture, advancingAggregate);

        if (advance.kind !== "success") {
          throw new ConformanceError(`TC-6: legitimate advance was ${advance.kind}`);
        }

        assertEqual(
          adapter.getVersion(advance.snapshot),
          n + 1,
          "TC-6: persisted version must be N+1 after advance"
        );

        const postAdvanceBaseline = await scenario.captureFullState();

        assert(
          !scenario.statesEqual(initialBaseline, postAdvanceBaseline),
          "TC-6: advance must change persisted state"
        );
        assertEqual(
          adapter.getAggregateVersion(staleAggregate),
          n,
          "TC-6: stale aggregate must still be at version N"
        );

        const stale = await attemptSave(adapter, fixture, staleAggregate);

        assertEqual(stale.kind, "conflict", "TC-6: stale save must return conflict");

        const finalState = await scenario.captureFullState();

        assert(
          scenario.statesEqual(postAdvanceBaseline, finalState),
          "TC-6: partial writes detected"
        );
      } finally {
        await scenario.dispose();
      }
    });
  });

  return report;
}
