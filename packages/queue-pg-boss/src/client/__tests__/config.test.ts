import type { PgBossQueueClientConfig, PgBossQueuePolicy } from "../types.js";

import { describe, expect, it } from "vitest";
import { validateClientConfig } from "../../internal/validate-config.js";
import { createPgBossQueueClient } from "../create-client.js";

const valid: PgBossQueueClientConfig = {
  connection: "postgres://localhost/comity_test",
  queues: [{ name: "jobs" }],
};

async function expectInvalid(overrides: Record<string, unknown>): Promise<void> {
  const result = await createPgBossQueueClient({
    ...valid,
    ...overrides,
  } as unknown as PgBossQueueClientConfig);

  expect(result.success).toBe(false);

  if (result.success === false) {
    expect(result.error.meta.reason).toBe("invalid_configuration");
  }
}

describe("configuration validation", () => {
  it("should reject an empty queue list", async () => {
    await expectInvalid({ queues: [] });
  });

  it("should reject duplicate queue names", async () => {
    await expectInvalid({ queues: [{ name: "jobs" }, { name: "jobs" }] });
  });

  it("should reject an invalid queue name", async () => {
    await expectInvalid({ queues: [{ name: "bad name!" }] });
  });

  it("should reject a null queue definition without throwing", async () => {
    await expectInvalid({ queues: [null] });
  });

  it("should reject an undefined queue definition without throwing", async () => {
    await expectInvalid({ queues: [undefined] });
  });

  it("should reject a primitive queue definition without throwing", async () => {
    await expectInvalid({ queues: ["jobs"] });
  });

  it("should reject a queue definition that is missing its name", async () => {
    await expectInvalid({ queues: [{}] });
  });

  it("should reject an empty queue name", async () => {
    await expectInvalid({ queues: [{ name: "   " }] });
  });

  it("should reject an unsupported policy", async () => {
    await expectInvalid({ queues: [{ name: "jobs", policy: "priority" }] });
  });

  it("should reject key_strict_fifo because the adapter cannot supply a singleton key", async () => {
    await expectInvalid({ queues: [{ name: "jobs", policy: "key_strict_fifo" }] });

    const error = validateClientConfig({
      ...valid,
      queues: [{ name: "jobs", policy: "key_strict_fifo" }],
    });

    expect(error?.meta.reason).toBe("invalid_configuration");
    expect(error?.cause).toBeInstanceOf(Error);
    expect((error?.cause as Error).message).toContain("key_strict_fifo");
    expect((error?.cause as Error).message).toContain("not supported");
  });

  it("should accept every supported policy", () => {
    const supported: readonly PgBossQueuePolicy[] = [
      "standard",
      "short",
      "singleton",
      "stately",
      "exclusive",
    ];

    for (const policy of supported) {
      expect(
        validateClientConfig({ ...valid, queues: [{ name: "jobs", policy }] })
      ).toBeUndefined();
    }
  });

  it("should accept a valid configuration", () => {
    expect(validateClientConfig(valid)).toBeUndefined();
  });

  it("should reject a negative retry limit", async () => {
    await expectInvalid({ queues: [{ name: "jobs", retryLimit: -1 }] });
  });

  it("should reject a zero expiration", async () => {
    await expectInvalid({ queues: [{ name: "jobs", expireInSeconds: 0 }] });
  });

  it("should reject a queue that is its own dead letter target", async () => {
    await expectInvalid({ queues: [{ name: "jobs", deadLetter: "jobs" }] });
  });

  it("should reject an empty connection string", async () => {
    await expectInvalid({ connection: "   " });
  });

  it("should reject a missing connection", async () => {
    await expectInvalid({ connection: undefined });
  });

  it("should reject an invalid shutdown timeout", async () => {
    await expectInvalid({ shutdownTimeoutMs: 0 });
  });

  it("should reject an invalid schema", async () => {
    await expectInvalid({ schema: "" });
  });

  it("should return a failure rather than throw", async () => {
    await expect(createPgBossQueueClient({ ...valid, queues: [] })).resolves.toMatchObject({
      success: false,
    });
  });
});
