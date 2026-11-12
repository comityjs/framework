import type { RepositoryError } from "../errors/repository.js";
import type { Result } from "../result/index.js";

/** Minimal test-framework interface supplied by the consumer. */
export interface TestFrameworkAdapter {
  /** Create a test suite. */
  describe(name: string, fn: () => void): void;

  /** Define an async test case. */
  it(name: string, fn: () => Promise<void>): void;

  /** Assert a condition; throws on failure. */
  assert(condition: unknown, message?: string): void;

  /** Assert strict equality; throws on mismatch. */
  assertEqual<T>(actual: T, expected: T, message?: string): void;

  /**
   * Optional. Register a test that the runner reports as **skipped**: it is never run and never
   * reported as passed (for example `it.skip`). The kit uses it for a capability-dependent case
   * the adapter does not declare. When absent, such a case is not registered at all, so no
   * empty test can be reported as passed; the {@link ConformanceReport} still lists it as
   * `unsupported`.
   */
  skip?(name: string, fn: () => Promise<void>): void;
}

/** Identifier of a conformance case. */
export type ConformanceCaseId =
  "TC-1" | "TC-1c" | "TC-2a" | "TC-2b" | "TC-2c" | "TC-3" | "TC-4" | "TC-5" | "TC-6";

/**
 * Whether a case applies to the adapter, decided from the capabilities it declares.
 *
 * - `applicable`: the case is registered with the runner's `it`; its `passed` / `failed` outcome
 *   is the runner's, and `passed` means its assertions ran and succeeded.
 * - `unsupported`: the adapter does not declare the capability; the case is **not executed**.
 */
export type ConformanceApplicability = "applicable" | "unsupported";

/** One entry of a {@link ConformanceReport}. */
export interface ConformanceCaseReport {
  /** Case identifier. */
  readonly id: ConformanceCaseId;

  /** Applicability of the case to this adapter. */
  readonly applicability: ConformanceApplicability;

  /** Why the case is unsupported; present only when `applicability` is `unsupported`. */
  readonly reason?: string;
}

/**
 * Machine-readable capability report returned by `runVersionedRepositoryTests`, available
 * synchronously at registration time. Mandatory cases are always `applicable`; TC-6 is
 * `unsupported` unless the adapter implements `createMultiRecordAtomicityScenario`.
 */
export interface ConformanceReport {
  /** Suite name as passed to the runner. */
  readonly suite: string;

  /** One entry per case, in identifier order. */
  readonly cases: readonly ConformanceCaseReport[];
}

/** Minimal repository interface required by the test kit. */
export interface RepositoryUnderTest<Aggregate, Context> {
  /** Persist the aggregate. Must return Comity `Result<void, RepositoryError>`. */
  save(aggregate: Aggregate, context: Context): Promise<Result<void, RepositoryError>>;
}

/** A test fixture bundling the repository, context, and read operations for a single test. */
export interface TestFixture<Aggregate, Snapshot, Context> {
  /** The repository instance under test. */
  readonly repository: RepositoryUnderTest<Aggregate, Context>;

  /** The isolation context (tenant, etc.) for this fixture. Opaque to the test kit. */
  readonly context: Context;

  /** Read the persisted snapshot for an identity; `null` if nothing is persisted. */
  readSnapshot(identity: string): Promise<Snapshot | null>;

  /**
   * Load the aggregate persisted for an identity through the repository's public read path
   * (e.g. `getById`), hydrated at the persisted version; `null` if nothing is persisted.
   * Every call returns an independent instance.
   */
  loadAggregate(identity: string): Promise<Aggregate | null>;
}

/** A scope representing a shared persistence store for one concurrency test. */
export interface SharedPersistenceScope<Aggregate, Snapshot, Context> {
  /** First fixture operating on the shared store. */
  readonly fixtureA: TestFixture<Aggregate, Snapshot, Context>;

  /** Second fixture operating on the same shared store. */
  readonly fixtureB: TestFixture<Aggregate, Snapshot, Context>;

  /** A fresh identity, unused in the shared store at creation time. */
  readonly sharedIdentity: string;

  /** Cleanup the shared scope (e.g. drop test schema, clear Map). */
  dispose(): Promise<void> | void;
}

/** Infrastructure reasons a failure injection may be expected to surface as (Guarantee 7). */
export type InfrastructureFailureReason = "service_unavailable" | "protocol_error" | "unknown";

/** A fixture whose next `save` can be made to fail with a representative infrastructure failure. */
export interface FailureInjectionFixture<Aggregate, Snapshot, Context> extends TestFixture<
  Aggregate,
  Snapshot,
  Context
> {
  /** The `RepositoryError` reason a correct adapter must report for the injected failure. */
  readonly expectedReason: InfrastructureFailureReason;

  /**
   * Arm exactly the next `repository.save` call on this fixture to fail with a representative
   * infrastructure failure. Reads are unaffected. The failure MUST be injected below the
   * repository (driver, client or store boundary).
   */
  armSaveFailure(): Promise<void> | void;
}

/** Complete scenario for testing multi-record atomicity under CAS conflict. */
export interface MultiRecordAtomicityScenario<Aggregate, Snapshot, Context> {
  /** Fresh fixture owned by this scenario; its repository persists the root and all child records. */
  readonly fixture: TestFixture<Aggregate, Snapshot, Context>;

  /** The identity of the root aggregate under test. */
  readonly identity: string;

  /** Build the initial aggregate (version 0, with child records populated) for `identity`. */
  createInitialAggregate(): Aggregate;

  /**
   * Derive, from `persisted` (loaded at version N), an aggregate at version N whose save is the
   * legitimate operation advancing the same identity to N+1. It MUST change persisted state.
   */
  deriveAdvancingAggregate(persisted: Aggregate): Aggregate;

  /**
   * Derive, from `persisted` (loaded at version N), an independent aggregate at version N whose
   * save writes the root and the related child records. It MUST differ from the advancing
   * aggregate in persisted state and MUST NOT share mutable state with it.
   */
  deriveStaleAggregate(persisted: Aggregate): Aggregate;

  /** Capture a complete snapshot of ALL records affected by the identity (root and every child). */
  captureFullState(): Promise<Snapshot[]>;

  /** Compare two complete states for exact equality, independent of array order. */
  statesEqual(a: Snapshot[], b: Snapshot[]): boolean;

  /** Clean up the scenario state. */
  dispose(): Promise<void> | void;
}

/** Generic test adapter supplied by the consumer. */
export interface VersionedRepositoryTestAdapter<Aggregate, Snapshot, Context> {
  /** Create a fresh, isolated test fixture for one test case. */
  createFixture(): TestFixture<Aggregate, Snapshot, Context>;

  /**
   * Create a valid aggregate at the specified version using the public hydration API.
   * When `identity` is supplied the aggregate carries exactly that identity; otherwise a
   * fresh identity is generated.
   */
  createAggregate(version: number, context: Context, identity?: string): Aggregate;

  /**
   * Create an aggregate with the same identity and version as `original` but different
   * persisted business state, so that `reflectsAggregate` can tell the two apart.
   */
  createCompetingAggregate(original: Aggregate, context: Context): Aggregate;

  /** Extract the persistence identity from an aggregate. */
  getIdentity(aggregate: Aggregate): string;

  /** Extract the persisted version from a snapshot. */
  getVersion(snapshot: Snapshot): number;

  /** Extract the version carried by an aggregate. */
  getAggregateVersion(aggregate: Aggregate): number;

  /** Compare two snapshots for equality of all persisted state (including version). */
  snapshotsEqual(a: Snapshot, b: Snapshot): boolean;

  /** True iff the snapshot's persisted business state equals the aggregate's, ignoring `version`. */
  reflectsAggregate(snapshot: Snapshot, aggregate: Aggregate): boolean;

  /**
   * Tenant verification callback. Returns the tenant key `context` resolves to, or `undefined`
   * if the repository applies no tenant scope. A tenant-scoped repository MUST return a value.
   */
  getTenant(context: Context): string | undefined;

  /** Mandatory: create an independent shared-persistence scope. Used by TC-1c and TC-5. */
  createSharedFixture(): Promise<SharedPersistenceScope<Aggregate, Snapshot, Context>>;

  /** Mandatory: create a fixture able to inject an infrastructure failure into `save`. Used by TC-2c. */
  createFailureInjectionFixture(): Promise<FailureInjectionFixture<Aggregate, Snapshot, Context>>;

  /** Optional: enables TC-6 multi-record atomicity. */
  createMultiRecordAtomicityScenario?(): Promise<
    MultiRecordAtomicityScenario<Aggregate, Snapshot, Context>
  >;
}
