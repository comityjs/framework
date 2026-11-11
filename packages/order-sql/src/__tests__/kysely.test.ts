import type { Order, OrderRepositoryContext } from "@comity/order";
import type { SqlClient } from "@comity/sql";
import type { Pool } from "./harness.js";

import { OrderId } from "@comity/order";
import { createKyselySqlClient } from "@comity/sql-kysely";
import { Kysely, PostgresDialect } from "kysely";
import { afterAll, expect, it } from "vitest";
import { migrateOrderSql } from "../migrations.js";
import { SqlOrderRepository } from "../sql-order-repository.js";
import {
  buildOrder,
  createSchemaScope,
  describeIntegration,
  disposeAll,
  newTenant,
  payment,
  unwrap,
} from "./harness.js";

afterAll(disposeAll);

/** A real `@comity/sql-kysely` client over its own pg pool (independent connections). */
interface KyselyStack {
  readonly pool: Pool;
  readonly db: Kysely<unknown>;
  readonly client: SqlClient;
  readonly repo: SqlOrderRepository;
}

/**
 * Builds a Kysely-backed stack on an isolated schema scope (schema creation, migration and
 * cleanup come from the shared harness, so schemas are dropped on success and failure alike).
 *
 * @param scope - Schema scope providing a pool bound to the test schema.
 *
 * @returns The stack.
 */
function kyselyStack(scope: { pool(): Pool }): KyselyStack {
  const pool = scope.pool();
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
  const client = createKyselySqlClient({ db, adapter: "kysely-pg" });

  return { pool, db, client, repo: new SqlOrderRepository(client) };
}

/**
 * Loads an order that must exist.
 *
 * @param repo - Repository.
 * @param id - Order identifier.
 * @param ctx - Repository context.
 *
 * @returns The order.
 */
async function load(
  repo: SqlOrderRepository,
  id: OrderId,
  ctx: OrderRepositoryContext
): Promise<Order> {
  const order = unwrap(await repo.getById(id, ctx));

  if (order === null) throw new Error("order not found");

  return order;
}

describeIntegration("SqlOrderRepository through the real @comity/sql-kysely adapter", () => {
  it("transactions, commit, UPDATE ... RETURNING rows (no rowCount) and migrations", async () => {
    const scope = createSchemaScope();

    await scope.ready;

    const stack = kyselyStack(scope);

    try {
      // Already migrated by the harness: re-running through Kysely is a transactional no-op.
      const migrated = await migrateOrderSql(stack.client);

      expect(migrated.success && migrated.value).toEqual([]);

      const ctx: OrderRepositoryContext = { tenant: newTenant() };
      const id = unwrap(OrderId.create("kysely-returning"));

      expect((await stack.repo.save(buildOrder(0, id), ctx)).success).toBe(true);

      // Raw adapter use: a committed transaction whose UPDATE ... RETURNING is read from `rows`.
      const tx = unwrap(await stack.client.begin());
      const updated = await tx.query<{ version: string }>({
        statement:
          "UPDATE comity_order_orders SET version = version + 1 WHERE tenant = $1 AND id = $2 AND version = $3::bigint RETURNING version::text AS version",
        params: [ctx.tenant.toString(), id.toString(), "1"],
      });
      const noMatch = await tx.query<{ version: string }>({
        statement:
          "UPDATE comity_order_orders SET version = version + 1 WHERE tenant = $1 AND id = $2 AND version = $3::bigint RETURNING version::text AS version",
        params: [ctx.tenant.toString(), id.toString(), "99"],
      });

      expect(updated.success && updated.value.rows).toEqual([{ version: "2" }]);
      expect(noMatch.success && noMatch.value.rows).toEqual([]);
      expect((await tx.commit()).success).toBe(true);
      expect((await load(stack.repo, id, ctx)).version).toBe(2);
    } finally {
      await stack.db.destroy();
    }
  }, 60_000);

  it("concurrent CAS through two independent Kysely clients: exactly one success per round (x10)", async () => {
    const scope = createSchemaScope();

    await scope.ready;

    const a = kyselyStack(scope);
    const b = kyselyStack(scope);

    try {
      const ctx: OrderRepositoryContext = { tenant: newTenant() };
      const id = unwrap(OrderId.create("kysely-cas"));

      expect(
        (
          await a.repo.save(
            buildOrder(0, id, { lineIds: ["l1", "l2"], payments: [payment("p1", 5n)] }),
            ctx
          )
        ).success
      ).toBe(true);

      for (let round = 1; round <= 10; round += 1) {
        const [orderA, orderB] = [await load(a.repo, id, ctx), await load(b.repo, id, ctx)];
        const results = await Promise.all([a.repo.save(orderA, ctx), b.repo.save(orderB, ctx)]);

        expect(results.filter((r) => r.success)).toHaveLength(1);
        expect(
          results.filter((r) => !r.success && r.error.meta.reason === "conflict")
        ).toHaveLength(1);
        expect((await load(a.repo, id, ctx)).version).toBe(1 + round);
      }
    } finally {
      await a.db.destroy();
      await b.db.destroy();
    }
  }, 60_000);

  it("BIGINT round-trip at the safe-integer boundary", async () => {
    const scope = createSchemaScope();

    await scope.ready;

    const stack = kyselyStack(scope);

    try {
      const ctx: OrderRepositoryContext = { tenant: newTenant() };
      const id = unwrap(OrderId.create("kysely-bigint"));
      const max = Number.MAX_SAFE_INTEGER;

      expect((await stack.repo.save(buildOrder(0, id), ctx)).success).toBe(true);

      await stack.pool.query(
        "UPDATE comity_order_orders SET version = $3::bigint WHERE tenant = $1 AND id = $2",
        [ctx.tenant.toString(), id.toString(), String(max - 1)]
      );

      const beforeMax = await load(stack.repo, id, ctx);

      expect(beforeMax.version).toBe(max - 1);
      expect((await stack.repo.save(beforeMax, ctx)).success).toBe(true);

      const atMax = await load(stack.repo, id, ctx);

      expect(atMax.version).toBe(max);

      const refused = await stack.repo.save(atMax, ctx);

      expect(refused.success === false && refused.error.meta.reason).toBe("invalid_data");
      expect((await load(stack.repo, id, ctx)).version).toBe(max);
    } finally {
      await stack.db.destroy();
    }
  }, 60_000);

  it("a child-write database error rolls back everything and is not reported as conflict", async () => {
    const scope = createSchemaScope();

    await scope.ready;

    const stack = kyselyStack(scope);

    try {
      const ctx: OrderRepositoryContext = { tenant: newTenant() };
      const id = unwrap(OrderId.create("kysely-rollback"));

      expect(
        (
          await stack.repo.save(
            buildOrder(0, id, { lineIds: ["l1"], payments: [payment("p1", 5n)] }),
            ctx
          )
        ).success
      ).toBe(true);

      await stack.pool.query(
        "ALTER TABLE comity_order_payments ADD CONSTRAINT reject_boom CHECK (payment->>'paymentId' <> 'boom')"
      );

      const snapshot = async () =>
        stack.pool.query<Record<string, unknown>>(
          `SELECT (SELECT version::text FROM comity_order_orders WHERE tenant = $1 AND id = $2) AS version,
                  (SELECT jsonb_agg(line ORDER BY position) FROM comity_order_lines WHERE tenant = $1 AND order_id = $2) AS lines,
                  (SELECT jsonb_agg(payment ORDER BY position) FROM comity_order_payments WHERE tenant = $1 AND order_id = $2) AS payments`,
          [ctx.tenant.toString(), id.toString()]
        );

      const before = await snapshot();
      const failed = await stack.repo.save(
        buildOrder(1, id, {
          lineIds: ["replaced"],
          payments: [payment("boom", 1n)],
          meta: { x: 1 },
        }),
        ctx
      );

      expect(failed.success).toBe(false);
      expect(failed.success === false && failed.error.meta.reason).not.toBe("conflict");
      expect((await snapshot()).rows).toEqual(before.rows);
      expect((await load(stack.repo, id, ctx)).version).toBe(1);
    } finally {
      await stack.db.destroy();
    }
  }, 60_000);
});
