import type { Result } from "@comity/primitives/result";
import type {
  QueueJobData,
  QueueJobId,
  QueueName,
  QueueProducer,
  QueueWorker,
  QueueWorkerConfig,
} from "@comity/queue";
import type { QueueError } from "@comity/queue/errors";

/**
 * Queue policies pg-boss defines.
 *
 * @remarks
 * Adapter-specific. `standard`, `short`, `singleton`, `stately`, and `exclusive`
 * are accepted. `key_strict_fifo` is declared for pg-boss parity but rejected by
 * configuration validation: pg-boss requires a per-job `singletonKey` for that
 * policy, and the portable producer has no way to supply one. Passing any other
 * accepted policy changes publication semantics: `short`, `singleton`, `stately`
 * and `exclusive` can refuse an insert, which the adapter reports as
 * `enqueue_rejected`.
 */
export type PgBossQueuePolicy =
  "standard" | "short" | "singleton" | "stately" | "exclusive" | "key_strict_fifo";

/**
 * One queue the adapter knows about.
 *
 * @remarks
 * The list of definitions is the adapter's answer to "which queues exist".
 * A name outside it is rejected with `unknown_queue` without touching the
 * database. Options are applied only when the queue is first created: pg-boss
 * `createQueue` does not update an existing queue, so changing a definition
 * does not rewrite the database configuration.
 */
export interface PgBossQueueDefinition {
  /** Queue name. Opaque to Comity; validated against pg-boss's name rules. */
  readonly name: QueueName;

  /** Queue policy. Defaults to pg-boss's `standard`. */
  readonly policy?: PgBossQueuePolicy;

  /** Retries after a failed attempt. Adapter-specific; not portable. */
  readonly retryLimit?: number;

  /** Delay between retries, in seconds. Adapter-specific. */
  readonly retryDelay?: number;

  /** Exponential backoff for retries. Adapter-specific. */
  readonly retryBackoff?: boolean;

  /** Maximum backoff delay, in seconds. Adapter-specific. */
  readonly retryDelayMax?: number;

  /** Seconds a job may stay active before pg-boss considers its attempt failed. */
  readonly expireInSeconds?: number;

  /** Seconds a queued job is retained. */
  readonly retentionSeconds?: number;

  /** Seconds a completed job is retained. `0` keeps it indefinitely. */
  readonly deleteAfterSeconds?: number;

  /** Dead letter queue name. It must exist before it is referenced. */
  readonly deadLetter?: QueueName;

  /** Give the queue its own partition table. */
  readonly partition?: boolean;
}

/**
 * PostgreSQL connection settings.
 *
 * @remarks
 * Structural subset of pg-boss's connection options. No pg-boss type appears in
 * this package's public API.
 */
export interface PgBossConnection {
  /** Full connection string. Takes precedence over the discrete fields. */
  readonly connectionString?: string;

  /** Database host. */
  readonly host?: string;

  /** Database port. */
  readonly port?: number;

  /** Database name. */
  readonly database?: string;

  /** Database user. */
  readonly user?: string;

  /** Database password. */
  readonly password?: string;

  /** Maximum pool connections. */
  readonly max?: number;

  /** TLS settings. */
  readonly ssl?:
    | boolean
    | {
        /** Whether to reject unauthorized certificates. */
        readonly rejectUnauthorized?: boolean;
      };
}

/**
 * A job whose handler failed.
 *
 * @remarks
 * Adapter-specific diagnostic value passed to `onHandlerFailed`.
 */
export interface PgBossFailedJob {
  /** Identifier assigned by pg-boss. */
  readonly id: QueueJobId;

  /** Queue the job was delivered from. */
  readonly name: QueueName;
}

/**
 * Client configuration.
 *
 * @remarks
 * Configuration errors are returned as `invalid_configuration`, never thrown.
 */
export interface PgBossQueueClientConfig {
  /** Connection string or discrete connection settings. */
  readonly connection: string | PgBossConnection;

  /** PostgreSQL schema pg-boss installs into. Defaults to pg-boss's own default. */
  readonly schema?: string;

  /** Queues the adapter knows about. At least one is required. */
  readonly queues: readonly PgBossQueueDefinition[];

  /**
   * Create configured queues during initialization.
   *
   * @defaultValue true
   */
  readonly provisionQueues?: boolean;

  /**
   * Upper bound, in milliseconds, for the pg-boss shutdown performed by
   * `close()` after every worker has drained.
   *
   * @defaultValue 30000
   */
  readonly shutdownTimeoutMs?: number;

  /**
   * Called when a handler fails.
   *
   * @remarks
   * Non-portable observability hook. The attempt is reported to pg-boss as a
   * failed attempt regardless of whether this hook is supplied. Exceptions
   * thrown by the hook are ignored so they cannot affect job settlement.
   */
  readonly onHandlerFailed?: (error: QueueError, job: PgBossFailedJob) => void;

  /**
   * Called for pg-boss `error` events.
   *
   * @remarks
   * Non-portable. Worker polling errors — including a queue deleted after
   * startup — are emitted here by pg-boss rather than surfacing from `start()`.
   * The adapter always installs a pg-boss `error` listener, whether or not this
   * callback is supplied: an unhandled `error` event would throw. Without the
   * callback those errors are consumed, because the portable contract has no
   * reporting channel. If the callback throws or returns a rejected promise,
   * the failure is ignored so it cannot affect the client or the process.
   */
  readonly onBackendError?: (error: Error) => void;
}

/**
 * Worker options.
 *
 * @remarks
 * Adapter-specific. The portable contract exposes no worker options.
 */
export interface PgBossWorkerOptions {
  /** Base polling interval, in seconds. pg-boss requires at least 0.5. */
  readonly pollingIntervalSeconds?: number;
}

/**
 * A configured pg-boss client.
 *
 * @remarks
 * The producer and every worker are bound to the client's queue definitions.
 * `close()` is adapter-specific teardown (ADR-028 D9), not a portable operation.
 */
export interface PgBossQueueClient {
  /** Publishes jobs through pg-boss. */
  readonly producer: QueueProducer;

  /**
   * Create a worker for a configured queue.
   *
   * @throws Error when the client is closing or already closed
   *
   * @remarks
   * Construction is synchronous and performs no I/O. A worker created before
   * `close()` starts is owned by the client and drained during shutdown. Once
   * shutdown has begun, construction throws: a worker created after the close
   * barrier could otherwise run outside it. An unknown queue name yields a
   * worker whose `start()` returns `unknown_queue`.
   */
  createWorker<TData extends QueueJobData>(
    config: QueueWorkerConfig<TData>,
    options?: PgBossWorkerOptions
  ): QueueWorker;

  /**
   * Stop every worker and shut pg-boss down.
   *
   * @remarks
   * Non-portable. Workers are stopped first, through the same drain path as
   * `QueueWorker.stop()`; pg-boss is closed only afterwards. Repeated calls
   * return the first outcome. Once `close()` has started, `createWorker()`
   * throws, so no worker created concurrently can escape the drain.
   */
  close(): Promise<Result<void, QueueError>>;
}
