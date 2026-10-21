import type { Result } from "@comity/primitives/result";
import type { QueueError } from "@comity/queue/errors";
import type {
  PgBossQueueClient,
  PgBossQueueClientConfig,
  PgBossQueueDefinition,
} from "../../client/types.js";

import { PgBoss } from "pg-boss";
import { describe } from "vitest";
import { createPgBossQueueClient } from "../../client/create-client.js";

/**
 * Connection string for the integration suite.
 *
 * @remarks
 * There is no database-testing convention in the repository. `TEST_DATABASE_URL`
 * is the smallest explicit opt-in: without it the suite is skipped rather than
 * silently passing.
 */
export const databaseUrl = process.env["TEST_DATABASE_URL"];

/** `describe` that skips when no test database is configured. */
export const describeIntegration = databaseUrl === undefined ? describe.skip : describe;

/**
 * Build a unique queue name for one test.
 *
 * @param label - Short test label
 *
 * @returns A queue name valid under pg-boss's name rule
 */
export function uniqueQueue(label: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);

  return `comity_test_${label}_${Date.now()}_${suffix}`;
}

/**
 * Create a client against the test database.
 *
 * @param queues - Queue definitions to provision
 * @param overrides - Additional configuration
 *
 * @returns The created client
 */
export async function createTestClient(
  queues: readonly PgBossQueueDefinition[],
  overrides: Partial<PgBossQueueClientConfig> = {}
): Promise<PgBossQueueClient> {
  if (databaseUrl === undefined) {
    throw new Error("TEST_DATABASE_URL is required");
  }

  const result = await createPgBossQueueClient({
    connection: databaseUrl,
    queues,
    ...overrides,
  });

  if (!result.success) {
    throw result.error;
  }

  return result.value;
}

/**
 * Delete queues created by a test.
 *
 * @param names - Queue names to remove
 */
export async function deleteQueues(names: readonly string[]): Promise<void> {
  if (databaseUrl === undefined) {
    return;
  }

  const boss = new PgBoss(databaseUrl);

  await boss.start();

  for (const name of names) {
    await boss.deleteQueue(name).catch(() => undefined);
  }

  await boss.stop({ graceful: false });
}

/**
 * Wait until a condition holds.
 *
 * @param predicate - Condition to poll
 * @param timeoutMs - Maximum wait
 */
export async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for condition");
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * Narrow a result to success, failing the test otherwise.
 *
 * @param result - Result to inspect
 *
 * @returns The success value
 */
export function expectSuccess<T>(result: Result<T, QueueError>): T {
  if (!result.success) {
    throw result.error;
  }

  return result.value;
}
