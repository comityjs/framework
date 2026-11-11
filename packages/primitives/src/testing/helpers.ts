import type { RepositoryError } from "../errors/repository.js";
import type { TestFixture, VersionedRepositoryTestAdapter } from "./types.js";

import { ConformanceError } from "./errors.js";

/** Classified outcome of one `save` attempt. */
export type SaveOutcome<Snapshot> =
  | {
      /** Save succeeded. */ kind: "success";
      /** Persisted snapshot read after the save. */ snapshot: Snapshot;
    }
  | { /** Save was rejected with `conflict`. */ kind: "conflict" }
  | {
      /** Save failed with another reason. */ kind: "error";
      /** The repository error. */ error: RepositoryError;
    };

/**
 * Execute a save and classify the outcome. Does not throw for repository outcomes.
 *
 * @param adapter - Consumer adapter
 * @param fixture - Fixture whose repository performs the save
 * @param aggregate - Aggregate to save
 *
 * @returns The classified outcome
 */
export async function attemptSave<A, S, C>(
  adapter: VersionedRepositoryTestAdapter<A, S, C>,
  fixture: TestFixture<A, S, C>,
  aggregate: A
): Promise<SaveOutcome<S>> {
  const result = await fixture.repository.save(aggregate, fixture.context);

  if (result.success) {
    const snapshot = await fixture.readSnapshot(adapter.getIdentity(aggregate));

    if (snapshot === null) {
      throw new ConformanceError("Snapshot missing after successful save");
    }

    return { kind: "success", snapshot };
  }

  if (result.error.meta.reason === "conflict") {
    return { kind: "conflict" };
  }

  return { kind: "error", error: result.error };
}

/**
 * Establish a persisted record at version `target` (target >= 1) for `identity`: save
 * `createAggregate(0, ..., identity)` (persisted version 1), then repeat load -> save of the
 * unchanged loaded aggregate until the persisted version equals `target`.
 *
 * @param adapter - Consumer adapter
 * @param fixture - Fixture to persist through
 * @param identity - Identity to persist
 * @param target - Target persisted version
 *
 * @throws If any save is not a success or the version does not advance by exactly one
 */
export async function establishVersion<A, S, C>(
  adapter: VersionedRepositoryTestAdapter<A, S, C>,
  fixture: TestFixture<A, S, C>,
  identity: string,
  target: number
): Promise<void> {
  if (!Number.isSafeInteger(target) || target < 1) {
    throw new ConformanceError(`establishVersion: target must be an integer >= 1, got ${target}`);
  }

  let outcome = await attemptSave(
    adapter,
    fixture,
    adapter.createAggregate(0, fixture.context, identity)
  );
  let current = 0;

  for (;;) {
    if (outcome.kind !== "success") {
      throw new ConformanceError(
        `establishVersion: save at version ${current} was ${outcome.kind}`
      );
    }

    const version = adapter.getVersion(outcome.snapshot);

    if (version !== current + 1) {
      throw new ConformanceError(
        `establishVersion: expected version ${current + 1} after save, got ${version}`
      );
    }

    current = version;

    if (current === target) {
      return;
    }

    const loaded = await fixture.loadAggregate(identity);

    if (loaded === null) {
      throw new ConformanceError("establishVersion: persisted record not loadable");
    }

    outcome = await attemptSave(adapter, fixture, loaded);
  }
}
