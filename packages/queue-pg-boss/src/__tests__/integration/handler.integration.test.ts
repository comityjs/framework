import { failure } from "@comity/primitives/result";
import { QueueError } from "@comity/queue/errors";
import { afterAll, expect, it } from "vitest";
import {
  createTestClient,
  deleteQueues,
  describeIntegration,
  expectSuccess,
  uniqueQueue,
  waitFor,
} from "./helpers.js";

const created: string[] = [];

function newQueue(label: string): string {
  const name = uniqueQueue(label);
  created.push(name);

  return name;
}

afterAll(async () => {
  await deleteQueues(created);
});

describeIntegration("handler semantics against PostgreSQL", () => {
  it("should settle a handler that returns normally", async () => {
    const queue = newQueue("ok");
    const client = await createTestClient([{ name: queue }]);
    let calls = 0;
    const worker = client.createWorker({
      queue,
      handler: async () => {
        calls += 1;
      },
    });

    expectSuccess(await worker.start());
    expectSuccess(await client.producer.enqueue(queue, { id: "ok" }));

    await waitFor(() => calls === 1);
    await client.close();

    expect(calls).toBe(1);
  });

  it("should report a thrown handler as handler_failed and let pg-boss retry", async () => {
    const queue = newQueue("throw");
    const failures: string[] = [];
    let calls = 0;
    const client = await createTestClient([{ name: queue, retryLimit: 1, retryDelay: 0 }], {
      onHandlerFailed: (error) => {
        failures.push(error.meta.reason);
      },
    });
    const worker = client.createWorker({
      queue,
      handler: async () => {
        calls += 1;
        throw new Error("handler exploded");
      },
    });

    expectSuccess(await worker.start());
    expectSuccess(await client.producer.enqueue(queue, { id: "throw" }));

    await waitFor(() => calls >= 2, 10_000);
    await client.close();

    expect(failures.every((reason) => reason === "handler_failed")).toBe(true);
  });

  it("should treat a failure Result like a thrown error", async () => {
    const queue = newQueue("result");
    const failures: string[] = [];
    let calls = 0;
    const client = await createTestClient([{ name: queue, retryLimit: 0 }], {
      onHandlerFailed: (error) => {
        failures.push(error.meta.reason);
      },
    });
    const worker = client.createWorker({
      queue,
      handler: async () => {
        calls += 1;

        return failure(new QueueError("invalid_request"));
      },
    });

    expectSuccess(await worker.start());
    expectSuccess(await client.producer.enqueue(queue, { id: "result" }));

    await waitFor(() => calls === 1 && failures.length === 1);
    await client.close();

    expect(failures).toEqual(["handler_failed"]);
  });

  it("should keep stop waiting for a handler that outlived expireInSeconds", async () => {
    const queue = newQueue("overrun");
    const client = await createTestClient([
      { name: queue, expireInSeconds: 1, retryLimit: 0, retryDelay: 0 },
    ]);
    let handlerFinished = false;
    let started = false;
    const worker = client.createWorker({
      queue,
      handler: async () => {
        started = true;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        handlerFinished = true;
      },
    });

    expectSuccess(await worker.start());
    expectSuccess(await client.producer.enqueue(queue, { id: "overrun" }));
    await waitFor(() => started);

    const startedAt = Date.now();
    const result = await worker.stop();
    const elapsed = Date.now() - startedAt;

    expectSuccess(result);
    expect(handlerFinished).toBe(true);
    // pg-boss's own wait ends at expireInSeconds; the adapter's tracker is what
    // keeps stop() pending for the remaining handler time.
    expect(elapsed).toBeGreaterThan(1_000);

    await client.close();
  });

  it("should not resolve stop for a handler that never settles", async () => {
    const queue = newQueue("never");
    const client = await createTestClient([{ name: queue }]);
    let release: (() => void) | undefined;
    let started = false;
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
    expectSuccess(await client.producer.enqueue(queue, { id: "never" }));
    await waitFor(() => started);

    const stop = worker.stop();
    const outcome = await Promise.race([
      stop.then(() => "stopped"),
      new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 500)),
    ]);

    expect(outcome).toBe("pending");

    release?.();
    expectSuccess(await stop);
    await client.close();
  });

  it("should allow a retry after an expired attempt", async () => {
    const queue = newQueue("retry");
    const client = await createTestClient([
      { name: queue, expireInSeconds: 1, retryLimit: 1, retryDelay: 0 },
    ]);
    let attempts = 0;
    const worker = client.createWorker({
      queue,
      handler: async () => {
        attempts += 1;
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      },
    });

    expectSuccess(await worker.start());
    expectSuccess(await client.producer.enqueue(queue, { id: "retry" }));

    await waitFor(() => attempts >= 2, 15_000);
    await client.close();

    expect(attempts).toBeGreaterThanOrEqual(2);
    // 1 s expiry + 1.5 s handler + retry polling + the retry handler exceeds
    // Vitest's 5 s default; the wait itself is deliberately multi-second.
  }, 30_000);
});
