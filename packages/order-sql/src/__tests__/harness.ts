import type {
  SqlClient,
  SqlOperationResult,
  SqlQuery,
  SqlResult,
  SqlTransaction,
} from "@comity/sql";

import { ChannelId, TenantId } from "@comity/organization";
import { Order, OrderId } from "@comity/order";
import type { OrderPaymentSnapshot } from "@comity/order";
import { Currency, Money, Price, PriceRecord } from "@comity/pricing";
import { failure } from "@comity/primitives/result";
import { Instant } from "@comity/primitives/time";
import { SqlError } from "@comity/sql/errors";
import pg from "pg";
import { describe } from "vitest";
import { migrateOrderSql } from "../migrations.js";
import { createPgSqlClient } from "./pg-client.js";

/**
 * Connection string of the isolated test database. Without it the suite is skipped, following the
 * repository's existing `TEST_DATABASE_URL` opt-in convention (see `@comity/queue-pg-boss`).
 */
export const databaseUrl = process.env["TEST_DATABASE_URL"];

/** `describe` that skips when no test database is configured. */
export const describeIntegration = databaseUrl === undefined ? describe.skip : describe;

/**
 * Unwraps a successful result.
 *
 * @param result - Result to unwrap.
 *
 * @returns The value.
 */
export function unwrap<T>(result: { success: true; value: T } | { success: false }): T {
  if (result.success === false) throw new Error("Unexpected failure");

  return result.value;
}

const eur = unwrap(Currency.create("EUR"));
export const currency = { code: eur.code, exponent: eur.exponent };
const channel = unwrap(ChannelId.create("web"));

/**
 * Builds a price record.
 *
 * @param amount - Amount in minor units.
 *
 * @returns The record.
 */
export function record(amount: bigint): PriceRecord {
  return unwrap(PriceRecord.from(unwrap(Price.create(unwrap(Money.create(amount, eur)), []))));
}

/**
 * Builds a payment fact.
 *
 * @param paymentId - Payment identifier.
 * @param amount - Amount in minor units.
 *
 * @returns The payment snapshot.
 */
export function payment(paymentId: string, amount: bigint): OrderPaymentSnapshot {
  return {
    paymentId,
    amount: unwrap(Money.create(amount, eur)),
    status: "captured",
    provider: "psp",
    capturedAt: Instant.fromEpochMilliseconds(2000),
  };
}

/** Optional variations of a built order. */
export interface BuildOptions {
  readonly meta?: Record<string, unknown>;
  readonly lineIds?: readonly string[];
  readonly payments?: readonly OrderPaymentSnapshot[];
}

/**
 * Hydrates an order at a given persisted version.
 *
 * @param version - Persisted version to restore.
 * @param id - Order identifier.
 * @param options - Variations.
 *
 * @returns The order.
 */
export function buildOrder(version: number, id: OrderId, options: BuildOptions = {}): Order {
  return new Order(
    {
      lines: (options.lineIds ?? ["l1"]).map((lineId) => ({
        lineId,
        subject: { reference: `SKU-${lineId}`, name: `Item ${lineId}` },
        quantity: 1,
        price: record(1000n),
      })),
      price: record(1000n * BigInt((options.lineIds ?? ["l1"]).length)),
      currency,
      channelId: channel,
      status: "draft",
      createdAt: Instant.fromEpochMilliseconds(1000),
      updatedAt: Instant.fromEpochMilliseconds(1000),
      ...(options.meta !== undefined ? { meta: options.meta } : {}),
      ...(options.payments !== undefined ? { payments: [...options.payments] } : {}),
      version,
    },
    id
  );
}

/**
 * Creates a fresh tenant.
 *
 * @returns A unique tenant identifier.
 */
export function newTenant(): TenantId {
  return unwrap(TenantId.create(`tenant-${crypto.randomUUID()}`));
}

/** Pool type produced by `pg`. */
export type Pool = InstanceType<typeof pg.Pool>;

/** An isolated PostgreSQL schema holding the migrated Order tables. */
export interface SchemaScope {
  readonly schema: string;
  readonly ready: Promise<void>;
  /** Create a pool (independent connections) whose `search_path` is this schema. */
  pool(): Pool;
}

const createdSchemas: string[] = [];
const createdPools: Pool[] = [];

/**
 * Creates an isolated schema in the test database and applies the adapter migrations to it.
 *
 * @returns The scope; operations must await `ready`.
 */
export function createSchemaScope(): SchemaScope {
  if (databaseUrl === undefined) throw new Error("TEST_DATABASE_URL is required");

  const url = databaseUrl;
  const schema = `adr029_${crypto.randomUUID().replaceAll("-", "")}`;
  const mkPool = (): Pool => {
    const p = new pg.Pool({
      connectionString: url,
      max: 2,
      idleTimeoutMillis: 500,
      options: `-c search_path=${schema}`,
    });

    createdPools.push(p);

    return p;
  };
  const ready = (async () => {
    const admin = new pg.Pool({ connectionString: url, max: 1 });

    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
      createdSchemas.push(schema);
    } finally {
      await admin.end();
    }

    const migrated = await migrateOrderSql(createPgSqlClient(mkPool()));

    if (!migrated.success) throw new Error("migration failed");
  })();

  return { schema, ready, pool: mkPool };
}

/** Drops every schema and closes every pool created by the harness. */
export async function disposeAll(): Promise<void> {
  if (databaseUrl === undefined) return;

  await Promise.all(createdPools.splice(0).map((p) => p.end().catch(() => undefined)));

  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });

  try {
    for (const schema of createdSchemas.splice(0)) {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    }
  } finally {
    await admin.end();
  }
}

/** Observation and fault-injection hooks around a `SqlClient`. */
export interface Instrumentation {
  /** Every executed statement (client-level and transactional), in order. */
  readonly statements: { sql: string; params: readonly unknown[] }[];
  /** Number of `begin()` calls. */
  begins: number;
  /** Fail the next statement matching the pattern with a connection error. */
  failNext(pattern: RegExp): void;
  /** Hook awaited right before `commit()`. */
  beforeCommit?: () => Promise<void>;
  /** Hook awaited right after each statement succeeded. */
  afterStatement?: (sql: string) => Promise<void>;
}

/**
 * Wraps a client to record statements and inject failures.
 *
 * @param inner - Real client.
 *
 * @returns The wrapped client and its instrumentation.
 */
export function instrument(inner: SqlClient): { client: SqlClient; probe: Instrumentation } {
  let pending: RegExp | undefined;
  const probe: Instrumentation = {
    statements: [],
    begins: 0,
    failNext(pattern) {
      pending = pattern;
    },
  };
  const run = async <T>(
    q: Readonly<SqlQuery>,
    exec: () => Promise<SqlOperationResult<SqlResult<T>>>
  ): Promise<SqlOperationResult<SqlResult<T>>> => {
    probe.statements.push({
      sql: q.statement,
      params: "params" in q && Array.isArray(q.params) ? q.params : [],
    });

    if (pending !== undefined && pending.test(q.statement)) {
      pending = undefined;

      return failure(
        new SqlError("connection_failed", { details: { operation: "query", adapter: "injected" } })
      );
    }

    const result = await exec();

    if (result.success) await probe.afterStatement?.(q.statement);

    return result;
  };
  const wrapTx = (tx: SqlTransaction): SqlTransaction => ({
    query: <T>(q: Readonly<SqlQuery>) => run<T>(q, () => tx.query<T>(q)),
    commit: async () => {
      await probe.beforeCommit?.();

      return tx.commit();
    },
    rollback: () => tx.rollback(),
  });
  const client: SqlClient = {
    query: <T>(q: Readonly<SqlQuery>) => run<T>(q, () => inner.query<T>(q)),
    async begin() {
      probe.begins += 1;

      const begun = await inner.begin();

      return begun.success ? { success: true as const, value: wrapTx(begun.value) } : begun;
    },
    atomicBatch: (queries) => inner.atomicBatch(queries),
  };

  return { client, probe };
}
