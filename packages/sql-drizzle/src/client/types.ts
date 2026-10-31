import type { SQLWrapper } from "drizzle-orm";

/**
 * A single already-parameterised statement submitted to an atomic batch
 * executor.
 *
 * @remarks
 * Deliberately free of Comity and database-engine concepts. It carries only
 * normalised SQL text and positional parameters.
 */
export interface DrizzleAtomicStatement {
  /** Normalised SQL statement text */
  readonly statement: string;

  /** Positional parameters bound to `statement` */
  readonly params: readonly unknown[];
}

/**
 * Outcome of a single statement within an atomic batch.
 */
export interface DrizzleAtomicStatementResult {
  /** Rows produced by the statement */
  readonly rows: readonly unknown[];

  /**
   * Optional affected rows count.
   *
   * @remarks
   * Drizzle drivers report affected rows as a `number`; `bigint` is accepted so
   * an executor backed by a driver that widens the count needs no conversion.
   */
  readonly affectedRows?: number | bigint;
}

/**
 * Executes a set of already-parameterised statements as one all-or-nothing
 * operation and returns one result per statement in input order.
 *
 * @remarks
 * This abstraction exists because no Drizzle API offers an atomic
 * multi-statement primitive that is portable across dialects: `batch()` is
 * dialect-specific and accepts query builders, not raw statements.
 * Composition injects the implementation that provides one, for example by
 * delegating to a database-specific batch call.
 *
 * Implementations MUST provide all-or-nothing semantics: either every statement
 * takes effect, or none does. They MUST NOT apply retries, sequential fallback,
 * or compensation.
 *
 * Implementations MUST NOT assume atomicity on their own behalf; an
 * implementation that cannot guarantee it must not be injected here.
 *
 * The adapter maps `affectedRows` to `SqlResult.rowCount`. A statement that
 * affects zero rows is still a successful result; the executor MUST NOT treat a
 * zero count as a failure.
 */
export interface DrizzleAtomicBatchExecutor {
  /**
   * Execute every statement atomically.
   *
   * @param statements - Statements to execute, in execution order
   *
   * @returns One result per statement, positionally aligned with `statements`
   *
   * @throws Underlying driver failures. The adapter maps them to SqlError.
   */
  execute(
    statements: readonly DrizzleAtomicStatement[]
  ): Promise<readonly DrizzleAtomicStatementResult[]>;
}

/**
 * Rows and optional affected-row count normalised from a driver result.
 */
export interface DrizzleQueryResult {
  /** Rows produced by the statement */
  readonly rows: readonly unknown[];

  /** Affected rows count when the driver reports one */
  readonly rowCount?: number;
}

/**
 * Normalises the raw value Drizzle resolves with into rows and an optional row
 * count.
 *
 * @remarks
 * Drizzle returns the driver's own result object, and every driver uses a
 * different shape. The adapter ships a normaliser that understands the shapes
 * listed in `docs/results.md`. Composition supplies a replacement when the
 * driver in use returns something else.
 */
export type DrizzleResultNormalizer = (raw: unknown) => DrizzleQueryResult;

/**
 * Minimal Drizzle database surface used by this adapter.
 *
 * @remarks
 * Drizzle exposes no dialect-neutral execution method. PostgreSQL and MySQL
 * databases provide `execute()`, SQLite databases provide `all()`, and every
 * database provides `transaction()`. The adapter resolves the surface at
 * construction and then works only against this port.
 *
 * `transaction()` is typed as asynchronous because the adapter keeps a
 * transaction open across `begin()` / `commit()` calls. Synchronous drivers,
 * whose transaction callback must be synchronous, are rejected.
 */
export interface DrizzleDatabase {
  /** Execute a compiled statement and resolve with the driver result */
  execute?(query: SQLWrapper): PromiseLike<unknown>;

  /** Execute a compiled statement and resolve with the rows it produced */
  all?(query: SQLWrapper): PromiseLike<unknown>;

  /** Start a transaction and execute the provided function within it */
  transaction?<T>(fn: (tx: DrizzleDatabase) => Promise<T>): PromiseLike<T>;
}
