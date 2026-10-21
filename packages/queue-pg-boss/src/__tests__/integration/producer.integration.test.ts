import type { PgBossQueuePolicy } from "../../client/types.js";
import type { PgBossJobLike, PgBossPort } from "../../internal/port.js";

import { PgBoss } from "pg-boss";
import { afterAll, expect, it } from "vitest";
import { createClientFromPort } from "../../client/create-client.js";
import {
  createTestClient,
  databaseUrl,
  deleteQueues,
  describeIntegration,
  expectSuccess,
  uniqueQueue,
  waitFor,
} from "./helpers.js";

const queue = uniqueQueue("producer");
const deliveryQueue = uniqueQueue("payload");
const refusalQueue = uniqueQueue("refusal");
const SUPPORTED_POLICIES: readonly PgBossQueuePolicy[] = [
  "standard",
  "short",
  "singleton",
  "stately",
  "exclusive",
];
const policyQueues = SUPPORTED_POLICIES.map((policy) => ({
  policy,
  name: uniqueQueue(`policy_${policy}`),
}));

afterAll(async () => {
  await deleteQueues([queue, deliveryQueue, refusalQueue, ...policyQueues.map(({ name }) => name)]);
});

describeIntegration("producer.enqueue against PostgreSQL", () => {
  it("should publish a job and return an opaque identifier", async () => {
    const client = await createTestClient([{ name: queue }]);

    const accepted = expectSuccess(
      await client.producer.enqueue(queue, { to: "user@example.com" })
    );

    expect(typeof accepted.id).toBe("string");
    expect(accepted.id.length).toBeGreaterThan(0);

    await client.close();
  });

  it("should deliver the published payload unchanged", async () => {
    // A dedicated queue: the previous test intentionally leaves its job queued
    // (no worker consumed it), so a shared queue would deliver that stale job.
    const client = await createTestClient([{ name: deliveryQueue }]);
    const received: unknown[] = [];
    const worker = client.createWorker({
      queue: deliveryQueue,
      handler: async (job) => {
        received.push(job.data);
      },
    });

    expectSuccess(await worker.start());
    expectSuccess(
      await client.producer.enqueue(deliveryQueue, { to: "user@example.com", count: 2 })
    );

    await waitFor(() => received.length === 1);

    expect(received[0]).toEqual({ to: "user@example.com", count: 2 });

    await client.close();
  });

  it("should reject an unconfigured queue without touching the backend", async () => {
    const client = await createTestClient([{ name: queue }]);

    const result = await client.producer.enqueue(uniqueQueue("unconfigured"), { value: 1 });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.meta.reason).toBe("unknown_queue");

    await client.close();
  });

  it("should report unknown_queue after the queue is deleted", async () => {
    const deleted = uniqueQueue("deleted");
    const client = await createTestClient([{ name: deleted }]);

    await deleteQueues([deleted]);

    const result = await client.producer.enqueue(deleted, { value: 1 });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.meta.reason).toBe("unknown_queue");

    await client.close();
  });

  it("should reject a non-serializable payload before publication", async () => {
    const client = await createTestClient([{ name: queue }]);

    const result = await client.producer.enqueue(queue, [1, 2, 3] as never);

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.meta.reason).toBe("invalid_request");

    await client.close();
  });

  it("should map an exclusive-policy refusal to enqueue_rejected", async () => {
    // pg-boss 12's `singleton` index covers only active jobs, so a second
    // created job is accepted. `exclusive` covers created and active jobs, so an
    // enqueue while the first job runs is a real refusal (send resolves null).
    const client = await createTestClient([{ name: refusalQueue, policy: "exclusive" }]);
    let started = false;
    let release: (() => void) | undefined;
    const worker = client.createWorker({
      queue: refusalQueue,
      handler: async () => {
        started = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    });

    expectSuccess(await worker.start());
    expectSuccess(await client.producer.enqueue(refusalQueue, { id: "first" }));
    await waitFor(() => started);

    const second = await client.producer.enqueue(refusalQueue, { id: "second" });

    expect(second.success).toBe(false);
    expect(second.success === false && second.error.meta.reason).toBe("enqueue_rejected");

    release?.();
    await client.close();
  });

  it("should enqueue and process a job under every supported policy", async () => {
    for (const { name, policy } of policyQueues) {
      const client = await createTestClient([{ name, policy }]);
      const received: unknown[] = [];
      const worker = client.createWorker({
        queue: name,
        handler: async (job) => {
          received.push(job.data);
        },
      });

      expectSuccess(await worker.start());
      expectSuccess(await client.producer.enqueue(name, { policy }));

      await waitFor(() => received.length === 1);

      expect(received[0]).toEqual({ policy });

      await client.close();
    }
  }, 60_000);
});

describeIntegration("publication ambiguity against PostgreSQL", () => {
  it("should report enqueue_outcome_unknown when the insert commits but the reply is lost", async () => {
    if (databaseUrl === undefined) {
      throw new Error("TEST_DATABASE_URL is required");
    }

    const ambiguousQueue = uniqueQueue("ambiguous");
    const boss = new PgBoss(databaseUrl);

    await boss.start();
    await boss.createQueue(ambiguousQueue);

    // Fault injection: the real INSERT runs, then the call rejects with a
    // connection error. This preserves the real database effect and simulates
    // only the lost acknowledgement.
    const port: PgBossPort = {
      send: async (name, data) => {
        await boss.send(name, data);
        throw Object.assign(new Error("connection lost after dispatch"), {
          code: "ECONNRESET",
        });
      },
      work: (name, options, handler) =>
        boss.work(name, options, async (jobs: readonly PgBossJobLike[]) => {
          await handler(jobs);
        }),
      offWork: (name, options) => boss.offWork(name, options),
      getQueue: (name) => boss.getQueue(name),
      stop: (options) => boss.stop(options),
    };

    const client = createClientFromPort(port, {
      connection: databaseUrl,
      queues: [{ name: ambiguousQueue }],
    });

    const result = await client.producer.enqueue(ambiguousQueue, { id: "committed" });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.meta.reason).toBe("enqueue_outcome_unknown");

    const jobs = await boss.findJobs(ambiguousQueue);

    expect(jobs).toHaveLength(1);

    await client.close();
    await boss.stop({ graceful: false });
    await deleteQueues([ambiguousQueue]);
  });
});
