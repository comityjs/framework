import type { PgBossQueueClientConfig } from "../../client/types.js";
import type {
  PgBossJobLike,
  PgBossOffWorkOptions,
  PgBossPort,
  PgBossStopOptions,
  PgBossWorkOptions,
} from "../../internal/port.js";

import { failure } from "@comity/primitives/result";
import { QueueError } from "@comity/queue/errors";
import { describe, expect, it } from "vitest";
import { createClientFromPort } from "../../client/create-client.js";

interface Deferred<T = void> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;

  const promise = new Promise<T>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function job(id = "job-1"): PgBossJobLike {
  return { id, name: "jobs", data: { value: id } };
}

/**
 * Deterministic pg-boss test double.
 *
 * @remarks
 * Models the two behaviours the drain barrier depends on: the callback is
 * invoked directly, and `offWork` can resolve while a callback is still
 * running (what pg-boss does for a handler that outlived `expireInSeconds`).
 * It also refuses deliveries after `offWork`, matching pg-boss's stopped run
 * loop. It is not a substitute for the real-PostgreSQL suite.
 */
class FakePort implements PgBossPort {
  readonly queueNames = new Set(["jobs"]);
  readonly handlers = new Map<string, (jobs: readonly PgBossJobLike[]) => Promise<void>>();

  readonly offWorkCalls: Array<{
    readonly name: string;
    readonly id?: string;
    readonly wait?: boolean;
  }> = [];
  readonly workOptions: PgBossWorkOptions[] = [];

  sendCalls = 0;
  sendResult: string | null = "job-1";
  sendError: unknown = null;

  offWorkError: unknown = null;
  offWorkGate: Promise<void> | undefined = undefined;
  workGate: Promise<void> | undefined = undefined;
  stopGate: Promise<void> | undefined = undefined;

  stopCalls = 0;
  accepting = true;
  #nextWorker = 1;

  async send(): Promise<string | null> {
    this.sendCalls += 1;

    if (this.sendError !== null) {
      throw this.sendError;
    }

    return this.sendResult;
  }

  async work(
    name: string,
    options: PgBossWorkOptions,
    handler: (jobs: readonly PgBossJobLike[]) => Promise<void>
  ): Promise<string> {
    this.workOptions.push(options);

    if (this.workGate !== undefined) {
      await this.workGate;
    }

    this.handlers.set(name, handler);

    return `worker-${this.#nextWorker++}`;
  }

  async offWork(name: string, options: PgBossOffWorkOptions = {}): Promise<void> {
    this.offWorkCalls.push({ name, ...options });
    this.accepting = false;

    if (this.offWorkGate !== undefined) {
      await this.offWorkGate;
    }

    if (this.offWorkError !== null) {
      throw this.offWorkError;
    }
  }

  async getQueue(name: string): Promise<unknown | null> {
    return this.queueNames.has(name) ? { name } : null;
  }

  async stop(_options?: PgBossStopOptions): Promise<void> {
    this.stopCalls += 1;

    if (this.stopGate !== undefined) {
      await this.stopGate;
    }
  }

  deliver(name: string, jobs: readonly PgBossJobLike[] = [job()]): Promise<void> {
    if (!this.accepting) {
      return Promise.reject(new Error("delivery after offWork"));
    }

    const handler = this.handlers.get(name);

    if (handler === undefined) {
      return Promise.reject(new Error(`no handler for ${name}`));
    }

    return handler(jobs);
  }
}

function clientConfig(overrides: Partial<PgBossQueueClientConfig> = {}): PgBossQueueClientConfig {
  return {
    connection: "postgres://localhost/comity_test",
    queues: [{ name: "jobs" }],
    ...overrides,
  };
}

function createClient(port: FakePort, overrides: Partial<PgBossQueueClientConfig> = {}) {
  return createClientFromPort(port, clientConfig(overrides));
}

describe("worker lifecycle", () => {
  it("should start from created and apply batch size 1", async () => {
    const port = new FakePort();
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async () => undefined,
    });

    const result = await worker.start();

    expect(result.success).toBe(true);
    expect(port.workOptions).toEqual([{ batchSize: 1 }]);
  });

  it("should pass the polling interval through", async () => {
    const port = new FakePort();
    const worker = createClient(port).createWorker(
      { queue: "jobs", handler: async () => undefined },
      { pollingIntervalSeconds: 5 }
    );

    await worker.start();

    expect(port.workOptions).toEqual([{ batchSize: 1, pollingIntervalSeconds: 5 }]);
  });

  it("should reject a duplicate start while running", async () => {
    const port = new FakePort();
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async () => undefined,
    });

    await worker.start();
    const second = await worker.start();

    expect(second.success).toBe(false);
    expect(second.success === false && second.error.meta.reason).toBe("invalid_lifecycle_state");
  });

  it("should share one result between concurrent starts", async () => {
    const port = new FakePort();
    const gate = deferred();
    port.workGate = gate.promise;
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async () => undefined,
    });

    const first = worker.start();
    const second = worker.start();

    gate.resolve();

    expect(await first).toBe(await second);
  });

  it("should stop successfully before start without touching the backend", async () => {
    const port = new FakePort();
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async () => undefined,
    });

    const result = await worker.stop();

    expect(result.success).toBe(true);
    expect(port.offWorkCalls).toEqual([]);
  });

  it("should stop repeatedly with a stable success", async () => {
    const port = new FakePort();
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async () => undefined,
    });

    await worker.start();

    const first = await worker.stop();
    const second = await worker.stop();

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(port.offWorkCalls).toHaveLength(1);
  });

  it("should refuse start after stop", async () => {
    const port = new FakePort();
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async () => undefined,
    });

    await worker.start();
    await worker.stop();

    const restart = await worker.start();

    expect(restart.success).toBe(false);
    expect(restart.success === false && restart.error.meta.reason).toBe("invalid_lifecycle_state");
  });

  it("should refuse start while stopping", async () => {
    const port = new FakePort();
    const gate = deferred();
    port.offWorkGate = gate.promise;
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async () => undefined,
    });

    await worker.start();
    const stopPromise = worker.stop();
    const restart = await worker.start();

    expect(restart.success).toBe(false);
    expect(restart.success === false && restart.error.meta.reason).toBe("invalid_lifecycle_state");

    gate.resolve();
    await stopPromise;
  });

  it("should stop a worker whose start is still in flight", async () => {
    const port = new FakePort();
    const gate = deferred();
    port.workGate = gate.promise;
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async () => undefined,
    });

    const startPromise = worker.start();
    const stopPromise = worker.stop();

    gate.resolve();

    expect((await startPromise).success).toBe(true);
    expect((await stopPromise).success).toBe(true);
    expect(port.offWorkCalls).toHaveLength(1);
  });

  it("should stop only its own pg-boss worker", async () => {
    const port = new FakePort();
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async () => undefined,
    });

    await worker.start();
    await worker.stop();

    expect(port.offWorkCalls).toEqual([{ name: "jobs", id: "worker-1", wait: true }]);
  });

  it("should report unknown_queue when the queue is not configured", async () => {
    const port = new FakePort();
    const worker = createClient(port).createWorker({
      queue: "other",
      handler: async () => undefined,
    });

    const result = await worker.start();

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.meta.reason).toBe("unknown_queue");
    expect(port.handlers.size).toBe(0);
  });

  it("should report unknown_queue when the queue disappeared from the backend", async () => {
    const port = new FakePort();
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async () => undefined,
    });

    port.queueNames.delete("jobs");

    const result = await worker.start();

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.meta.reason).toBe("unknown_queue");
  });

  it("should report lifecycle_failed when worker registration fails", async () => {
    const port = new FakePort();
    port.work = async () => {
      throw new Error("database unavailable");
    };
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async () => undefined,
    });

    const result = await worker.start();

    expect(result.success).toBe(false);

    if (result.success === false) {
      expect(result.error.meta.reason).toBe("lifecycle_failed");
      expect(result.error.meta.details?.operation).toBe("start");
    }
  });
});

describe("drain barrier", () => {
  it("should not resolve stop before an in-flight handler completes", async () => {
    const port = new FakePort();
    const gate = deferred();
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async () => {
        await gate.promise;
      },
    });

    await worker.start();

    const delivery = port.deliver("jobs");
    const stopPromise = worker.stop();
    const outcome = await Promise.race([
      stopPromise.then(() => "stopped"),
      delay(10).then(() => "pending"),
    ]);

    expect(outcome).toBe("pending");

    gate.resolve();
    await delivery;

    expect((await stopPromise).success).toBe(true);
  });

  it("should wait for a handler that outlived the backend's wait window", async () => {
    // pg-boss's offWork resolves for an overrun handler; this fake reproduces
    // that by resolving offWork immediately while the callback is still running.
    const port = new FakePort();
    const gate = deferred();
    let handlerFinished = false;
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async () => {
        await gate.promise;
        handlerFinished = true;
      },
    });

    await worker.start();

    const delivery = port.deliver("jobs");
    const stopPromise = worker.stop();

    await delay(10);

    expect(port.offWorkCalls).toHaveLength(1);
    expect(handlerFinished).toBe(false);

    let settled = false;
    void stopPromise.then(() => {
      settled = true;
    });

    await delay(10);

    expect(settled).toBe(false);

    gate.resolve();
    await delivery;

    expect((await stopPromise).success).toBe(true);
    expect(handlerFinished).toBe(true);
  });

  it("should await every in-flight handler", async () => {
    const port = new FakePort();
    const gates = [deferred(), deferred(), deferred()];
    let completed = 0;
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async (delivered) => {
        const index = Number(delivered.id.replace("job-", "")) - 1;
        await gates[index]?.promise;
        completed += 1;
      },
    });

    await worker.start();

    const deliveries = [
      port.deliver("jobs", [job("job-1")]),
      port.deliver("jobs", [job("job-2")]),
      port.deliver("jobs", [job("job-3")]),
    ];

    const stopPromise = worker.stop();

    await delay(5);
    expect(completed).toBe(0);

    gates[0]?.resolve();
    gates[1]?.resolve();
    await delay(5);
    expect(completed).toBe(2);

    gates[2]?.resolve();
    await Promise.all(deliveries);

    expect((await stopPromise).success).toBe(true);
    expect(completed).toBe(3);
  });

  it("should keep tracking when a handler rejects", async () => {
    const port = new FakePort();
    const gate = deferred();
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async () => {
        await gate.promise;
        throw new Error("handler exploded");
      },
    });

    await worker.start();

    const delivery = port.deliver("jobs").catch(() => undefined);
    const stopPromise = worker.stop();

    gate.resolve();
    await delivery;

    expect((await stopPromise).success).toBe(true);
  });

  it("should share one outcome between concurrent stops", async () => {
    const port = new FakePort();
    const gate = deferred();
    port.offWorkGate = gate.promise;
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async () => undefined,
    });

    await worker.start();

    const first = worker.stop();
    const second = worker.stop();

    gate.resolve();

    expect(await first).toBe(await second);
    expect(port.offWorkCalls).toHaveLength(1);
  });

  it("should remain pending for a handler that never settles", async () => {
    const port = new FakePort();
    const gate = deferred();
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async () => {
        await gate.promise;
      },
    });

    await worker.start();

    const delivery = port.deliver("jobs");
    const stopPromise = worker.stop();

    const outcome = await Promise.race([
      stopPromise.then(() => "stopped"),
      delay(20).then(() => "pending"),
    ]);

    expect(outcome).toBe("pending");

    // Release so the test process does not retain the pending promise.
    gate.resolve();
    await delivery;
    await stopPromise;
  });

  it("should not report stopped when backend shutdown fails", async () => {
    const port = new FakePort();
    port.offWorkError = new Error("connection lost during shutdown");
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async () => undefined,
    });

    await worker.start();

    const result = await worker.stop();

    expect(result.success).toBe(false);

    if (result.success === false) {
      expect(result.error.meta.reason).toBe("lifecycle_failed");
      expect(result.error.meta.details?.operation).toBe("stop");
    }

    const repeated = await worker.stop();
    const restart = await worker.start();

    expect(repeated.success).toBe(false);
    expect(restart.success).toBe(false);
    expect(restart.success === false && restart.error.meta.reason).toBe("invalid_lifecycle_state");
  });

  it("should refuse further deliveries once stopped", async () => {
    const port = new FakePort();
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async () => undefined,
    });

    await worker.start();
    await worker.stop();

    await expect(port.deliver("jobs")).rejects.toThrow("delivery after offWork");
  });
});

describe("handler settlement", () => {
  it("should reject the backend callback with a sanitized error when the handler throws", async () => {
    const port = new FakePort();
    const failures: string[] = [];
    const worker = createClient(port, {
      onHandlerFailed: (error) => {
        failures.push(error.meta.reason);
      },
    }).createWorker({
      queue: "jobs",
      handler: async () => {
        throw new Error("secret detail");
      },
    });

    await worker.start();

    await expect(port.deliver("jobs")).rejects.toThrow("queue handler failed");
    expect(failures).toEqual(["handler_failed"]);
  });

  it("should treat a failure Result like a thrown error", async () => {
    const port = new FakePort();
    const normalized: QueueError[] = [];
    const worker = createClient(port, {
      onHandlerFailed: (error) => {
        normalized.push(error);
      },
    }).createWorker({
      queue: "jobs",
      handler: async () => failure(new QueueError("invalid_request")),
    });

    await worker.start();

    await expect(port.deliver("jobs")).rejects.toThrow("queue handler failed");
    expect(normalized[0]?.meta.reason).toBe("handler_failed");
    expect(normalized[0]?.meta.details?.operation).toBe("execute");
  });

  it("should ignore observer exceptions", async () => {
    const port = new FakePort();
    const worker = createClient(port, {
      onHandlerFailed: () => {
        throw new Error("observer exploded");
      },
    }).createWorker({
      queue: "jobs",
      handler: async () => {
        throw new Error("handler exploded");
      },
    });

    await worker.start();

    await expect(port.deliver("jobs")).rejects.toThrow("queue handler failed");
    expect((await worker.stop()).success).toBe(true);
  });

  it("should deliver the queue name, identifier, and payload to the handler", async () => {
    const port = new FakePort();
    const received: Array<{ id: string; name: string; data: unknown }> = [];
    const worker = createClient(port).createWorker({
      queue: "jobs",
      handler: async (delivered) => {
        received.push({ id: delivered.id, name: delivered.name, data: delivered.data });
      },
    });

    await worker.start();
    await port.deliver("jobs", [{ id: "abc", name: "jobs", data: { to: "user@example.com" } }]);

    expect(received).toEqual([{ id: "abc", name: "jobs", data: { to: "user@example.com" } }]);
  });
});

describe("client close", () => {
  it("should succeed with no workers and close the backend once", async () => {
    const port = new FakePort();
    const client = createClient(port);

    const result = await client.close();

    expect(result.success).toBe(true);
    expect(port.stopCalls).toBe(1);
  });

  it("should drain owned workers before closing the backend", async () => {
    const port = new FakePort();
    const order: string[] = [];
    const client = createClient(port);
    const worker = client.createWorker({ queue: "jobs", handler: async () => undefined });

    port.offWork = async () => {
      order.push("offWork");
    };

    const originalStop = port.stop.bind(port);
    port.stop = async () => {
      order.push("stop");
      await originalStop();
    };

    await worker.start();
    await client.close();

    expect(order).toEqual(["offWork", "stop"]);
  });

  it("should stop a worker whose start is in flight", async () => {
    const port = new FakePort();
    const gate = deferred();
    port.workGate = gate.promise;
    const client = createClient(port);
    const worker = client.createWorker({ queue: "jobs", handler: async () => undefined });

    const startPromise = worker.start();
    const closePromise = client.close();

    gate.resolve();

    expect((await startPromise).success).toBe(true);
    expect((await closePromise).success).toBe(true);
    expect(port.stopCalls).toBe(1);
  });

  it("should reject worker creation once close has started", async () => {
    const port = new FakePort();
    const stopGate = deferred();
    port.stopGate = stopGate.promise;
    const client = createClient(port);

    const closePromise = client.close();

    expect(() => client.createWorker({ queue: "jobs", handler: async () => undefined })).toThrow(
      /closing or closed/
    );

    stopGate.resolve();

    expect((await closePromise).success).toBe(true);
    expect(port.stopCalls).toBe(1);
  });

  it("should reject worker creation while an existing worker is draining", async () => {
    const port = new FakePort();
    const offWorkGate = deferred();
    port.offWorkGate = offWorkGate.promise;
    const client = createClient(port);
    const worker = client.createWorker({ queue: "jobs", handler: async () => undefined });

    await worker.start();

    const closePromise = client.close();

    expect(() => client.createWorker({ queue: "jobs", handler: async () => undefined })).toThrow(
      /closing or closed/
    );

    offWorkGate.resolve();

    expect((await closePromise).success).toBe(true);
  });

  it("should reject worker creation after close completed", async () => {
    const port = new FakePort();
    const client = createClient(port);

    await client.close();

    expect(() => client.createWorker({ queue: "jobs", handler: async () => undefined })).toThrow(
      /closing or closed/
    );
  });

  it("should keep close pending while a worker's start is in flight", async () => {
    const port = new FakePort();
    const workGate = deferred();
    port.workGate = workGate.promise;
    const client = createClient(port);
    const worker = client.createWorker({ queue: "jobs", handler: async () => undefined });

    const startPromise = worker.start();
    const closePromise = client.close();
    let settled = false;

    void closePromise.then(() => {
      settled = true;
    });

    await Promise.resolve();

    expect(settled).toBe(false);

    workGate.resolve();

    expect((await startPromise).success).toBe(true);
    expect((await closePromise).success).toBe(true);
    expect(port.stopCalls).toBe(1);
  });

  it("should share one close between concurrent callers", async () => {
    const port = new FakePort();
    const stopGate = deferred();
    port.stopGate = stopGate.promise;
    const client = createClient(port);

    const first = client.close();
    const second = client.close();

    expect(second).toBe(first);

    stopGate.resolve();

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult.success).toBe(true);
    expect(secondResult.success).toBe(true);
    expect(firstResult).toBe(secondResult);
    expect(port.stopCalls).toBe(1);
  });

  it("should close successfully after a worker failed to start", async () => {
    const port = new FakePort();
    const client = createClient(port);
    const worker = client.createWorker({ queue: "missing", handler: async () => undefined });

    expect((await worker.start()).success).toBe(false);

    const result = await client.close();

    expect(result.success).toBe(true);
    expect(port.stopCalls).toBe(1);
  });

  it("should return the first outcome on repeated close", async () => {
    const port = new FakePort();
    const client = createClient(port);

    const first = await client.close();
    const second = await client.close();

    expect(first).toBe(second);
    expect(port.stopCalls).toBe(1);
  });

  it("should not report success when a worker failed to stop", async () => {
    const port = new FakePort();
    port.offWorkError = new Error("shutdown failed");
    const client = createClient(port);
    const worker = client.createWorker({ queue: "jobs", handler: async () => undefined });

    await worker.start();

    const result = await client.close();

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.meta.reason).toBe("lifecycle_failed");
    expect(port.stopCalls).toBe(1);
  });

  it("should refuse publication after close", async () => {
    const port = new FakePort();
    const client = createClient(port);

    await client.close();

    const result = await client.producer.enqueue("jobs", { value: 1 });

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.meta.reason).toBe("invalid_configuration");
    expect(port.sendCalls).toBe(0);
  });
});
