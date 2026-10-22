import type { Result } from "@comity/primitives/result";
import type {
  QueueJob,
  QueueJobData,
  QueueJobHandler,
  QueueName,
  QueueWorker,
  QueueWorkerConfig,
} from "@comity/queue";
import type { PgBossFailedJob, PgBossWorkerOptions } from "../client/types.js";
import type { PgBossJobLike, PgBossPort } from "../internal/port.js";

import { failure, success } from "@comity/primitives/result";
import { QueueError } from "@comity/queue/errors";
import { HandlerTracker } from "../internal/handler-tracker.js";
import {
  handlerFailedError,
  invalidLifecycleStateError,
  mapLifecycleError,
  unknownQueueError,
} from "../internal/map-pg-boss-error.js";

/** Result returned by every worker operation. */
type WorkerResult = Result<void, QueueError>;

/** Internal worker lifecycle states. */
type WorkerState = "created" | "starting" | "running" | "stopping" | "stopped" | "failed";

/** Dependencies of a worker. Internal. */
export interface WorkerDeps {
  /** pg-boss operations. */
  readonly port: PgBossPort;

  /** Names of the queues the adapter is configured for. */
  readonly queueNames: ReadonlySet<string>;

  /** Non-portable handler-failure observer. */
  readonly onHandlerFailed?: (error: QueueError, job: PgBossFailedJob) => void;
}

/**
 * Extract the error from a handler-returned failure `Result`.
 *
 * @param result - Value returned by the Comity handler
 *
 * @returns The failure error, or `null` when the handler did not fail
 *
 * @remarks
 * The core handler union allows `void | Result<void, QueueError>`; a returned
 * failure Result is a failed attempt, exactly like a thrown value.
 */
function failureErrorFrom(result: unknown): QueueError | Error | null {
  if (typeof result !== "object" || result === null) {
    return null;
  }

  const candidate = result as {
    /** Whether the result succeeded. */
    readonly success?: unknown;
    /** Failure value. */
    readonly error?: unknown;
  };

  if (candidate.success !== false) {
    return null;
  }

  return candidate.error instanceof Error
    ? candidate.error
    : new Error("handler returned a failure Result without an error");
}

/**
 * pg-boss-backed worker for one queue.
 *
 * @typeParam TData - Shape of the payload consumed by the handler
 *
 * @remarks
 * Internal. Serializes lifecycle transitions and owns the drain barrier.
 */
class PgBossQueueWorker<TData extends QueueJobData> implements QueueWorker {
  readonly #deps: WorkerDeps;
  readonly #queueName: QueueName;
  readonly #handler: QueueJobHandler<TData>;
  readonly #options: PgBossWorkerOptions;
  readonly #tracker = new HandlerTracker();

  #state: WorkerState = "created";
  #workerId: string | null = null;
  #startPromise: Promise<WorkerResult> | null = null;
  #stopPromise: Promise<WorkerResult> | null = null;
  #stopResult: WorkerResult | null = null;

  constructor(deps: WorkerDeps, config: QueueWorkerConfig<TData>, options: PgBossWorkerOptions) {
    this.#deps = deps;
    this.#queueName = config.queue;
    this.#handler = config.handler;
    this.#options = options;
  }

  /**
   * Enable consumption.
   *
   * @returns Success, `unknown_queue`, or `lifecycle_failed`
   */
  start(): Promise<WorkerResult> {
    if (this.#startPromise !== null) {
      return this.#startPromise;
    }

    if (this.#state !== "created") {
      return Promise.resolve(failure(invalidLifecycleStateError("start")));
    }

    this.#state = "starting";

    const startPromise = this.#start().finally(() => {
      if (this.#startPromise === startPromise) {
        this.#startPromise = null;
      }
    });

    this.#startPromise = startPromise;

    return startPromise;
  }

  /**
   * Perform the single start attempt.
   *
   * @returns The start outcome
   */
  async #start(): Promise<WorkerResult> {
    if (!this.#deps.queueNames.has(this.#queueName)) {
      this.#state = "created";
      return failure(unknownQueueError("start"));
    }

    try {
      const queue = await this.#deps.port.getQueue(this.#queueName);

      if (queue === null) {
        this.#state = "created";
        return failure(unknownQueueError("start"));
      }

      const workOptions =
        this.#options.pollingIntervalSeconds === undefined
          ? { batchSize: 1 }
          : { batchSize: 1, pollingIntervalSeconds: this.#options.pollingIntervalSeconds };

      this.#workerId = await this.#deps.port.work(this.#queueName, workOptions, this.#callback);
      this.#state = "running";

      return success(undefined);
    } catch (error) {
      this.#state = "created";
      this.#workerId = null;

      return failure(mapLifecycleError(error, "start"));
    }
  }

  /**
   * Stop consumption and drain in-flight handlers.
   *
   * @returns Success only when the backend stopped and every tracked handler settled
   */
  stop(): Promise<WorkerResult> {
    if (this.#state === "created") {
      this.#state = "stopped";
      this.#stopResult = success(undefined);

      return Promise.resolve(this.#stopResult);
    }

    if (this.#state === "stopped" || this.#state === "failed") {
      return Promise.resolve(this.#stopResult ?? failure(invalidLifecycleStateError("stop")));
    }

    if (this.#stopPromise !== null) {
      return this.#stopPromise;
    }

    const stopPromise = this.#stop().finally(() => {
      if (this.#stopPromise === stopPromise) {
        this.#stopPromise = null;
      }
    });

    this.#stopPromise = stopPromise;

    return stopPromise;
  }

  /**
   * Perform the single shutdown attempt.
   *
   * @returns The stop outcome
   */
  async #stop(): Promise<WorkerResult> {
    this.#state = "stopping";

    const starting = this.#startPromise;

    if (starting !== null) {
      const startResult = await starting;

      if (!startResult.success) {
        this.#state = "stopped";
        this.#stopResult = success(undefined);

        return this.#stopResult;
      }
    }

    const workerId = this.#workerId;

    if (workerId === null) {
      this.#state = "failed";
      this.#stopResult = failure(
        mapLifecycleError(new Error("worker started without a pg-boss worker id"), "stop")
      );

      return this.#stopResult;
    }

    try {
      // Stops polling for this worker only (never instance-wide `boss.stop()`).
      await this.#deps.port.offWork(this.#queueName, { id: workerId, wait: true });

      // pg-boss abandons a handler that outlived expireInSeconds; its `offWork`
      // resolves without it. Draining here is what makes `stop()` honest.
      await this.#tracker.drain();

      this.#state = "stopped";
      this.#stopResult = success(undefined);

      return this.#stopResult;
    } catch (error) {
      // Neither half of the two-phase guarantee is confirmed. The worker is not
      // reported as stopped and cannot be started again.
      this.#state = "failed";
      this.#stopResult = failure(mapLifecycleError(error, "stop"));

      return this.#stopResult;
    }
  }

  /**
   * pg-boss worker callback.
   *
   * @param jobs - Jobs delivered by pg-boss
   *
   * @remarks
   * Tracking is registered in the same synchronous turn as the callback
   * invocation, before the first `await`. pg-boss invokes this callback directly
   * inside its awaited run loop, so no other task — including `stop()` — can
   * observe an accepted job that is not tracked.
   */
  readonly #callback = async (jobs: readonly PgBossJobLike[]): Promise<void> => {
    const execution = this.#execute(jobs);

    this.#tracker.track(execution);

    await execution;
  };

  /**
   * Invoke the Comity handler for every delivered job.
   *
   * @param jobs - Jobs delivered in this batch
   *
   * @remarks
   * The batch is all-or-nothing at the pg-boss level, matching pg-boss's own
   * default settlement. With `batchSize: 1` a failure fails the single job.
   * The thrown error is sanitized because pg-boss persists it.
   */
  async #execute(jobs: readonly PgBossJobLike[]): Promise<void> {
    for (const job of jobs) {
      const coreJob: QueueJob<TData> = {
        id: String(job.id),
        name: job.name,
        data: job.data as TData,
      };

      let handlerError: QueueError | null = null;

      try {
        const result = await this.#handler(coreJob);
        const failureError = failureErrorFrom(result);

        if (failureError !== null) {
          handlerError = handlerFailedError(failureError);
        }
      } catch (cause) {
        handlerError = handlerFailedError(cause);
      }

      if (handlerError !== null) {
        this.#notifyHandlerFailure(handlerError, coreJob);
        // Sanitized on purpose: pg-boss persists a failed attempt's error, and
        // adapter diagnostics must not leak payload or connection detail. The
        // QueueError carries a static message and no cause.
        throw new QueueError("handler_failed", {
          details: { operation: "execute", adapter: "pg-boss" },
        });
      }
    }
  }

  /**
   * Report a handler failure to the optional observer.
   *
   * @param error - Normalized `handler_failed` error
   * @param job - Job whose handler failed
   */
  #notifyHandlerFailure(error: QueueError, job: QueueJob<TData>): void {
    try {
      this.#deps.onHandlerFailed?.(error, { id: job.id, name: job.name });
    } catch {
      // An observer must never affect job settlement or the drain barrier.
    }
  }
}

/**
 * Create a worker bound to one configured queue.
 *
 * @typeParam TData - Shape of the payload consumed by the handler
 *
 * @param deps - Port, configured queue names, and failure observer
 * @param config - Queue and handler registration
 * @param options - Adapter-specific worker options
 *
 * @returns A worker that performs no I/O until `start()`
 *
 * @remarks
 * Construction performs no I/O. An unknown queue name produces a worker whose
 * `start()` returns `unknown_queue`.
 */
export function createPgBossQueueWorker<TData extends QueueJobData>(
  deps: WorkerDeps,
  config: QueueWorkerConfig<TData>,
  options: PgBossWorkerOptions = {}
): QueueWorker {
  return new PgBossQueueWorker<TData>(deps, config, options);
}
