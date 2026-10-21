import type { Result } from "@comity/primitives/result";
import type { QueueJobData, QueueProducer, QueueWorker, QueueWorkerConfig } from "@comity/queue";
import type { QueueError } from "@comity/queue/errors";
import type { Queue } from "pg-boss";
import type { PgBossJobLike, PgBossPort } from "../internal/port.js";
import type { WorkerDeps } from "../worker/create-worker.js";
import type {
  PgBossFailedJob,
  PgBossQueueClient,
  PgBossQueueClientConfig,
  PgBossQueueDefinition,
  PgBossWorkerOptions,
} from "./types.js";

import { failure, success } from "@comity/primitives/result";
import { PgBoss } from "pg-boss";
import {
  mapFactoryError,
  mapLifecycleError,
  unknownQueueConfigurationError,
} from "../internal/map-pg-boss-error.js";
import { validateClientConfig } from "../internal/validate-config.js";
import { createPgBossProducer } from "../producer/create-producer.js";
import { createPgBossQueueWorker } from "../worker/create-worker.js";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;

/**
 * Whether a value is thenable.
 *
 * @param value - Value to inspect
 *
 * @returns True for an object or function with a `then` method
 */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

/**
 * Forward one pg-boss backend error to the optional observer.
 *
 * @param observer - Optional backend-error observer
 * @param error - Error emitted by pg-boss
 *
 * @remarks
 * The listener that calls this function is always installed. Node throws
 * `ERR_UNHANDLED_ERROR` when an `error` event has no listener, so installing
 * one only when an observer exists would turn a backend failure into a
 * process-level failure. A fault in the observer — a synchronous throw or a
 * rejected promise — is contained here for the same reason.
 */
function forwardBackendError(observer: ((error: Error) => void) | undefined, error: Error): void {
  if (observer === undefined) {
    return;
  }

  try {
    const observed: unknown = observer(error);

    if (isPromiseLike(observed)) {
      void Promise.resolve(observed).catch(() => undefined);
    }
  } catch {
    // An observer must never affect the client or the host process.
  }
}

/** Queue options accepted by pg-boss `createQueue`, without the name. */
type QueueOptions = Omit<Queue, "name">;

/**
 * Translate adapter connection settings into pg-boss constructor options.
 *
 * @param config - Client configuration
 *
 * @returns Options accepted by the pg-boss constructor
 */
function toConstructorOptions(
  config: PgBossQueueClientConfig
): ConstructorParameters<typeof PgBoss>[0] {
  const connection =
    typeof config.connection === "string"
      ? { connectionString: config.connection }
      : config.connection;

  return config.schema === undefined ? connection : { ...connection, schema: config.schema };
}

/**
 * Translate one queue definition into pg-boss queue options.
 *
 * @param definition - Configured queue
 *
 * @returns Options accepted by `createQueue`
 */
function toQueueOptions(definition: PgBossQueueDefinition): QueueOptions {
  const options: QueueOptions = {};

  if (definition.policy !== undefined) {
    options.policy = definition.policy;
  }

  if (definition.retryLimit !== undefined) {
    options.retryLimit = definition.retryLimit;
  }

  if (definition.retryDelay !== undefined) {
    options.retryDelay = definition.retryDelay;
  }

  if (definition.retryBackoff !== undefined) {
    options.retryBackoff = definition.retryBackoff;
  }

  if (definition.retryDelayMax !== undefined) {
    options.retryDelayMax = definition.retryDelayMax;
  }

  if (definition.expireInSeconds !== undefined) {
    options.expireInSeconds = definition.expireInSeconds;
  }

  if (definition.retentionSeconds !== undefined) {
    options.retentionSeconds = definition.retentionSeconds;
  }

  if (definition.deleteAfterSeconds !== undefined) {
    options.deleteAfterSeconds = definition.deleteAfterSeconds;
  }

  if (definition.deadLetter !== undefined) {
    options.deadLetter = definition.deadLetter;
  }

  if (definition.partition !== undefined) {
    options.partition = definition.partition;
  }

  return options;
}

/**
 * Adapt a pg-boss instance to the internal port.
 *
 * @param boss - Started pg-boss instance
 *
 * @returns The port the client depends on
 */
function toPort(boss: PgBoss): PgBossPort {
  return {
    /** @inheritdoc */
    send: (name, data) => boss.send(name, data),
    /** @inheritdoc */
    work: (name, options, handler) =>
      boss.work(
        name,
        options,
        /** @param jobs - Jobs delivered by pg-boss */
        async (jobs: readonly PgBossJobLike[]) => {
          await handler(jobs);
        }
      ),
    /** @inheritdoc */
    offWork: (name, options) => boss.offWork(name, options),
    /** @inheritdoc */
    getQueue: (name) => boss.getQueue(name),
    /** @inheritdoc */
    stop: (options) => boss.stop(options),
  };
}

/**
 * Shut down an instance whose initialization failed.
 *
 * @param boss - Partially initialized pg-boss instance
 */
async function stopQuietly(boss: PgBoss): Promise<void> {
  try {
    await boss.stop({ graceful: false });
  } catch {
    // Initialization already failed; the original error is the one reported.
  }
}

/**
 * Default {@link PgBossQueueClient}.
 *
 * @remarks
 * Internal. Owns the producer, the workers it created, and client teardown.
 */
class PgBossQueueClientImpl implements PgBossQueueClient {
  readonly producer: QueueProducer;
  readonly #port: PgBossPort;
  readonly #queueNames: ReadonlySet<string>;
  readonly #shutdownTimeoutMs: number;
  readonly #onHandlerFailed: ((error: QueueError, job: PgBossFailedJob) => void) | undefined;
  readonly #workers = new Set<QueueWorker>();

  #closed = false;
  #closePromise: Promise<Result<void, QueueError>> | null = null;
  #closeResult: Result<void, QueueError> | null = null;

  constructor(port: PgBossPort, config: PgBossQueueClientConfig) {
    this.#port = port;
    this.#queueNames = new Set(config.queues.map((definition) => definition.name));
    this.#shutdownTimeoutMs = config.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.#onHandlerFailed = config.onHandlerFailed;

    this.producer = createPgBossProducer({
      port,
      queueNames: this.#queueNames,
      /**
       * Reports whether the client has been closed.
       *
       * @returns True once `close()` has started
       */
      isClosed: () => this.#closed,
    });
  }

  /**
   * Create a worker bound to a configured queue.
   *
   * @typeParam TData - Shape of the payload consumed by the handler
   *
   * @param config - Queue and handler registration
   * @param options - Adapter-specific worker options
   *
   * @returns A worker that performs no I/O until `start()`
   *
   * @throws Error when the client is closing or already closed
   *
   * @remarks
   * Construction is synchronous and performs no I/O. A worker created before
   * `close()` starts is owned by the client and drained during shutdown; once
   * shutdown has begun no new worker is accepted, because it could otherwise
   * run outside the close barrier. An unknown queue name yields a worker whose
   * `start()` returns `unknown_queue`.
   */
  createWorker<TData extends QueueJobData>(
    config: QueueWorkerConfig<TData>,
    options: PgBossWorkerOptions = {}
  ): QueueWorker {
    if (this.#closed) {
      throw new Error(
        "@comity/queue-pg-boss: cannot create a worker once the client is closing or closed"
      );
    }

    const deps: WorkerDeps =
      this.#onHandlerFailed === undefined
        ? { port: this.#port, queueNames: this.#queueNames }
        : {
            port: this.#port,
            queueNames: this.#queueNames,
            onHandlerFailed: this.#onHandlerFailed,
          };

    const worker = createPgBossQueueWorker(deps, config, options);

    this.#workers.add(worker);

    return worker;
  }

  /**
   * Stop owned workers, then close pg-boss.
   *
   * @returns Success only when every worker drained and the backend closed
   */
  close(): Promise<Result<void, QueueError>> {
    if (this.#closePromise !== null) {
      return this.#closePromise;
    }

    const closePromise = this.#close().finally(() => {
      if (this.#closePromise === closePromise) {
        this.#closePromise = null;
      }
    });

    this.#closePromise = closePromise;

    return closePromise;
  }

  /**
   * Perform the single client shutdown.
   *
   * @returns The first worker or backend failure, or success
   */
  async #close(): Promise<Result<void, QueueError>> {
    if (this.#closed) {
      return this.#closeResult ?? success(undefined);
    }

    this.#closed = true;

    let closeError: QueueError | null = null;

    // createWorker() refuses once #closed is set, so the set cannot grow while
    // this loop awaits: every worker the client can ever own is already here.
    for (const worker of this.#workers) {
      const result = await worker.stop();

      if (!result.success && closeError === null) {
        closeError = result.error;
      }
    }

    try {
      // Only after every worker has drained: the instance-level timeout cannot
      // abandon a handler that a successful worker stop already covered.
      await this.#port.stop({
        graceful: true,
        timeout: this.#shutdownTimeoutMs,
      });
    } catch (error) {
      if (closeError === null) {
        closeError = mapLifecycleError(error, "stop");
      }
    }

    this.#closeResult = closeError === null ? success(undefined) : failure(closeError);

    return this.#closeResult;
  }
}

/**
 * Build a client over an existing pg-boss port.
 *
 * @param port - pg-boss operations to use
 * @param config - Validated client configuration
 *
 * @returns A client that never performs I/O until an operation is invoked
 *
 * @remarks
 * Internal. Used by the public factory and by the deterministic lifecycle
 * tests; not exported from the package.
 */
export function createClientFromPort(
  port: PgBossPort,
  config: PgBossQueueClientConfig
): PgBossQueueClient {
  return new PgBossQueueClientImpl(port, config);
}

/**
 * Create a pg-boss-backed client.
 *
 * @param config - Connection, schema, and queue definitions
 *
 * @returns A ready client, or `invalid_configuration` / `unknown_queue`
 *
 * @remarks
 * Validates the configuration, starts pg-boss (which runs its migrations),
 * provisions configured queues when `provisionQueues` is not `false`, and
 * verifies that each configured queue exists.
 *
 * Failure is reported as a `Result`; the factory never throws. Initialization
 * failures are `invalid_configuration`; a configured queue missing from the
 * database is `unknown_queue`.
 */
export async function createPgBossQueueClient(
  config: PgBossQueueClientConfig
): Promise<Result<PgBossQueueClient, QueueError>> {
  const configError = validateClientConfig(config);

  if (configError !== undefined) {
    return failure(configError);
  }

  let boss: PgBoss;

  try {
    boss = new PgBoss(toConstructorOptions(config));
  } catch (error) {
    return failure(mapFactoryError(error));
  }

  // Installed before start(): pg-boss emits backend errors on the instance, and
  // Node throws ERR_UNHANDLED_ERROR for an `error` event with no listener. The
  // listener is unconditional; without an observer it deliberately consumes
  // the event, because there is no portable reporting channel.
  boss.on("error", (error: Error) => {
    forwardBackendError(config.onBackendError, error);
  });

  try {
    await boss.start();

    if (config.provisionQueues !== false) {
      // Dead-letter targets must exist first: pg-boss resolves them when the
      // referring queue is created.
      const withoutDeadLetter = config.queues.filter((queue) => queue.deadLetter === undefined);
      const withDeadLetter = config.queues.filter((queue) => queue.deadLetter !== undefined);

      for (const definition of [...withoutDeadLetter, ...withDeadLetter]) {
        await boss.createQueue(definition.name, toQueueOptions(definition));
      }
    }

    for (const definition of config.queues) {
      const queue = await boss.getQueue(definition.name);

      if (queue === null) {
        await stopQuietly(boss);
        return failure(unknownQueueConfigurationError());
      }
    }
  } catch (error) {
    await stopQuietly(boss);
    return failure(mapFactoryError(error));
  }

  return success(createClientFromPort(toPort(boss), config));
}
