import type { Result } from "@comity/primitives/result";
import type { QueueAcceptedJob, QueueJobData, QueueName, QueueProducer } from "@comity/queue";
import type { QueueError } from "@comity/queue/errors";
import type { PgBossPort } from "../internal/port.js";

import { failure, success } from "@comity/primitives/result";
import {
  clientClosedError,
  enqueueRejectedError,
  invalidRequestError,
  mapEnqueueError,
  unknownQueueError,
} from "../internal/map-pg-boss-error.js";

/** Dependencies of the producer. Internal. */
export interface ProducerDeps {
  /** pg-boss operations. */
  readonly port: PgBossPort;

  /** Names of the queues the adapter is configured for. */
  readonly queueNames: ReadonlySet<string>;

  /** Whether the client has been closed. */
  readonly isClosed: () => boolean;
}

/**
 * A payload must be a plain object that survives JSON serialization.
 *
 * @param value - Payload supplied by the caller
 *
 * @returns True for a serializable plain object
 *
 * @remarks
 * Comity types the payload as `Record<string, unknown>`, which is compile-time
 * only. pg-boss serializes with `JSON.stringify`, so a circular value or a
 * non-object reaches the database as an opaque failure; rejecting it here keeps
 * the failure deterministic and side-effect free.
 */
function isSerializablePayload(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  try {
    return JSON.stringify(value) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Create the pg-boss-backed producer.
 *
 * @param deps - Port, configured queue names, and close state
 *
 * @returns A producer that never rejects
 *
 * @remarks
 * `enqueue` never rejects. A `null` from pg-boss is a confirmed non-insertion;
 * every failure the adapter cannot attribute to a rolled-back statement is
 * reported as `enqueue_outcome_unknown`.
 */
export function createPgBossProducer(deps: ProducerDeps): QueueProducer {
  return {
    /** @inheritdoc */
    async enqueue<TData extends QueueJobData>(
      name: QueueName,
      data: TData
    ): Promise<Result<QueueAcceptedJob, QueueError>> {
      try {
        if (deps.isClosed()) {
          return failure(clientClosedError());
        }

        if (!deps.queueNames.has(name)) {
          return failure(unknownQueueError("enqueue"));
        }

        if (!isSerializablePayload(data)) {
          return failure(invalidRequestError());
        }

        const id = await deps.port.send(name, data);

        if (id === null) {
          return failure(enqueueRejectedError());
        }

        return success({ id });
      } catch (error) {
        return failure(mapEnqueueError(error));
      }
    },
  };
}
