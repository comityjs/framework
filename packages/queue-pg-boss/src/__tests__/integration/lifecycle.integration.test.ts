import type { PgBossQueueClient } from "../../client/types.js";

import { afterAll, expect, it } from "vitest";
import {
  createTestClient,
  deleteQueues,
  describeIntegration,
  expectSuccess,
  uniqueQueue,
  waitFor,
} from "./helpers.js";

const queue = uniqueQueue("lifecycle");

async function newClient(): Promise<PgBossQueueClient> {
  return createTestClient([{ name: queue }]);
}

afterAll(async () => {
  await deleteQueues([queue]);
});

describeIntegration("worker lifecycle against PostgreSQL", () => {
  it("should start, reject a duplicate start, stop, and never restart", async () => {
    const client = await newClient();
    const worker = client.createWorker({ queue, handler: async () => undefined });

    expectSuccess(await worker.start());

    const duplicate = await worker.start();

    expect(duplicate.success).toBe(false);
    expect(duplicate.success === false && duplicate.error.meta.reason).toBe(
      "invalid_lifecycle_state"
    );

    expectSuccess(await worker.stop());

    const restart = await worker.start();

    expect(restart.success).toBe(false);
    expect(restart.success === false && restart.error.meta.reason).toBe("invalid_lifecycle_state");

    await client.close();
  });

  it("should stop successfully before start", async () => {
    const client = await newClient();
    const worker = client.createWorker({ queue, handler: async () => undefined });

    expectSuccess(await worker.stop());
    expectSuccess(await worker.stop());

    await client.close();
  });

  it("should stop repeatedly after running", async () => {
    const client = await newClient();
    const worker = client.createWorker({ queue, handler: async () => undefined });

    expectSuccess(await worker.start());
    expectSuccess(await worker.stop());
    expectSuccess(await worker.stop());

    await client.close();
  });

  it("should share one outcome between concurrent stops", async () => {
    const client = await newClient();
    const worker = client.createWorker({ queue, handler: async () => undefined });

    expectSuccess(await worker.start());

    const [first, second] = await Promise.all([worker.stop(), worker.stop()]);

    expect(first).toBe(second);

    await client.close();
  });

  it("should stop a worker whose start is still in flight", async () => {
    const client = await newClient();
    const worker = client.createWorker({ queue, handler: async () => undefined });

    const start = worker.start();
    const stop = worker.stop();

    expectSuccess(await start);
    expectSuccess(await stop);

    await client.close();
  });

  it("should refuse start while stopping", async () => {
    const client = await newClient();
    let releaseHandler: (() => void) | undefined;
    let handlerStarted = false;

    const worker = client.createWorker({
      queue,
      handler: async () => {
        handlerStarted = true;
        await new Promise<void>((resolve) => {
          releaseHandler = resolve;
        });
      },
    });

    expectSuccess(await worker.start());
    expectSuccess(await client.producer.enqueue(queue, { id: "held" }));

    await waitFor(() => handlerStarted);

    const stop = worker.stop();
    const start = await worker.start();

    expect(start.success).toBe(false);
    expect(start.success === false && start.error.meta.reason).toBe("invalid_lifecycle_state");

    releaseHandler?.();
    expectSuccess(await stop);

    await client.close();
  });

  it("should report unknown_queue when the configured queue was deleted", async () => {
    const missing = uniqueQueue("deleted");
    const client = await createTestClient([{ name: missing }]);

    await deleteQueues([missing]);

    const worker = client.createWorker({ queue: missing, handler: async () => undefined });
    const result = await worker.start();

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.meta.reason).toBe("unknown_queue");

    await client.close();
  });
});

describeIntegration("client close against PostgreSQL", () => {
  it("should close with no workers and repeat the first outcome", async () => {
    const client = await newClient();

    const first = await client.close();
    const second = await client.close();

    expectSuccess(first);
    expect(first).toBe(second);
  });

  it("should drain a running worker before closing", async () => {
    const client = await newClient();
    let started = false;
    let finished = false;
    let release: (() => void) | undefined;
    const worker = client.createWorker({
      queue,
      handler: async () => {
        started = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        finished = true;
      },
    });

    expectSuccess(await worker.start());
    expectSuccess(await client.producer.enqueue(queue, { id: "drain" }));

    // close() drains in-flight handlers; it does not promise to process a job
    // that is still queued. Wait until this handler is genuinely in flight.
    await waitFor(() => started);

    const closePromise = client.close();
    let settled = false;

    void closePromise.then(() => {
      settled = true;
    });

    await Promise.resolve();

    expect(settled).toBe(false);
    expect(finished).toBe(false);

    release?.();

    expectSuccess(await closePromise);
    expect(finished).toBe(true);
  });

  it("should reject worker creation while close drains an in-flight handler", async () => {
    const client = await newClient();
    let started = false;
    let release: (() => void) | undefined;
    const worker = client.createWorker({
      queue,
      handler: async () => {
        started = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });

    expectSuccess(await worker.start());
    expectSuccess(await client.producer.enqueue(queue, { id: "closing" }));
    await waitFor(() => started);

    const closePromise = client.close();

    expect(() => client.createWorker({ queue, handler: async () => undefined })).toThrow(
      /closing or closed/
    );

    release?.();

    expectSuccess(await closePromise);
  });

  it("should close while a worker is starting", async () => {
    const client = await newClient();
    const worker = client.createWorker({ queue, handler: async () => undefined });

    const start = worker.start();
    const close = client.close();

    expectSuccess(await start);
    expectSuccess(await close);
  });
});
