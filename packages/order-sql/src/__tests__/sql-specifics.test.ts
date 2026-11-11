import { OrderId } from "@comity/order";
import { afterAll, describe, expect, it } from "vitest";
import { fixtureOver, readFullState } from "./adapter.js";
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

/**
 * Polls until some backend is waiting on a lock (condition polling, not a timing assumption).
 *
 * @param pool - Pool for the observer query.
 */
async function waitForBlockedBackend(pool: {
  query<R>(text: string): Promise<{ rows: R[] }>;
}): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    const r = await pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM pg_locks WHERE NOT granted AND locktype IN ('transactionid','tuple')"
    );

    if (Number(r.rows[0]?.n ?? 0) > 0) return;

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("no backend became blocked on a row lock");
}

describeIntegration("SqlOrderRepository ADR-029 adapter evidence (PostgreSQL)", () => {
  it("version column: NOT NULL, CHECK (version >= 1), no default", async () => {
    const scope = createSchemaScope();

    await scope.ready;

    const pool = scope.pool();
    const meta = await pool.query<{ is_nullable: string; column_default: string | null }>(
      `SELECT is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'comity_order_orders' AND column_name = 'version'`,
      [scope.schema]
    );

    expect(meta.rows[0]).toEqual({ is_nullable: "NO", column_default: null });

    const type = await pool.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'comity_order_orders' AND column_name = 'version'`,
      [scope.schema]
    );

    expect(type.rows[0]?.data_type).toBe("bigint");

    await expect(
      pool.query(
        `INSERT INTO comity_order_orders (tenant, id, version, status, channel_id, currency, price, has_payments, created_at, updated_at)
         VALUES ('t', 'x', 0, 'draft', 'web', '{}', '{}', false, 0, 0)`
      )
    ).rejects.toThrow();
  });

  it("executed CAS: version predicate and increment are in one UPDATE ... RETURNING; no pre-read; one attempt", async () => {
    const fx = fixtureOver(createSchemaScope());
    const id = unwrap(OrderId.create("evidence-1"));

    await fx.scope.ready;
    expect((await fx.repo.save(buildOrder(0, id), fx.context)).success).toBe(true);

    fx.probe.statements.length = 0;

    const win = await fx.repo.save(buildOrder(1, id, { meta: { a: 1 } }), fx.context);

    expect(win.success).toBe(true);

    const first = fx.probe.statements[0];

    expect(first?.sql).toMatch(/^UPDATE comity_order_orders SET\s+version = version \+ 1/);
    expect(first?.sql).toMatch(
      /WHERE tenant = \$1 AND id = \$2 AND version = \$3::bigint\s+RETURNING version/
    );
    expect(first?.params.slice(0, 3)).toEqual([fx.context.tenant.toString(), "evidence-1", "1"]);
    // Order of executed statements: root CAS first, then child maintenance — never a SELECT first.
    expect(fx.probe.statements.map((s) => s.sql.split(/\s+/)[0])).toEqual([
      "UPDATE",
      "DELETE",
      "DELETE",
      "INSERT",
    ]);
    expect(fx.probe.begins).toBe(2);

    // Stale save: exactly one root CAS attempt (no internal retry), diagnostics read AFTER the decision.
    fx.probe.statements.length = 0;
    fx.probe.begins = 0;

    const stale = await fx.repo.save(buildOrder(1, id, { meta: { b: 2 } }), fx.context);

    expect(stale.success === false && stale.error.meta.reason).toBe("conflict");
    expect(stale.success === false && stale.error.meta.details).toEqual({
      repository: "order",
      operation: "save",
      suppliedVersion: 1,
      storedVersion: 2,
    });
    expect(fx.probe.begins).toBe(1);
    expect(
      fx.probe.statements.filter((s) => /^UPDATE comity_order_orders/.test(s.sql))
    ).toHaveLength(1);
    expect(fx.probe.statements.map((s) => s.sql.split(/\s+/)[0])).toEqual(["UPDATE", "SELECT"]);
  });

  it("insert path: atomic INSERT ... ON CONFLICT DO NOTHING RETURNING with literal version 1", async () => {
    const fx = fixtureOver(createSchemaScope());
    const id = unwrap(OrderId.create("evidence-2"));

    await fx.scope.ready;
    await fx.repo.save(buildOrder(0, id), fx.context);

    const sql = fx.probe.statements[0]?.sql ?? "";

    expect(sql).toMatch(/^INSERT INTO comity_order_orders/);
    expect(sql).toMatch(/VALUES \(\$1, \$2, 1,/);
    expect(sql).toMatch(/ON CONFLICT \(tenant, id\) DO NOTHING\s+RETURNING version/);

    fx.probe.statements.length = 0;
    fx.probe.begins = 0;

    const dup = await fx.repo.save(buildOrder(0, id, { meta: { overwritten: true } }), fx.context);

    // Duplicate create: exactly one root INSERT attempt (no retry), then the diagnostic SELECT.
    expect(fx.probe.begins).toBe(1);
    expect(fx.probe.statements.map((st) => st.sql.split(/\s+/)[0])).toEqual(["INSERT", "SELECT"]);

    expect(dup.success === false && dup.error.meta.reason).toBe("conflict");
    expect(
      (await readFullState(fx.pool, fx.context.tenant.toString(), "evidence-2"))[0]?.meta
    ).toBe("null");
  });

  it("deterministic lock contention: the blocked stale writer conflicts after the first commits", async () => {
    const scope = createSchemaScope();

    await scope.ready;

    const tenant = newTenant();
    const a = fixtureOver(scope, tenant);
    const b = fixtureOver(scope, tenant);
    const observer = scope.pool();
    const id = unwrap(OrderId.create("contention"));

    await a.repo.save(buildOrder(0, id), a.context);

    let reached!: () => void;
    let release!: () => void;
    const reachedP = new Promise<void>((r) => (reached = r));
    const gate = new Promise<void>((r) => (release = r));

    // Writer A: hold the transaction open right after its root UPDATE has taken the row lock.
    a.probe.afterStatement = async (sql) => {
      if (/^UPDATE comity_order_orders/.test(sql)) {
        reached();
        await gate;
      }
    };

    const writeA = a.repo.save(buildOrder(1, id, { meta: { winner: "A" } }), a.context);

    await reachedP;

    const writeB = b.repo.save(buildOrder(1, id, { meta: { winner: "B" } }), b.context);

    await waitForBlockedBackend(observer);
    release();

    const [ra, rb] = await Promise.all([writeA, writeB]);

    expect(ra.success).toBe(true);
    expect(rb.success === false && rb.error.meta.reason).toBe("conflict");

    const final = await readFullState(observer, tenant.toString(), "contention");

    expect(final[0]?.version).toBe(2);
    expect(final[0]?.meta).toBe('{"winner":"A"}');
  });

  it("many independent repositories, one expected version: exactly one success", async () => {
    const scope = createSchemaScope();

    await scope.ready;

    const tenant = newTenant();
    const seed = fixtureOver(scope, tenant);
    const id = unwrap(OrderId.create("many"));

    await seed.repo.save(buildOrder(0, id), seed.context);

    const writers = Array.from({ length: 12 }, () => fixtureOver(scope, tenant));
    const results = await Promise.all(
      writers.map((w, i) => w.repo.save(buildOrder(1, id, { meta: { writer: i } }), w.context))
    );

    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(results.filter((r) => !r.success && r.error.meta.reason === "conflict")).toHaveLength(
      11
    );
    expect((await readFullState(seed.pool, tenant.toString(), "many"))[0]?.version).toBe(2);
  });

  it("many concurrent creators of one identity: exactly one success", async () => {
    const scope = createSchemaScope();

    await scope.ready;

    const tenant = newTenant();
    const writers = Array.from({ length: 12 }, () => fixtureOver(scope, tenant));
    const id = unwrap(OrderId.create("many-create"));
    const results = await Promise.all(
      writers.map((w, i) => w.repo.save(buildOrder(0, id, { meta: { writer: i } }), w.context))
    );

    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(results.filter((r) => !r.success && r.error.meta.reason === "conflict")).toHaveLength(
      11
    );
  });

  it("a failing child write rolls back the whole save (update and insert paths)", async () => {
    const fx = fixtureOver(createSchemaScope());
    const id = unwrap(OrderId.create("child-fail"));
    const tenant = fx.context.tenant.toString();

    await fx.scope.ready;
    await fx.repo.save(
      buildOrder(0, id, { lineIds: ["l1", "l2"], payments: [payment("p1", 500n)] }),
      fx.context
    );

    const before = await readFullState(fx.pool, tenant, "child-fail");

    // Update path: the root CAS succeeds inside the transaction, then the payments INSERT fails.
    fx.probe.failNext(/^INSERT INTO comity_order_payments/);

    const failed = await fx.repo.save(
      buildOrder(1, id, {
        lineIds: ["x1"],
        payments: [payment("p1", 500n), payment("p9", 1n)],
        meta: { should: "not persist" },
      }),
      fx.context
    );

    expect(failed.success === false && failed.error.meta.reason).toBe("service_unavailable");
    expect(await readFullState(fx.pool, tenant, "child-fail")).toEqual(before);

    // Insert path: root inserted, child INSERT fails -> no root row remains.
    const id2 = unwrap(OrderId.create("child-fail-2"));

    fx.probe.failNext(/^INSERT INTO comity_order_lines/);

    const failedInsert = await fx.repo.save(buildOrder(0, id2), fx.context);

    expect(failedInsert.success === false && failedInsert.error.meta.reason).toBe(
      "service_unavailable"
    );
    expect(await readFullState(fx.pool, tenant, "child-fail-2")).toEqual([]);
  });

  it("a genuine SQL constraint failure is not reported as conflict", async () => {
    const fx = fixtureOver(createSchemaScope());
    const id = unwrap(OrderId.create("constraint"));

    await fx.scope.ready;
    // Make the schema reject the insert with a non-version constraint (status check).
    await fx.pool.query(
      "ALTER TABLE comity_order_orders ADD CONSTRAINT only_pending CHECK (status = 'pending')"
    );

    const result = await fx.repo.save(buildOrder(0, id), fx.context);

    expect(result.success).toBe(false);
    expect(result.success === false && result.error.meta.reason).not.toBe("conflict");
  });

  it("tenant isolation: same identity is independent per tenant and cross-tenant updates conflict", async () => {
    const scope = createSchemaScope();

    await scope.ready;

    const a = fixtureOver(scope);
    const b = fixtureOver(scope);
    const id = unwrap(OrderId.create("tenant-iso"));

    expect((await a.repo.save(buildOrder(0, id, { meta: { t: "a" } }), a.context)).success).toBe(
      true
    );
    expect(await b.loadAggregate("tenant-iso")).toBeNull();

    const cross = await b.repo.save(buildOrder(1, id), b.context);

    expect(cross.success === false && cross.error.meta.reason).toBe("conflict");
    expect((await b.repo.save(buildOrder(0, id, { meta: { t: "b" } }), b.context)).success).toBe(
      true
    );

    const ra = await readFullState(a.pool, a.context.tenant.toString(), "tenant-iso");
    const rb = await readFullState(a.pool, b.context.tenant.toString(), "tenant-iso");

    expect([ra[0]?.meta, rb[0]?.meta]).toEqual(['{"t":"a"}', '{"t":"b"}']);
  });

  it("round-trips the full aggregate (lines, payments, customer, addresses, meta, bigint/Instant)", async () => {
    const fx = fixtureOver(createSchemaScope());
    const id = unwrap(OrderId.create("roundtrip"));

    await fx.scope.ready;

    const original = buildOrder(0, id, {
      lineIds: ["l1", "l2"],
      payments: [payment("p1", 12345678901234567890n)],
      meta: { note: "x", big: 7n },
    });

    await fx.repo.save(original, fx.context);

    const loaded = unwrap(await fx.repo.getById(id, fx.context));
    const a = original.snapshot();
    const b = loaded?.snapshot();

    expect(loaded?.version).toBe(1);
    expect(b?.lines).toEqual(a.lines);
    expect(b?.price).toEqual(a.price);
    expect(b?.meta).toEqual(a.meta);
    expect(b?.payments?.[0]?.amount.amount).toBe(12345678901234567890n);
    expect(b?.payments?.[0]?.capturedAt?.epochMilliseconds).toBe(2000);
    expect(original.version).toBe(0);
  });

  describe("BIGINT version representation", () => {
    /** Forces the stored version of an order (test-only raw write). */
    async function forceVersion(
      fx: ReturnType<typeof fixtureOver>,
      id: string,
      version: string
    ): Promise<void> {
      await fx.pool.query(
        "UPDATE comity_order_orders SET version = $3::bigint WHERE tenant = $1 AND id = $2",
        [fx.context.tenant.toString(), id, version]
      );
    }

    it("round-trips ordinary versions and versions above the former integer limit", async () => {
      const fx = fixtureOver(createSchemaScope());
      const id = unwrap(OrderId.create("big-1"));

      await fx.scope.ready;
      await fx.repo.save(buildOrder(0, id), fx.context);
      expect(unwrap(await fx.repo.getById(id, fx.context))?.version).toBe(1);

      for (const stored of [2_147_483_647, 2_147_483_648, 4_294_967_297, 9_007_199_254_740_000]) {
        await forceVersion(fx, "big-1", String(stored));

        expect(unwrap(await fx.repo.getById(id, fx.context))?.version).toBe(stored);

        const saved = await fx.repo.save(
          buildOrder(stored, id, { meta: { at: stored } }),
          fx.context
        );

        expect(saved.success).toBe(true);
        expect(unwrap(await fx.repo.getById(id, fx.context))?.version).toBe(stored + 1);
      }
    });

    it("handles the largest supported version: MAX_SAFE_INTEGER - 1 -> MAX_SAFE_INTEGER, then refuses to increment", async () => {
      const fx = fixtureOver(createSchemaScope());
      const id = unwrap(OrderId.create("big-max"));
      const max = Number.MAX_SAFE_INTEGER;

      await fx.scope.ready;
      await fx.repo.save(buildOrder(0, id), fx.context);
      await forceVersion(fx, "big-max", String(max - 1));

      expect((await fx.repo.save(buildOrder(max - 1, id), fx.context)).success).toBe(true);

      const atMax = unwrap(await fx.repo.getById(id, fx.context));

      expect(atMax?.version).toBe(max);

      fx.probe.statements.length = 0;

      const refused = await fx.repo.save(buildOrder(max, id, { meta: { x: 1 } }), fx.context);

      expect(refused.success === false && refused.error.meta.reason).toBe("invalid_data");
      expect(fx.probe.statements).toHaveLength(0); // never reached SQL, no increment attempted
      expect(unwrap(await fx.repo.getById(id, fx.context))?.version).toBe(max);
    });

    it.each([
      ["negative", -1],
      ["fractional", 1.5],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["unsafe", 2 ** 53],
    ])("rejects a %s supplied version as invalid_data before any SQL", async (_l, version) => {
      const fx = fixtureOver(createSchemaScope());
      const id = unwrap(OrderId.create("bad-version"));

      await fx.scope.ready;
      fx.probe.statements.length = 0;

      const result = await fx.repo.save(buildOrder(version, id), fx.context);

      expect(result.success === false && result.error.meta.reason).toBe("invalid_data");
      expect(fx.probe.statements).toHaveLength(0);
      expect(fx.probe.begins).toBe(0);
    });

    it("a genuine stale version above the integer limit is a conflict carrying exact versions", async () => {
      const fx = fixtureOver(createSchemaScope());
      const id = unwrap(OrderId.create("big-stale"));

      await fx.scope.ready;
      await fx.repo.save(buildOrder(0, id), fx.context);
      await forceVersion(fx, "big-stale", "5000000000");

      const stale = await fx.repo.save(buildOrder(4_999_999_999, id), fx.context);

      expect(stale.success === false && stale.error.meta.reason).toBe("conflict");
      expect(stale.success === false && stale.error.meta.details).toEqual({
        repository: "order",
        operation: "save",
        suppliedVersion: 4_999_999_999,
        storedVersion: 5_000_000_000,
      });
    });

    it("a persisted version beyond the safe range is reported as invalid_data, not rounded", async () => {
      const fx = fixtureOver(createSchemaScope());
      const id = unwrap(OrderId.create("big-corrupt"));

      await fx.scope.ready;
      await fx.repo.save(buildOrder(0, id), fx.context);
      await forceVersion(fx, "big-corrupt", "9007199254740993");

      const loaded = await fx.repo.getById(id, fx.context);

      expect(loaded.success === false && loaded.error.meta.reason).toBe("invalid_data");
    });
  });
});
