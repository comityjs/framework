import { afterAll, expect, it } from "vitest";
import { createPgBossQueueClient } from "../../client/create-client.js";
import {
  createTestClient,
  databaseUrl,
  deleteQueues,
  describeIntegration,
  expectSuccess,
  uniqueQueue,
} from "./helpers.js";

const queue = uniqueQueue("conformance");

afterAll(async () => {
  await deleteQueues([queue]);
});

describeIntegration("contract conformance against PostgreSQL", () => {
  it("should never reject enqueue, start, or stop", async () => {
    const client = await createTestClient([{ name: queue }]);
    const worker = client.createWorker({ queue, handler: async () => undefined });

    await expect(client.producer.enqueue(queue, { ok: true })).resolves.toBeDefined();
    await expect(worker.start()).resolves.toBeDefined();
    await expect(worker.start()).resolves.toBeDefined();
    await expect(worker.stop()).resolves.toBeDefined();
    await expect(worker.stop()).resolves.toBeDefined();
    await expect(client.producer.enqueue(uniqueQueue("absent"), {})).resolves.toBeDefined();

    await client.close();
  });

  it("should report invalid_configuration for unusable configuration", async () => {
    const result = await createPgBossQueueClient({
      connection: "   ",
      queues: [{ name: queue }],
    });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.meta.reason).toBe("invalid_configuration");
  });

  it("should report invalid_lifecycle_state for a duplicate start and a post-stop start", async () => {
    const client = await createTestClient([{ name: queue }]);
    const worker = client.createWorker({ queue, handler: async () => undefined });

    expectSuccess(await worker.start());

    const duplicate = await worker.start();

    expect(duplicate.success === false && duplicate.error.meta.reason).toBe(
      "invalid_lifecycle_state"
    );

    expectSuccess(await worker.stop());

    const restart = await worker.start();

    expect(restart.success === false && restart.error.meta.reason).toBe("invalid_lifecycle_state");

    await client.close();
  });

  it("should report unknown_queue rather than a technology error", async () => {
    const client = await createTestClient([{ name: queue }]);

    const result = await client.producer.enqueue(uniqueQueue("unknown"), { value: 1 });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.meta.reason).toBe("unknown_queue");
    expect(result.success === false && result.error.code).toBe("queue:unknown_queue");

    await client.close();
  });

  it("should return from enqueue without waiting for execution", async () => {
    const client = await createTestClient([{ name: queue }]);

    const startedAt = Date.now();
    const accepted = expectSuccess(await client.producer.enqueue(queue, { value: 1 }));
    const elapsed = Date.now() - startedAt;

    expect(accepted.id.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2_000);

    await client.close();
  });

  it("should skip the suite when no test database is configured", () => {
    if (databaseUrl === undefined) {
      expect(databaseUrl).toBeUndefined();
    }
  });
});
