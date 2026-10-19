import type { Result } from "@comity/primitives/result";

import type { QueueError } from "../errors/queue.js";

import type { QueueJobData, QueueJobHandler } from "./job.js";
import type { QueueName } from "./queue.js";

/**
 * Registration of a handler for one queue.
 *
 * @typeParam TData - Shape of the payload consumed by the handler.
 */
export interface QueueWorkerConfig<TData extends QueueJobData = QueueJobData> {
  /** The queue this worker consumes. */
  readonly queue: QueueName;

  /** The handler invoked for each delivered job. */
  readonly handler: QueueJobHandler<TData>;
}

/**
 * Owns consumption of one queue. Created by an adapter, owned by the Application.
 *
 * @remarks
 * The worker does not start, schedule, or poll anything on its own; the
 * Application owns its lifecycle (ADR-028 D1).
 */
export interface QueueWorker {
  /**
   * Enables job consumption.
   *
   * @remarks
   * Never rejects. Resolves with `lifecycle_failed` when consumption could not
   * begin, or with `invalid_lifecycle_state` when the worker is already
   * running or has already stopped.
   */
  start(): Promise<Result<void, QueueError>>;

  /**
   * Prevents accepting additional work, allows in-flight handler invocations to
   * settle, and resolves after they settle.
   *
   * @remarks
   * Idempotent: calling `stop()` on a worker that is still in `created` state or
   * already `stopped` succeeds. Never rejects. On failure, neither half of that
   * guarantee is confirmed; see the shutdown failure semantics. The core does
   * not promise forcible termination or a universal shutdown timeout; that is
   * technology-specific.
   */
  stop(): Promise<Result<void, QueueError>>;
}
