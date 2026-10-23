import type { PgBossPort } from "../../internal/port.js";

import { describe, expect, it } from "vitest";
import { createClientFromPort } from "../../client/create-client.js";

interface SendResult {
  readonly id: string | null;
  readonly error?: unknown;
}

class ProducerPort implements PgBossPort {
  sendCalls = 0;
  result: SendResult = { id: "job-1" };

  async send(): Promise<string | null> {
    this.sendCalls += 1;

    if (this.result.error !== undefined) {
      throw this.result.error;
    }

    return this.result.id;
  }

  async work(): Promise<string> {
    return "worker-1";
  }

  async offWork(): Promise<void> {
    // no-op
  }

  async getQueue(): Promise<unknown | null> {
    return { name: "jobs" };
  }

  async stop(): Promise<void> {
    // no-op
  }
}

function createProducer(port: ProducerPort) {
  return createClientFromPort(port, {
    connection: "postgres://localhost/comity_test",
    queues: [{ name: "jobs" }],
  }).producer;
}

function codedError(code: string): Error {
  return Object.assign(new Error(`simulated ${code}`), { code });
}

describe("producer.enqueue", () => {
  it("should return the accepted job id", async () => {
    const port = new ProducerPort();

    const result = await createProducer(port).enqueue("jobs", { to: "user@example.com" });

    expect(result.success).toBe(true);
    expect(result.success && result.value).toEqual({ id: "job-1" });
  });

  it("should reject an unconfigured queue without calling pg-boss", async () => {
    const port = new ProducerPort();

    const result = await createProducer(port).enqueue("other", { to: "user@example.com" });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.meta.reason).toBe("unknown_queue");
    expect(port.sendCalls).toBe(0);
  });

  it("should map a null result to enqueue_rejected", async () => {
    const port = new ProducerPort();
    port.result = { id: null };

    const result = await createProducer(port).enqueue("jobs", { to: "user@example.com" });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.meta.reason).toBe("enqueue_rejected");
    expect(result.success === false && result.error.meta.details?.operation).toBe("enqueue");
  });

  it("should reject a non-object payload before publication", async () => {
    const port = new ProducerPort();

    const result = await createProducer(port).enqueue("jobs", [1, 2, 3] as never);

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.meta.reason).toBe("invalid_request");
    expect(port.sendCalls).toBe(0);
  });

  it("should reject a circular payload before publication", async () => {
    const port = new ProducerPort();
    const payload: Record<string, unknown> = {};
    payload["self"] = payload;

    const result = await createProducer(port).enqueue("jobs", payload);

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.meta.reason).toBe("invalid_request");
    expect(port.sendCalls).toBe(0);
  });

  it("should map a missing queue reported by pg-boss to unknown_queue", async () => {
    const port = new ProducerPort();
    port.result = { id: null, error: codedError("PGBOSS_QUEUE_NOT_FOUND") };

    const result = await createProducer(port).enqueue("jobs", { value: 1 });

    expect(result.success === false && result.error.meta.reason).toBe("unknown_queue");
  });

  it("should report a connection reset as enqueue_outcome_unknown, never rejected", async () => {
    const port = new ProducerPort();
    port.result = { id: null, error: codedError("ECONNRESET") };

    const result = await createProducer(port).enqueue("jobs", { value: 1 });

    expect(result.success === false && result.error.meta.reason).toBe("enqueue_outcome_unknown");
    expect(result.success === false && result.error.meta.details?.retriable).toBeUndefined();
  });

  it("should report an unrecognised failure as enqueue_outcome_unknown", async () => {
    const port = new ProducerPort();
    port.result = { id: null, error: new Error("unexpected") };

    const result = await createProducer(port).enqueue("jobs", { value: 1 });

    expect(result.success === false && result.error.meta.reason).toBe("enqueue_outcome_unknown");
  });

  it("should classify a unique violation as enqueue_rejected", async () => {
    const port = new ProducerPort();
    port.result = { id: null, error: codedError("23505") };

    const result = await createProducer(port).enqueue("jobs", { value: 1 });

    expect(result.success === false && result.error.meta.reason).toBe("enqueue_rejected");
  });

  it("should classify a constraint failure as invalid_request", async () => {
    const port = new ProducerPort();
    port.result = { id: null, error: codedError("23514") };

    const result = await createProducer(port).enqueue("jobs", { value: 1 });

    expect(result.success === false && result.error.meta.reason).toBe("invalid_request");
  });

  it("should mark a rolled-back serialization failure as retriable", async () => {
    const port = new ProducerPort();
    port.result = { id: null, error: codedError("40001") };

    const result = await createProducer(port).enqueue("jobs", { value: 1 });

    expect(result.success === false && result.error.meta.reason).toBe("enqueue_rejected");
    expect(result.success === false && result.error.meta.details?.retriable).toBe(true);
  });

  it("should never retry an ambiguous publication", async () => {
    const port = new ProducerPort();
    port.result = { id: null, error: codedError("ETIMEDOUT") };

    await createProducer(port).enqueue("jobs", { value: 1 });

    expect(port.sendCalls).toBe(1);
  });

  it("should keep payload and connection detail out of the public message", async () => {
    const port = new ProducerPort();
    port.result = {
      id: null,
      error: Object.assign(new Error("postgres://user:password@host/db failed"), {
        code: "ECONNRESET",
      }),
    };

    const result = await createProducer(port).enqueue("jobs", { secret: "payload-value" });

    expect(result.success).toBe(false);

    if (result.success === false) {
      expect(result.error.message).not.toContain("password");
      expect(result.error.message).not.toContain("payload-value");
    }
  });
});
