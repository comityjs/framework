import type { QueueErrorReason } from "../queue.js";

import { describe, expect, expectTypeOf, it } from "vitest";
import { QueueError } from "../queue.js";

/**
 * The eight reasons ratified by ADR-028 D3.
 *
 * `satisfies` rejects a listed reason the union no longer contains, and the
 * `expectTypeOf` assertion in the vocabulary test rejects a union member this
 * list does not contain. Together they keep the public union and the ratified
 * vocabulary in step.
 */
const REASONS = [
  "invalid_configuration",
  "invalid_request",
  "unknown_queue",
  "enqueue_rejected",
  "enqueue_outcome_unknown",
  "handler_failed",
  "lifecycle_failed",
  "invalid_lifecycle_state",
] as const satisfies readonly QueueErrorReason[];

describe("QueueError", () => {
  it("should construct an error for every reason in the union", () => {
    for (const reason of REASONS) {
      const error = new QueueError(reason);

      expect(error).toBeInstanceOf(QueueError);
      expect(error.code).toBe(`queue:${reason}`);
      expect(error.meta.reason).toBe(reason);
      expect(typeof error.message).toBe("string");
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it("should carry a machine-readable code derived from the reason", () => {
    const error = new QueueError("handler_failed");

    expect(error.code).toBe("queue:handler_failed");
    expect(error.meta.reason).toBe("handler_failed");
  });

  it("should accept optional metadata", () => {
    const cause = new Error("underlying cause");
    const error = new QueueError("enqueue_outcome_unknown", {
      httpStatus: 503,
      cause,
      details: {
        adapter: "test-adapter",
        operation: "enqueue",
        retriable: true,
      },
    });

    expect(error.meta.httpStatus).toBe(503);
    expect(error.cause).toBe(cause);
    expect(error.meta.details?.adapter).toBe("test-adapter");
    expect(error.meta.details?.operation).toBe("enqueue");
    expect(error.meta.details?.retriable).toBe(true);
  });

  it("should default httpStatus to 500 when not supplied", () => {
    const error = new QueueError("unknown_queue");

    expect(error.meta.httpStatus).toBe(500);
  });

  it("should produce Result-compatible failures", () => {
    const error = new QueueError("invalid_request");
    const failure = { success: false, error } as const;

    expect(failure.success).toBe(false);
    expect(failure.error).toBe(error);
    expect(failure.error.code).toBe("queue:invalid_request");
  });

  it("should expose exactly the eight ratified reasons", () => {
    expectTypeOf<(typeof REASONS)[number]>().toEqualTypeOf<QueueErrorReason>();

    expect(REASONS).toHaveLength(8);
    expect(new Set(REASONS).size).toBe(8);
  });

  it("should expose a stable class name", () => {
    expect(new QueueError("invalid_request").name).toBe("QueueError");
  });

  it("should freeze metadata to prevent mutation", () => {
    const error = new QueueError("invalid_request", {
      details: { operation: "enqueue" },
    });

    expect(Object.isFrozen(error.meta)).toBe(true);
    expect(() => {
      (error.meta as { httpStatus?: number }).httpStatus = 200;
    }).toThrow();
  });

  it("should keep publication and execution outcomes distinct", () => {
    const rejected = new QueueError("enqueue_rejected", {
      details: { operation: "enqueue", retriable: true },
    });
    const indeterminate = new QueueError("enqueue_outcome_unknown", {
      details: { operation: "enqueue", retriable: true },
    });
    const executionFailed = new QueueError("handler_failed", {
      details: { operation: "execute" },
    });

    const reasons = [
      rejected.meta.reason,
      indeterminate.meta.reason,
      executionFailed.meta.reason,
    ];

    expect(new Set(reasons).size).toBe(3);
    expect(rejected.code).toBe("queue:enqueue_rejected");
    expect(indeterminate.code).toBe("queue:enqueue_outcome_unknown");
    expect(executionFailed.code).toBe("queue:handler_failed");
  });

  it("should classify by reason, not by diagnostic details", () => {
    const retriable = new QueueError("enqueue_outcome_unknown", {
      details: { retriable: true },
    });
    const nonRetriable = new QueueError("enqueue_outcome_unknown", {
      details: { retriable: false },
    });

    expect(retriable.meta.reason).toBe("enqueue_outcome_unknown");
    expect(nonRetriable.meta.reason).toBe("enqueue_outcome_unknown");
    expect(retriable.code).toBe(nonRetriable.code);
  });
});
