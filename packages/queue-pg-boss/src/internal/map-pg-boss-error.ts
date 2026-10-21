import type { QueueErrorReason } from "@comity/queue/errors";

import { QueueError } from "@comity/queue/errors";

/** Adapter identifier recorded in every `QueueErrorMeta.details`. */
export const ADAPTER_NAME = "pg-boss";

/** Code pg-boss attaches when a queue row does not exist. */
const QUEUE_NOT_FOUND_CODE = "PGBOSS_QUEUE_NOT_FOUND";

/** Operation recorded in `details.operation`. */
type Operation = "enqueue" | "execute" | "start" | "stop";

/** Optional fields of a constructed queue error. */
interface QueueErrorOptions {
  /** Operation that failed. */
  readonly operation?: Operation;

  /** Non-canonical retriability hint. */
  readonly retriable?: boolean;

  /** Underlying failure, kept for diagnostics. */
  readonly cause?: unknown;
}

/**
 * Construct a `QueueError` with adapter metadata.
 *
 * @param reason - Canonical queue error reason
 * @param options - Optional operation, retriability, and cause
 *
 * @returns A queue error carrying `adapter: "pg-boss"`
 */
function toQueueError(reason: QueueErrorReason, options: QueueErrorOptions = {}): QueueError {
  const details: {
    /** Operation that failed. */
    operation?: Operation;
    /** Adapter identifier. */
    adapter: string;
    /** Non-canonical retriability hint. */
    retriable?: boolean;
  } = { adapter: ADAPTER_NAME };

  if (options.operation !== undefined) {
    details.operation = options.operation;
  }

  if (options.retriable !== undefined) {
    details.retriable = options.retriable;
  }

  if (options.cause !== undefined) {
    return new QueueError(reason, { details, cause: options.cause });
  }

  return new QueueError(reason, { details });
}

/**
 * Read an unknown value as a property bag.
 *
 * @param error - Value to inspect
 *
 * @returns The object form, or `null` for primitives
 */
function errorRecord(error: unknown): Record<string, unknown> | null {
  return typeof error === "object" && error !== null ? (error as Record<string, unknown>) : null;
}

/**
 * Whether an error carries a specific `code` value.
 *
 * @param error - Value to inspect
 * @param code - Code to compare
 *
 * @returns True when the value carries the code
 *
 * @remarks
 * pg-boss uses plain `Error` objects with a `code` property rather than a
 * dedicated error class hierarchy.
 */
export function hasErrorCode(error: unknown, code: string): boolean {
  return errorRecord(error)?.["code"] === code;
}

/**
 * Extract a PostgreSQL SQLSTATE from an error.
 *
 * @param error - Value to inspect
 *
 * @returns The SQLSTATE, or `null` when the value carries none
 *
 * @remarks
 * Node's own errno codes (`EPIPE`, `EPERM`, …) are five uppercase letters and
 * would otherwise look like SQLSTATEs. Real PostgreSQL states always contain a
 * digit, so one is required.
 */
export function sqlState(error: unknown): string | null {
  const code = errorRecord(error)?.["code"];

  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) && /\d/.test(code) ? code : null;
}

/**
 * Whether an error came from a Node assertion.
 *
 * @param error - Value to inspect
 *
 * @returns True for an `AssertionError`
 */
function isAssertionError(error: unknown): boolean {
  return error instanceof Error && error.name === "AssertionError";
}

/**
 * Map a publication failure to a queue error.
 *
 * @param error - Failure raised by pg-boss or the driver
 *
 * @returns The classified queue error
 *
 * @remarks
 * The rule is conservative by construction: only outcomes that provably did not
 * insert a row are classified as `enqueue_rejected`. Everything else — every
 * connection or network failure, every unrecognised error — is
 * `enqueue_outcome_unknown`, because the adapter cannot prove that the insert
 * did not commit.
 *
 * SQLSTATEs are returned by the server, so they prove the statement ran and
 * failed; a failed statement rolls its transaction back.
 */
export function mapEnqueueError(error: unknown): QueueError {
  if (hasErrorCode(error, QUEUE_NOT_FOUND_CODE)) {
    return toQueueError("unknown_queue", { operation: "enqueue", cause: error });
  }

  const state = sqlState(error);

  if (state !== null) {
    const errorClass = state.slice(0, 2);

    if (state === "42P01") {
      return toQueueError("unknown_queue", { operation: "enqueue", cause: error });
    }

    if (state === "42501" || state === "3D000" || state === "28P01") {
      return toQueueError("invalid_configuration", { operation: "enqueue", cause: error });
    }

    if (state === "23505") {
      return toQueueError("enqueue_rejected", { operation: "enqueue", cause: error });
    }

    if (state === "23503") {
      return toQueueError("invalid_configuration", { operation: "enqueue", cause: error });
    }

    // Serialization failure and deadlock roll the transaction back; retrying the
    // same publication is safe.
    if (errorClass === "40") {
      return toQueueError("enqueue_rejected", {
        operation: "enqueue",
        retriable: true,
        cause: error,
      });
    }

    if (errorClass === "22" || errorClass === "23") {
      return toQueueError("invalid_request", { operation: "enqueue", cause: error });
    }
  }

  // pg-boss validates its own arguments before touching the database.
  if (isAssertionError(error)) {
    return toQueueError("invalid_request", { operation: "enqueue", cause: error });
  }

  return toQueueError("enqueue_outcome_unknown", { operation: "enqueue", cause: error });
}

/**
 * Map a failure raised while registering or stopping a worker.
 *
 * @param error - Failure raised by pg-boss
 * @param operation - Lifecycle operation that failed
 *
 * @returns `unknown_queue` or `lifecycle_failed` with the operation recorded
 */
export function mapLifecycleError(error: unknown, operation: "start" | "stop"): QueueError {
  if (hasErrorCode(error, QUEUE_NOT_FOUND_CODE)) {
    return toQueueError("unknown_queue", { operation, cause: error });
  }

  return toQueueError("lifecycle_failed", { operation, cause: error });
}

/**
 * Map a failure raised while initializing or closing the client.
 *
 * @param error - Failure raised by pg-boss
 *
 * @returns `unknown_queue` or `invalid_configuration`
 */
export function mapFactoryError(error: unknown): QueueError {
  if (hasErrorCode(error, QUEUE_NOT_FOUND_CODE)) {
    return toQueueError("unknown_queue", { cause: error });
  }

  return toQueueError("invalid_configuration", { cause: error });
}

/**
 * Build the normalized error for a handler failure.
 *
 * @param cause - Thrown value or failure `Result` error
 *
 * @returns A `handler_failed` error
 */
export function handlerFailedError(cause: unknown): QueueError {
  return toQueueError("handler_failed", { operation: "execute", cause });
}

/**
 * Queue name absent from the adapter's configured set.
 *
 * @param operation - Operation that named the queue
 *
 * @returns An `unknown_queue` error
 */
export function unknownQueueError(operation: "enqueue" | "start"): QueueError {
  return toQueueError("unknown_queue", { operation });
}

/**
 * Rejected request detected before publication is attempted.
 *
 * @returns An `invalid_request` error
 */
export function invalidRequestError(): QueueError {
  return toQueueError("invalid_request", { operation: "enqueue" });
}

/**
 * Configuration rejected by the adapter or by pg-boss initialization.
 *
 * @param cause - Optional underlying failure
 *
 * @returns An `invalid_configuration` error
 */
export function invalidConfigurationError(cause?: unknown): QueueError {
  return cause === undefined
    ? toQueueError("invalid_configuration")
    : toQueueError("invalid_configuration", { cause });
}

/**
 * Operation not permitted by the worker's current lifecycle state.
 *
 * @param operation - Refused operation
 *
 * @returns An `invalid_lifecycle_state` error
 */
export function invalidLifecycleStateError(operation: "start" | "stop"): QueueError {
  return toQueueError("invalid_lifecycle_state", { operation });
}

/**
 * Client already closed; no further operations are accepted.
 *
 * @returns An `invalid_configuration` error
 */
export function clientClosedError(): QueueError {
  return toQueueError("invalid_configuration");
}

/**
 * pg-boss confirmed that publication inserted no row.
 *
 * @returns An `enqueue_rejected` error
 */
export function enqueueRejectedError(): QueueError {
  return toQueueError("enqueue_rejected", { operation: "enqueue" });
}

/**
 * A configured queue is absent from the database at initialization.
 *
 * @returns An `unknown_queue` error
 */
export function unknownQueueConfigurationError(): QueueError {
  return toQueueError("unknown_queue");
}
