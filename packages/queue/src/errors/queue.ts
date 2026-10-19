import type { ErrorMeta } from "@comity/primitives/errors";

import { BaseError } from "@comity/primitives/errors";

/**
 * Finite set of machine-readable failure reasons.
 *
 * @remarks
 * Stable, finite set to prevent ambiguous classification. Adding a reason is a
 * MINOR version change; renaming or removing one is a MAJOR change.
 */
export type QueueErrorReason =
  | "invalid_configuration"
  | "invalid_request"
  | "unknown_queue"
  | "enqueue_rejected"
  | "enqueue_outcome_unknown"
  | "handler_failed"
  | "lifecycle_failed"
  | "invalid_lifecycle_state";

/**
 * Optional error metadata for queue failures.
 *
 * @remarks
 * `reason` is mandatory and must be stable. `details` is non-canonical: it MUST
 * NOT be used for application logic or branching, and MUST NOT contain
 * sensitive data.
 */
export interface QueueErrorMeta extends ErrorMeta {
  /** Canonical failure reason. */
  readonly reason: QueueErrorReason;

  /** Additional, non-canonical details for diagnostics. */
  readonly details?: Readonly<{
    /** The operation that failed. */
    operation?: "enqueue" | "execute" | "start" | "stop";

    /** Adapter name for diagnostics. */
    adapter?: string;

    /** Non-canonical retriability hint. Never use for application logic. */
    retriable?: boolean;
  }>;
}

const REASON_MESSAGES: Record<QueueErrorReason, string> = {
  invalid_configuration: "The queue adapter configuration is invalid",
  invalid_request: "The queue request is invalid",
  unknown_queue: "The queue does not exist",
  enqueue_rejected: "The queue technology rejected the publication",
  enqueue_outcome_unknown: "The outcome of the publication is unknown",
  handler_failed: "The queue handler failed to process the job",
  lifecycle_failed: "The queue worker lifecycle operation failed",
  invalid_lifecycle_state: "The queue worker is in an invalid lifecycle state",
};

/**
 * The queue module's single public error class.
 *
 * @remarks
 * Extends `BaseError`. The code has the form `queue:<reason>`. Failure
 * classification relies exclusively on `meta.reason`; the message is
 * diagnostic text and MUST NOT be used for branching.
 */
export class QueueError extends BaseError<QueueErrorMeta> {
  /** Machine-readable error code, in the form `queue:<reason>`. */
  readonly code: `queue:${QueueErrorReason}`;

  /**
   * @param reason - Canonical failure reason.
   * @param meta - Additional error metadata, including `httpStatus`, `cause`
   * and `details`. The `reason` property is reserved and supplied by this
   * constructor.
   */
  constructor(reason: QueueErrorReason, meta?: Omit<QueueErrorMeta, "reason">) {
    super(REASON_MESSAGES[reason], {
      httpStatus: 500,
      ...meta,
      reason,
    });

    this.code = `queue:${reason}`;
  }
}
