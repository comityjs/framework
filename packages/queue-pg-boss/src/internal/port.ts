/**
 * The minimal pg-boss surface this adapter depends on.
 *
 * @remarks
 * Internal. Never exported from the package. Defining the surface here keeps
 * pg-boss types out of the public API and lets the state machine be exercised
 * against a deterministic test double.
 */
export interface PgBossJobLike {
  /** Identifier assigned by pg-boss. */
  readonly id: string;

  /** Queue the job was delivered from. */
  readonly name: string;

  /** Serialized payload. */
  readonly data: unknown;
}

/** Options passed to `work()`. */
export interface PgBossWorkOptions {
  /** Jobs fetched per poll. Always 1 for this adapter. */
  readonly batchSize?: number;

  /** Base polling interval, in seconds. */
  readonly pollingIntervalSeconds?: number;
}

/** Options passed to `offWork()`. */
export interface PgBossOffWorkOptions {
  /** Restrict the stop to one worker id. */
  readonly id?: string;

  /** Wait for the worker's current jobs to finish. Defaults to true in pg-boss. */
  readonly wait?: boolean;
}

/** Options passed to `stop()`. */
export interface PgBossStopOptions {
  /** Close the connection pool afterwards. */
  readonly close?: boolean;

  /** Wait for active work before shutting down. */
  readonly graceful?: boolean;

  /** Upper bound, in milliseconds, for the graceful wait. */
  readonly timeout?: number;
}

/**
 * pg-boss operations used by the adapter.
 *
 * @remarks
 * Internal. Mirrors the subset of `PgBoss` this adapter calls.
 */
export interface PgBossPort {
  /** Publish one job. Resolves the job id, or `null` when no row was inserted. */
  send(name: string, data: object): Promise<string | null>;

  /** Register a polling worker for a queue and resolve its worker id. */
  work(
    name: string,
    options: PgBossWorkOptions,
    handler: (jobs: readonly PgBossJobLike[]) => Promise<void>
  ): Promise<string>;

  /** Stop polling for a queue, optionally waiting for current jobs. */
  offWork(name: string, options?: PgBossOffWorkOptions): Promise<void>;

  /** Read a queue definition, or `null` when the queue does not exist. */
  getQueue(name: string): Promise<unknown | null>;

  /** Shut the pg-boss instance down. */
  stop(options?: PgBossStopOptions): Promise<void>;
}
