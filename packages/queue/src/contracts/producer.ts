import type { Result } from "@comity/primitives/result";
import type { QueueError } from "../errors/queue.js";
import type { QueueAcceptedJob, QueueJobData } from "./job.js";
import type { QueueName } from "./queue.js";

/**
 * A service that publishes jobs to a named queue.
 *
 * @remarks
 * `enqueue` never rejects; failures are reported as `Result` failures carrying
 * `QueueError`. Acceptance by the technology is a contract success; a confirmed
 * non-acceptance is `enqueue_rejected`; an indeterminate outcome (timeout or
 * connection loss with unknown persistence state) is
 * `enqueue_outcome_unknown`.
 */
export interface QueueProducer {
  /**
   * Publish a job to a named queue.
   *
   * @typeParam TData - Shape of the payload being published.
   *
   * @param name - Queue to publish to.
   * @param data - Payload to publish.
   *
   * @returns A promise resolving to a `Result` containing the accepted job.
   */
  enqueue<TData extends QueueJobData>(
    name: QueueName,
    data: TData
  ): Promise<Result<QueueAcceptedJob, QueueError>>;
}
