import type { Result } from "@comity/primitives/result";
import type { QueueError } from "../errors/queue.js";
import type { QueueName } from "./queue.js";

/**
 * Identifies a job within its queue.
 *
 * @remarks
 * Opaque. Assigned by the queue technology. Uniqueness is guaranteed at most
 * within the queue that assigned it, and only to the extent the technology
 * documents. Applications MUST NOT parse it, assume any format, or assume
 * global uniqueness.
 */
export type QueueJobId = string;

/**
 * Opaque job payload.
 *
 * @remarks
 * The Core carries it; it does not interpret or validate it. Shape validation
 * is the consumer's responsibility, performed with its own tools, at its own
 * boundary.
 */
export type QueueJobData = Record<string, unknown>;

/**
 * A publication the queue technology accepted.
 */
export interface QueueAcceptedJob {
  /** Identifier assigned by the technology. */
  readonly id: QueueJobId;
}

/**
 * A job as delivered to a handler.
 *
 * @typeParam TData - Shape of the payload carried by this job.
 */
export interface QueueJob<TData extends QueueJobData = QueueJobData> {
  /** Identifier assigned by the technology. */
  readonly id: QueueJobId;

  /** The queue the job was delivered from. */
  readonly name: QueueName;

  /** The payload, round-tripped through the technology's serializer. */
  readonly data: TData;
}

/**
 * Handler invoked for each delivered job.
 *
 * @remarks
 * A handler that returns normally settles the job. A handler that throws, or
 * returns a failure `Result`, produces no unhandled rejection; the attempt is
 * reported to the technology as failed and normalized to
 * `QueueError("handler_failed")`.
 */
export type QueueJobHandler<TData extends QueueJobData = QueueJobData> = (
  job: QueueJob<TData>
) => void | Promise<void> | Result<void, QueueError> | Promise<Result<void, QueueError>>;
