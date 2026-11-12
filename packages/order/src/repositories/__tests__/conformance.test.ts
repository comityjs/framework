import type { PriceCurrency } from "@comity/pricing";
import type { VersionedRepositoryTestAdapter } from "@comity/primitives/testing";
import type { OrderRepositoryContext } from "../../contracts/order-repository.js";
import type { OrderSnapshot } from "../../contracts/order.js";

import { ChannelId, TenantId } from "@comity/organization";
import { Currency, Money, Price, PriceRecord } from "@comity/pricing";
import { runVersionedRepositoryTests } from "@comity/primitives/testing";
import { Instant } from "@comity/primitives/time";
import { describe, expect, it } from "vitest";
import { Order } from "../../entities/order.js";
import { OrderId } from "../../value-objects/order-id.js";
import { MemoryOrderRepository, MemoryOrderStore } from "../memory.js";
import type { MemoryOrderCasResult } from "../memory.js";

type OrderAdapter = VersionedRepositoryTestAdapter<Order, OrderSnapshot, OrderRepositoryContext>;

function unwrap<T>(result: { success: true; value: T } | { success: false }): T {
  if (result.success === false) {
    throw new Error("Unexpected failure");
  }

  return result.value;
}

const eur = unwrap(Currency.create("EUR"));
const currency: PriceCurrency = { code: eur.code, exponent: eur.exponent };
const channel = unwrap(ChannelId.create("web"));

function record(amount: bigint): PriceRecord {
  return unwrap(PriceRecord.from(unwrap(Price.create(unwrap(Money.create(amount, eur)), []))));
}

function newTenant(): TenantId {
  return unwrap(TenantId.create(`tenant-${crypto.randomUUID()}`));
}

function metaOf(meta: Readonly<Record<string, unknown>> | undefined): string {
  return JSON.stringify(meta ?? null);
}

/** Store whose next compare-and-set throws, simulating a backing-store fault. */
class FaultyStore extends MemoryOrderStore {
  armed = false;

  override compareAndSet(
    key: string,
    expectedVersion: number,
    next: Parameters<MemoryOrderStore["compareAndSet"]>[2]
  ): MemoryOrderCasResult {
    if (this.armed) {
      this.armed = false;

      throw new Error("injected store fault");
    }

    return super.compareAndSet(key, expectedVersion, next);
  }
}

function fixtureOver(store: MemoryOrderStore, tenant: TenantId) {
  const repository = new MemoryOrderRepository(store);
  const context: OrderRepositoryContext = { tenant };

  return {
    repository,
    context,
    readSnapshot: async (identity: string): Promise<OrderSnapshot | null> => {
      const result = await repository.getById(unwrap(OrderId.create(identity)), context);

      if (!result.success) throw new Error(`read failed: ${result.error.message}`);

      return result.value?.snapshot() ?? null;
    },
    loadAggregate: async (identity: string): Promise<Order | null> => {
      const result = await repository.getById(unwrap(OrderId.create(identity)), context);

      if (!result.success) throw new Error(`read failed: ${result.error.message}`);

      return result.value;
    },
  };
}

function build(version: number, id: OrderId, meta?: Record<string, unknown>): Order {
  return new Order(
    {
      lines: [
        {
          lineId: "l1",
          subject: { reference: "SKU-1", name: "Test" },
          quantity: 1,
          price: record(1000n),
        },
      ],
      price: record(1000n),
      currency,
      channelId: channel,
      status: "draft",
      createdAt: Instant.fromEpochMilliseconds(1000),
      updatedAt: Instant.fromEpochMilliseconds(1000),
      ...(meta !== undefined ? { meta } : {}),
      version,
    },
    id
  );
}

const adapter: OrderAdapter = {
  createFixture: () => fixtureOver(new MemoryOrderStore(), newTenant()),
  createAggregate: (version, _context, identity) =>
    build(version, unwrap(OrderId.create(identity ?? `order-${crypto.randomUUID()}`))),
  createCompetingAggregate: (original) =>
    build(original.version, original.id, { variant: "competing" }),
  getIdentity: (order) => order.id.toString(),
  getVersion: (snapshot) => snapshot.version,
  getAggregateVersion: (order) => order.version,
  snapshotsEqual: (a, b) =>
    a.version === b.version &&
    a.status === b.status &&
    a.id.toString() === b.id.toString() &&
    metaOf(a.meta) === metaOf(b.meta) &&
    a.price.total === b.price.total &&
    a.updatedAt.epochMilliseconds === b.updatedAt.epochMilliseconds,
  reflectsAggregate: (snapshot, order) =>
    snapshot.id.toString() === order.id.toString() && metaOf(snapshot.meta) === metaOf(order.meta),
  getTenant: (context) => context.tenant.toString(),
  createSharedFixture: () => {
    const store = new MemoryOrderStore();
    const tenant = newTenant();

    return Promise.resolve({
      fixtureA: fixtureOver(store, tenant),
      fixtureB: fixtureOver(store, tenant),
      sharedIdentity: `order-${crypto.randomUUID()}`,
      dispose: () => undefined,
    });
  },
  createFailureInjectionFixture: () => {
    const store = new FaultyStore();

    return Promise.resolve({
      ...fixtureOver(store, newTenant()),
      expectedReason: "unknown" as const,
      armSaveFailure: () => {
        store.armed = true;
      },
    });
  },
};

const conformanceReport = runVersionedRepositoryTests(
  adapter,
  {
    describe: (name, fn) => describe(name, fn),
    it: (name, fn) => it(name, fn),
    // TC-6 is not declared by the in-memory store: the runner shows it as skipped, never as passed.
    skip: (name, fn) => it.skip(name, fn),
    assert: (condition, message) => {
      if (!condition) throw new Error(message ?? "assertion failed");
    },
    assertEqual: (actual, expected, message) => {
      expect(actual, message).toBe(expected);
    },
  },
  "MemoryOrderRepository conformance (ADR-029)"
);

describe("MemoryOrderRepository conformance report", () => {
  it("TC-6 is unsupported (not executed) and every mandatory case is applicable", () => {
    const applicability = Object.fromEntries(
      conformanceReport.cases.map((entry) => [entry.id, entry.applicability])
    );

    expect(applicability).toEqual({
      "TC-1": "applicable",
      "TC-1c": "applicable",
      "TC-2a": "applicable",
      "TC-2b": "applicable",
      "TC-2c": "applicable",
      "TC-3": "applicable",
      "TC-4": "applicable",
      "TC-5": "applicable",
      "TC-6": "unsupported",
    });
  });
});

describe("MemoryOrderRepository (ADR-029 specifics)", () => {
  it("tenant isolation: the same identity in another tenant is independent", async () => {
    const store = new MemoryOrderStore();
    const a = fixtureOver(store, newTenant());
    const b = fixtureOver(store, newTenant());
    const order = adapter.createAggregate(0, a.context, "tenant-iso");

    expect((await a.repository.save(order, a.context)).success).toBe(true);
    expect(await b.readSnapshot("tenant-iso")).toBeNull();
    expect((await b.repository.save(order, b.context)).success).toBe(true);
  });

  it("conflict details carry repository, operation and versions", async () => {
    const f = adapter.createFixture();
    const order = adapter.createAggregate(4, f.context, "details");
    const result = await f.repository.save(order, f.context);

    expect(result.success === false && result.error.meta.details).toEqual({
      repository: "order",
      operation: "save",
      suppliedVersion: 4,
    });
  });

  it("many concurrent writers with one expected version: exactly one succeeds", async () => {
    const store = new MemoryOrderStore();
    const tenant = newTenant();
    const seed = fixtureOver(store, tenant);

    await seed.repository.save(adapter.createAggregate(0, seed.context, "many"), seed.context);

    const writers = Array.from({ length: 20 }, () => fixtureOver(store, tenant));
    const results = await Promise.all(
      writers.map(async (w) => {
        const loaded = await w.loadAggregate("many");

        if (loaded === null) throw new Error("record not loadable");

        return w.repository.save(loaded, w.context);
      })
    );

    expect(results.filter((r) => r.success).length).toBe(1);
    expect(results.filter((r) => !r.success && r.error.meta.reason === "conflict").length).toBe(19);
    expect((await seed.readSnapshot("many"))?.version).toBe(2);
  });

  it.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["unsafe", 2 ** 53],
    ["MAX_SAFE_INTEGER (cannot be incremented)", Number.MAX_SAFE_INTEGER],
  ])("rejects a %s supplied version as invalid_data, not conflict", async (_label, version) => {
    const f = adapter.createFixture();
    const result = await f.repository.save(
      adapter.createAggregate(version, f.context, "bad-v"),
      f.context
    );

    expect(result.success === false && result.error.meta.reason).toBe("invalid_data");
    expect(await f.readSnapshot("bad-v")).toBeNull();
  });
});
