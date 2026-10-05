import type { Compilable } from "kysely";

/**
 * A single already-parameterised statement submitted to an atomic batch executor.
 *
 * @remarks
 * Deliberately free of Comity and database-engine concepts. It carries only
 * normalised SQL text and positional parameters.
 */
export interface KyselyAtomicStatement {
  /** Normalised SQL statement text */
  readonly statement: string;

  /** Positional parameters bound to `statement` */
  readonly params: readonly unknown[];
}

/**
 * Outcome of a single statement within an atomic batch.
 */
export interface KyselyAtomicStatementResult {
  /** Rows produced by the statement */
  readonly rows: readonly unknown[];

  /** Optional affected rows count */
  readonly numAffectedRows?: bigint;
}

/**
 * Executes a set of already-parameterised statements as one all-or-nothing
 * operation and returns one result per statement in input order.
 *
 * @remarks
 * This abstraction exists because Kysely's public API does not expose an atomic
 * multi-statement primitive. Composition injects the implementation that
 * provides one, for example by delegating to a database-specific batch call.
 *
 * Implementations MUST provide all-or-nothing semantics: either every statement
 * takes effect, or none does. They MUST NOT apply retries, sequential fallback,
 * or compensation.
 *
 * Implementations MUST NOT assume atomicity on their own behalf; an
 * implementation that cannot guarantee it must not be injected here.
 *
 * The adapter maps `numAffectedRows` to `SqlResult.rowCount`. A statement that
 * affects zero rows is still a successful result; the executor MUST NOT treat a
 * zero count as a failure.
 */
export interface KyselyAtomicBatchExecutor {
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
    statements: readonly KyselyAtomicStatement[]
  ): Promise<readonly KyselyAtomicStatementResult[]>;
}

/**
 * Minimal Kysely database interface used by this adapter.
 */
export interface KyselyDatabase {
  /** Execute a compiled query and return rows with optional affected count */
  executeQuery<T = unknown>(
    query: Compilable
  ): Promise<{
    /** Result rows */
    rows: T[];

    /** Optional affected rows count as bigint */
    numAffectedRows?: bigint;
  }>;

  /** Start a transaction and execute the provided function within it */
  transaction(): {
    /** Execute transactional work and resolve with the function's result */
    execute<T>(fn: (trx: KyselyDatabase) => Promise<T>): Promise<T>;
  };
}
