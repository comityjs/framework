import type { OrderRepositoryContext } from "@comity/order";
import type {
  FailureInjectionFixture,
  MultiRecordAtomicityScenario,
  SharedPersistenceScope,
  TestFixture,
  VersionedRepositoryTestAdapter,
} from "@comity/primitives/testing";
import type { Instrumentation, Pool, SchemaScope } from "./harness.js";

import { Order, OrderId } from "@comity/order";
import { encodeMeta } from "../codec.js";
import { SqlOrderRepository } from "../sql-order-repository.js";
import {
  buildOrder,
  createSchemaScope,
  instrument,
  newTenant,
  payment,
  unwrap,
} from "./harness.js";
import { createPgSqlClient } from "./pg-client.js";

/** Raw-row snapshot read through an independent connection (not through the repository). */
export interface RowSnapshot {
  readonly table: "orders" | "lines" | "payments";
  readonly key: string;
  readonly version: number;
  readonly meta: string;
  readonly body: string;
}

export type SqlAdapter = VersionedRepositoryTestAdapter<Order, RowSnapshot, OrderRepositoryContext>;

/**
 * Reads the root row and all child rows of one order with plain SQL.
 *
 * @param pool - Pool used for the raw read.
 * @param tenant - Tenant key.
 * @param id - Order identifier.
 *
 * @returns Root snapshot first, then child rows ordered by table and position.
 */
export async function readFullState(
  pool: Pool,
  tenant: string,
  id: string
): Promise<RowSnapshot[]> {
  const root = await pool.query<Record<string, unknown>>(
    `SELECT version, status, channel_id, currency, price, customer, addresses, meta, has_payments,
            created_at::text AS created_at, updated_at::text AS updated_at
       FROM comity_order_orders WHERE tenant = $1 AND id = $2`,
    [tenant, id]
  );
  const lines = await pool.query<Record<string, unknown>>(
    "SELECT position, line FROM comity_order_lines WHERE tenant = $1 AND order_id = $2 ORDER BY position",
    [tenant, id]
  );
  const payments = await pool.query<Record<string, unknown>>(
    "SELECT position, payment FROM comity_order_payments WHERE tenant = $1 AND order_id = $2 ORDER BY position",
    [tenant, id]
  );
  const out: RowSnapshot[] = [];

  for (const row of root.rows) {
    out.push({
      table: "orders",
      key: id,
      version: Number(row["version"]),
      meta: JSON.stringify(row["meta"]),
      body: JSON.stringify(row),
    });
  }

  for (const row of lines.rows) {
    out.push({
      table: "lines",
      key: `${id}#${String(row["position"])}`,
      version: 0,
      meta: "null",
      body: JSON.stringify(row),
    });
  }

  for (const row of payments.rows) {
    out.push({
      table: "payments",
      key: `${id}#${String(row["position"])}`,
      version: 0,
      meta: "null",
      body: JSON.stringify(row),
    });
  }

  return out;
}

/** A fixture plus the probes needed by the SQL-specific tests. */
export interface SqlFixture extends TestFixture<Order, RowSnapshot, OrderRepositoryContext> {
  readonly probe: Instrumentation;
  readonly pool: Pool;
  readonly scope: SchemaScope;
  readonly repo: SqlOrderRepository;
}

/**
 * Builds a fixture over a schema scope with its own connection pool.
 *
 * @param scope - Schema scope.
 * @param tenant - Tenant for the fixture's context.
 *
 * @returns The fixture.
 */
export function fixtureOver(scope: SchemaScope, tenant = newTenant()): SqlFixture {
  const pool = scope.pool();
  const { client, probe } = instrument(createPgSqlClient(pool));
  const repo = new SqlOrderRepository(client);
  const context: OrderRepositoryContext = { tenant };

  return {
    probe,
    pool,
    scope,
    repo,
    context,
    repository: {
      save: async (aggregate, ctx) => {
        await scope.ready;

        return repo.save(aggregate, ctx);
      },
    },
    readSnapshot: async (identity) => {
      await scope.ready;

      return (await readFullState(pool, tenant.toString(), identity))[0] ?? null;
    },
    loadAggregate: async (identity) => {
      await scope.ready;

      const result = await repo.getById(unwrap(OrderId.create(identity)), context);

      if (!result.success) throw new Error(`read failed: ${result.error.message}`);

      return result.value;
    },
  };
}

/**
 * Creates the SQL adapter of the ADR-029 conformance suite.
 *
 * @returns The adapter.
 */
export function createSqlOrderAdapter(): SqlAdapter {
  const adapter: SqlAdapter = {
    createFixture: () => fixtureOver(createSchemaScope()),
    createAggregate: (version, _ctx, identity) =>
      buildOrder(version, unwrap(OrderId.create(identity ?? `order-${crypto.randomUUID()}`))),
    createCompetingAggregate: (original) =>
      buildOrder(original.version, original.id, { meta: { variant: "competing" } }),
    getIdentity: (order) => order.id.toString(),
    getVersion: (snapshot) => snapshot.version,
    getAggregateVersion: (order) => order.version,
    snapshotsEqual: (a, b) => a.table === b.table && a.key === b.key && a.body === b.body,
    reflectsAggregate: (snapshot, order) =>
      snapshot.key === order.id.toString() &&
      snapshot.meta === JSON.stringify(order.meta === undefined ? null : encodeMeta(order.meta)),
    getTenant: (context) => context.tenant.toString(),
    createSharedFixture: async (): Promise<
      SharedPersistenceScope<Order, RowSnapshot, OrderRepositoryContext>
    > => {
      const scope = createSchemaScope();

      await scope.ready;

      const tenant = newTenant();

      return {
        fixtureA: fixtureOver(scope, tenant),
        fixtureB: fixtureOver(scope, tenant),
        sharedIdentity: `order-${crypto.randomUUID()}`,
        dispose: () => undefined,
      };
    },
    createFailureInjectionFixture: async (): Promise<
      FailureInjectionFixture<Order, RowSnapshot, OrderRepositoryContext>
    > => {
      const fixture = fixtureOver(createSchemaScope());

      await fixture.scope.ready;

      return {
        ...fixture,
        expectedReason: "service_unavailable",
        armSaveFailure: () => {
          // Injected at the SQL client boundary, below the repository: the root CAS statement fails.
          fixture.probe.failNext(/^(INSERT INTO|UPDATE) comity_order_orders/);
        },
      };
    },
    createMultiRecordAtomicityScenario: async (): Promise<
      MultiRecordAtomicityScenario<Order, RowSnapshot, OrderRepositoryContext>
    > => {
      const fixture = fixtureOver(createSchemaScope());

      await fixture.scope.ready;

      const identity = `order-${crypto.randomUUID()}`;
      const id = unwrap(OrderId.create(identity));
      const tenant = fixture.context.tenant.toString();
      const canonical = (state: RowSnapshot[]) =>
        state.map((r) => `${r.table}|${r.key}|${r.body}`).sort();

      return {
        fixture,
        identity,
        createInitialAggregate: () =>
          buildOrder(0, id, { lineIds: ["l1", "l2"], payments: [payment("p1", 500n)] }),
        deriveAdvancingAggregate: (persisted) =>
          buildOrder(persisted.version, id, {
            lineIds: ["l1", "l3", "l4"],
            payments: [payment("p1", 500n), payment("p2", 250n)],
            meta: { step: "advance" },
          }),
        deriveStaleAggregate: (persisted) =>
          buildOrder(persisted.version, id, {
            lineIds: ["l9"],
            payments: [],
            meta: { step: "stale" },
          }),
        captureFullState: () => readFullState(fixture.pool, tenant, identity),
        statesEqual: (a, b) => {
          const ca = canonical(a);
          const cb = canonical(b);

          return ca.length === cb.length && ca.every((v, i) => v === cb[i]);
        },
        dispose: () => undefined,
      };
    },
  };

  return adapter;
}
