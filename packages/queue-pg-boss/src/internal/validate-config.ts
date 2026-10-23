/** @internal */

import type { QueueError } from "@comity/queue/errors";
import type { PgBossQueueClientConfig, PgBossQueueDefinition } from "../client/types.js";

import { invalidConfigurationError } from "./map-pg-boss-error.js";

/** pg-boss's documented queue-name rule. */
const QUEUE_NAME_PATTERN = /^[\w.\-/]+$/;

const QUEUE_POLICIES = new Set(["standard", "short", "singleton", "stately", "exclusive"]);

/**
 * Build an `invalid_configuration` error with a diagnostic cause.
 *
 * @param message - What is wrong with the configuration
 *
 * @returns The configuration error
 */
function invalid(message: string): QueueError {
  return invalidConfigurationError(new Error(message));
}

/**
 * Whether a value is a non-blank string.
 *
 * @param value - Value to inspect
 *
 * @returns True for a non-blank string
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Whether a value is an integer of at least one.
 *
 * @param value - Value to inspect
 *
 * @returns True for an integer >= 1
 */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * Whether a value is a non-negative integer.
 *
 * @param value - Value to inspect
 *
 * @returns True for an integer >= 0
 */
function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Whether a value has the structural shape of a queue definition.
 *
 * @param value - Value to inspect
 *
 * @returns True for a non-null, non-array object
 *
 * @remarks
 * Values reaching this validator come from untyped configuration. Checking the
 * shape before reading `name` keeps a malformed entry from escaping as a
 * `TypeError` instead of the documented `invalid_configuration` result.
 */
function isQueueDefinition(value: unknown): value is PgBossQueueDefinition {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate one queue definition.
 *
 * @param candidate - Queue definition to validate
 *
 * @returns The first error, or `undefined` when valid
 */
function validateQueue(candidate: unknown): QueueError | undefined {
  if (!isQueueDefinition(candidate)) {
    return invalid("each queue definition must be an object");
  }

  const definition = candidate;

  if (!isNonEmptyString(definition.name)) {
    return invalid("queue name must be a non-empty string");
  }

  if (!QUEUE_NAME_PATTERN.test(definition.name)) {
    return invalid(
      `queue name "${definition.name}" may only contain alphanumeric characters, underscores, hyphens, periods, or forward slashes`
    );
  }

  if (definition.policy !== undefined && !QUEUE_POLICIES.has(definition.policy)) {
    return invalid(
      `queue "${definition.name}" policy "${definition.policy}" is not supported by this adapter`
    );
  }

  if (definition.retryLimit !== undefined && !isNonNegativeInteger(definition.retryLimit)) {
    return invalid(`queue "${definition.name}" retryLimit must be an integer >= 0`);
  }

  if (
    definition.retryDelay !== undefined &&
    (typeof definition.retryDelay !== "number" ||
      !Number.isFinite(definition.retryDelay) ||
      definition.retryDelay < 0)
  ) {
    return invalid(`queue "${definition.name}" retryDelay must be a number >= 0`);
  }

  if (definition.retryDelayMax !== undefined && !isNonNegativeInteger(definition.retryDelayMax)) {
    return invalid(`queue "${definition.name}" retryDelayMax must be an integer >= 0`);
  }

  if (definition.retryBackoff !== undefined && typeof definition.retryBackoff !== "boolean") {
    return invalid(`queue "${definition.name}" retryBackoff must be a boolean`);
  }

  if (definition.expireInSeconds !== undefined && !isPositiveInteger(definition.expireInSeconds)) {
    return invalid(`queue "${definition.name}" expireInSeconds must be an integer >= 1`);
  }

  if (
    definition.retentionSeconds !== undefined &&
    !isPositiveInteger(definition.retentionSeconds)
  ) {
    return invalid(`queue "${definition.name}" retentionSeconds must be an integer >= 1`);
  }

  if (
    definition.deleteAfterSeconds !== undefined &&
    !isNonNegativeInteger(definition.deleteAfterSeconds)
  ) {
    return invalid(`queue "${definition.name}" deleteAfterSeconds must be an integer >= 0`);
  }

  if (definition.partition !== undefined && typeof definition.partition !== "boolean") {
    return invalid(`queue "${definition.name}" partition must be a boolean`);
  }

  if (definition.deadLetter !== undefined) {
    if (!isNonEmptyString(definition.deadLetter)) {
      return invalid(`queue "${definition.name}" deadLetter must be a non-empty string`);
    }

    if (!QUEUE_NAME_PATTERN.test(definition.deadLetter)) {
      return invalid(`queue "${definition.name}" deadLetter has an invalid name`);
    }

    if (definition.deadLetter === definition.name) {
      return invalid(`queue "${definition.name}" cannot be its own dead letter queue`);
    }
  }

  return undefined;
}

/**
 * Validate client configuration before pg-boss is constructed.
 *
 * @param config - Configuration supplied to the factory
 *
 * @returns The first configuration error, or `undefined` when valid
 */
export function validateClientConfig(config: PgBossQueueClientConfig): QueueError | undefined {
  if (config === null || typeof config !== "object") {
    return invalid("configuration is required");
  }

  const { connection } = config;

  if (typeof connection === "string") {
    if (connection.trim().length === 0) {
      return invalid("connection string must not be empty");
    }
  } else if (connection === null || typeof connection !== "object") {
    return invalid("connection is required");
  } else {
    if (
      connection.connectionString !== undefined &&
      !isNonEmptyString(connection.connectionString)
    ) {
      return invalid("connection.connectionString must be a non-empty string");
    }

    if (connection.host !== undefined && !isNonEmptyString(connection.host)) {
      return invalid("connection.host must be a non-empty string");
    }

    if (connection.database !== undefined && !isNonEmptyString(connection.database)) {
      return invalid("connection.database must be a non-empty string");
    }

    if (connection.user !== undefined && !isNonEmptyString(connection.user)) {
      return invalid("connection.user must be a non-empty string");
    }

    if (connection.port !== undefined && !isPositiveInteger(connection.port)) {
      return invalid("connection.port must be an integer >= 1");
    }

    if (connection.max !== undefined && !isPositiveInteger(connection.max)) {
      return invalid("connection.max must be an integer >= 1");
    }
  }

  if (config.schema !== undefined && !isNonEmptyString(config.schema)) {
    return invalid("schema must be a non-empty string");
  }

  if (!Array.isArray(config.queues) || config.queues.length === 0) {
    return invalid("at least one queue definition is required");
  }

  const names = new Set<string>();

  for (const definition of config.queues) {
    const queueError = validateQueue(definition);

    if (queueError) {
      return queueError;
    }

    if (names.has(definition.name)) {
      return invalid(`queue "${definition.name}" is declared more than once`);
    }

    names.add(definition.name);
  }

  if (config.provisionQueues !== undefined && typeof config.provisionQueues !== "boolean") {
    return invalid("provisionQueues must be a boolean");
  }

  if (config.shutdownTimeoutMs !== undefined && !isPositiveInteger(config.shutdownTimeoutMs)) {
    return invalid("shutdownTimeoutMs must be an integer >= 1");
  }

  if (config.onHandlerFailed !== undefined && typeof config.onHandlerFailed !== "function") {
    return invalid("onHandlerFailed must be a function");
  }

  if (config.onBackendError !== undefined && typeof config.onBackendError !== "function") {
    return invalid("onBackendError must be a function");
  }

  return undefined;
}
