import type { PgBossQueueClientConfig } from "../types.js";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPgBossQueueClient } from "../create-client.js";

const mocks = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class FakeBoss {
    static readonly instances: FakeBoss[] = [];

    readonly listeners = new Map<string, Listener[]>();
    errorListenersAtStart = -1;

    constructor(_options: unknown) {
      FakeBoss.instances.push(this);
    }

    on(event: string, listener: Listener): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args);
      }
    }

    async start(): Promise<void> {
      this.errorListenersAtStart = this.listeners.get("error")?.length ?? 0;
    }

    async createQueue(_name: string, _options?: unknown): Promise<void> {
      // Provisioning is exercised by the integration suite.
    }

    async getQueue(name: string): Promise<unknown> {
      return { name };
    }

    async send(_name: string, _data: unknown): Promise<string> {
      return "job-1";
    }

    async work(_name: string, _options: unknown, _handler: unknown): Promise<string> {
      return "worker-1";
    }

    async offWork(_name: string, _options?: unknown): Promise<void> {
      // Not used by these tests.
    }

    async stop(_options?: unknown): Promise<void> {
      // Not used by these tests.
    }
  }

  return { FakeBoss };
});

vi.mock("pg-boss", () => ({ PgBoss: mocks.FakeBoss }));

function config(overrides: Partial<PgBossQueueClientConfig> = {}): PgBossQueueClientConfig {
  return {
    connection: "postgres://localhost/comity_test",
    queues: [{ name: "jobs" }],
    ...overrides,
  };
}

async function createClient(
  overrides: Partial<PgBossQueueClientConfig> = {}
): Promise<InstanceType<typeof mocks.FakeBoss>> {
  const result = await createPgBossQueueClient(config(overrides));

  expect(result.success).toBe(true);

  const boss = mocks.FakeBoss.instances[0];

  expect(boss).toBeDefined();

  return boss!;
}

describe("backend error handling", () => {
  beforeEach(() => {
    mocks.FakeBoss.instances.length = 0;
  });

  it("should install an error listener before pg-boss starts without an observer", async () => {
    const boss = await createClient();

    expect(boss.errorListenersAtStart).toBe(1);
    expect(boss.listeners.get("error")).toHaveLength(1);
  });

  it("should not throw when pg-boss emits an error without an observer", async () => {
    const boss = await createClient();

    expect(() => {
      boss.emit("error", new Error("backend failed"));
    }).not.toThrow();
  });

  it("should forward backend errors to the configured observer", async () => {
    const observer = vi.fn();
    const boss = await createClient({ onBackendError: observer });
    const error = new Error("backend failed");

    boss.emit("error", error);

    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledWith(error);
  });

  it("should ignore a synchronous throw from the observer", async () => {
    const boss = await createClient({
      onBackendError: () => {
        throw new Error("observer failed");
      },
    });

    expect(() => {
      boss.emit("error", new Error("backend failed"));
    }).not.toThrow();
  });

  it("should ignore a rejected promise from the observer", async () => {
    const boss = await createClient({
      onBackendError: async () => {
        throw new Error("observer failed");
      },
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };

    process.on("unhandledRejection", onUnhandled);

    try {
      expect(() => {
        boss.emit("error", new Error("backend failed"));
      }).not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }

    expect(unhandled).toEqual([]);
  });
});
