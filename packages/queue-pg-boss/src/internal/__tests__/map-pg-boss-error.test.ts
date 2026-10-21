import { describe, expect, it } from "vitest";
import {
  handlerFailedError,
  invalidLifecycleStateError,
  mapEnqueueError,
  mapFactoryError,
  mapLifecycleError,
  unknownQueueError,
} from "../map-pg-boss-error.js";

function codedError(code: string): Error {
  return Object.assign(new Error(`simulated ${code}`), { code });
}

function reasonOf(error: Error): string {
  return (error as { readonly meta: { readonly reason: string } }).meta.reason;
}

function detailsOf(error: Error): Record<string, unknown> {
  return (error as { readonly meta: { readonly details: Record<string, unknown> } }).meta.details;
}

describe("mapEnqueueError", () => {
  it("should map a missing pg-boss queue to unknown_queue", () => {
    const error = mapEnqueueError(codedError("PGBOSS_QUEUE_NOT_FOUND"));

    expect(reasonOf(error)).toBe("unknown_queue");
    expect(detailsOf(error)["operation"]).toBe("enqueue");
    expect(detailsOf(error)["adapter"]).toBe("pg-boss");
  });

  it("should map a missing job table to unknown_queue", () => {
    expect(reasonOf(mapEnqueueError(codedError("42P01")))).toBe("unknown_queue");
  });

  it("should map credential and permission failures to invalid_configuration", () => {
    expect(reasonOf(mapEnqueueError(codedError("28P01")))).toBe("invalid_configuration");
    expect(reasonOf(mapEnqueueError(codedError("3D000")))).toBe("invalid_configuration");
    expect(reasonOf(mapEnqueueError(codedError("42501")))).toBe("invalid_configuration");
  });

  it("should map a unique violation to enqueue_rejected", () => {
    expect(reasonOf(mapEnqueueError(codedError("23505")))).toBe("enqueue_rejected");
  });

  it("should map a missing dead-letter target to invalid_configuration", () => {
    expect(reasonOf(mapEnqueueError(codedError("23503")))).toBe("invalid_configuration");
  });

  it("should map rollback-class failures to enqueue_rejected with a retriable hint", () => {
    for (const state of ["40001", "40P01"]) {
      const error = mapEnqueueError(codedError(state));

      expect(reasonOf(error)).toBe("enqueue_rejected");
      expect(detailsOf(error)["retriable"]).toBe(true);
    }
  });

  it("should map data and constraint errors to invalid_request", () => {
    for (const state of ["22P02", "22001", "23502", "23514"]) {
      expect(reasonOf(mapEnqueueError(codedError(state)))).toBe("invalid_request");
    }
  });

  it("should map pg-boss argument assertions to invalid_request", () => {
    const error = Object.assign(new Error("bad arguments"), { name: "AssertionError" });

    expect(reasonOf(mapEnqueueError(error))).toBe("invalid_request");
  });

  it("should report every connection failure as enqueue_outcome_unknown", () => {
    // A connection error is not proof that nothing was sent: the insert may have
    // committed before the socket failed.
    for (const code of [
      "ECONNREFUSED",
      "ECONNRESET",
      "ETIMEDOUT",
      "EPIPE",
      "ENOTFOUND",
      "EAI_AGAIN",
      "57P01",
      "57014",
      "53300",
    ]) {
      const error = mapEnqueueError(codedError(code));

      expect(reasonOf(error)).toBe("enqueue_outcome_unknown");
      expect(detailsOf(error)["retriable"]).toBeUndefined();
    }
  });

  it("should default unrecognised errors to enqueue_outcome_unknown", () => {
    expect(reasonOf(mapEnqueueError(new Error("unexpected")))).toBe("enqueue_outcome_unknown");
    expect(reasonOf(mapEnqueueError("not an error"))).toBe("enqueue_outcome_unknown");
  });

  it("should not mistake a five-letter errno for a SQLSTATE", () => {
    expect(reasonOf(mapEnqueueError(codedError("EPIPE")))).toBe("enqueue_outcome_unknown");
    expect(reasonOf(mapEnqueueError(codedError("EPERM")))).toBe("enqueue_outcome_unknown");
  });
});

describe("lifecycle and factory mapping", () => {
  it("should map start/stop failures to lifecycle_failed with the operation", () => {
    const start = mapLifecycleError(new Error("boom"), "start");
    const stop = mapLifecycleError(new Error("boom"), "stop");

    expect(reasonOf(start)).toBe("lifecycle_failed");
    expect(detailsOf(start)["operation"]).toBe("start");
    expect(reasonOf(stop)).toBe("lifecycle_failed");
    expect(detailsOf(stop)["operation"]).toBe("stop");
  });

  it("should map a missing queue during lifecycle operations to unknown_queue", () => {
    const error = mapLifecycleError(codedError("PGBOSS_QUEUE_NOT_FOUND"), "start");

    expect(reasonOf(error)).toBe("unknown_queue");
    expect(detailsOf(error)["operation"]).toBe("start");
  });

  it("should map initialization failures to invalid_configuration", () => {
    expect(reasonOf(mapFactoryError(new Error("bad config")))).toBe("invalid_configuration");
    expect(reasonOf(mapFactoryError(codedError("PGBOSS_QUEUE_NOT_FOUND")))).toBe("unknown_queue");
  });
});

describe("constructed errors", () => {
  it("should normalize handler failures with execute metadata", () => {
    const error = handlerFailedError(new Error("handler exploded"));

    expect(reasonOf(error)).toBe("handler_failed");
    expect(detailsOf(error)["operation"]).toBe("execute");
    expect(error.cause).toBeInstanceOf(Error);
  });

  it("should never put the cause in the public message", () => {
    const secret = "postgres://user:password@host/db";
    const error = handlerFailedError(new Error(secret));

    expect(error.message).not.toContain("password");
  });

  it("should mark lifecycle misuse without operation metadata leaking elsewhere", () => {
    const error = invalidLifecycleStateError("start");

    expect(reasonOf(error)).toBe("invalid_lifecycle_state");
    expect(detailsOf(error)["operation"]).toBe("start");
    expect(detailsOf(error)["adapter"]).toBe("pg-boss");
  });

  it("should report unknown queue for enqueue", () => {
    const error = unknownQueueError("enqueue");

    expect(reasonOf(error)).toBe("unknown_queue");
    expect(detailsOf(error)["operation"]).toBe("enqueue");
  });
});
