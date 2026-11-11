import type { TenantId } from "@comity/organization";
import type { Result } from "@comity/primitives/result";
import type {
  OrderRepository,
  OrderRepositoryContext,
  OrderSearchCriteria,
  OrderSearchResult,
} from "../contracts/order-repository.js";
import type { OrderState } from "../contracts/order.js";
import type { OrderId } from "../value-objects/order-id.js";

import { RepositoryError } from "@comity/primitives/errors";
import { failure, success } from "@comity/primitives/result";
import { Order } from "../entities/order.js";

/**
 * Extracts the persistent state of an order as an independent copy.
 *
 * @param order - The order to copy.
 *
 * @returns A deep-copied state without the snapshot capture timestamp.
 */
function stateOf(order: Order): OrderState {
  const { capturedAt, ...state } = order.snapshot();

  void capturedAt;

  return state;
}

/**
 * Outcome of a compare-and-set attempt on a {@link MemoryOrderStore}.
 */
export type MemoryOrderCasResult =
  | {
      /** The write was applied. */
      readonly applied: true;
    }
  | {
      /** The write was rejected because the stored version differs from the expected one. */
      readonly applied: false;

      /** The stored version, absent when no record exists. */
      readonly storedVersion?: number;
    };

/**
 * Backing store of {@link MemoryOrderRepository}.
 *
 * @remarks
 * Several repository instances constructed over the same store observe the same persisted state,
 * which models separate processes sharing one database. The version check and the write of
 * {@link MemoryOrderStore.compareAndSet} execute synchronously with no `await` between them, so
 * two writers can never both succeed for the same expected version.
 */
export class MemoryOrderStore {
  /** Persisted states keyed by tenant + order ID. */
  readonly #records = new Map<string, OrderState>();

  /**
   * Reads the persisted state.
   *
   * @param key - Storage key.
   *
   * @returns The stored state (never copied; callers must copy before exposing) or `undefined`.
   */
  get(key: string): OrderState | undefined {
    return this.#records.get(key);
  }

  /**
   * Lists the persisted states whose key starts with the given prefix.
   *
   * @param prefix - Key prefix.
   *
   * @returns The matching stored states.
   */
  list(prefix: string): OrderState[] {
    return [...this.#records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, v]) => v);
  }

  /**
   * Atomically stores `next` (at `expectedVersion + 1`) iff the stored version equals
   * `expectedVersion` (`0` meaning "no record").
   *
   * @param key - Storage key.
   * @param expectedVersion - The version the caller based the write on.
   * @param next - The state to persist; its `version` is replaced by `expectedVersion + 1`.
   *
   * @returns Whether the write was applied.
   */
  compareAndSet(key: string, expectedVersion: number, next: OrderState): MemoryOrderCasResult {
    const stored = this.#records.get(key);
    const storedVersion = stored?.version ?? 0;

    if (storedVersion !== expectedVersion) {
      return stored === undefined ? { applied: false } : { applied: false, storedVersion };
    }

    this.#records.set(key, { ...next, version: expectedVersion + 1 });

    return { applied: true };
  }
}

/**
 * In-memory implementation of `OrderRepository` for testing and development purposes.
 *
 * @remarks
 * Implements the versioned-repository contract of ADR-029: `save` is a compare-and-set on the
 * order's `version`, a stale or conflicting write returns `repository:conflict` without any
 * retry, and the in-memory order keeps the version it had before the save. Reads and writes copy
 * the order state, so callers never hold a live reference to stored state.
 *
 * Not suitable for production use: state is process-local unless a {@link MemoryOrderStore} is
 * shared on purpose.
 */
export class MemoryOrderRepository implements OrderRepository {
  /** Backing store. */
  readonly #store: MemoryOrderStore;

  /**
   * @param store - Backing store; a private one is created when omitted. Pass the same store to
   *   several repositories to model independent writers over shared persistence.
   */
  constructor(store: MemoryOrderStore = new MemoryOrderStore()) {
    this.#store = store;
  }

  /**
   * Builds the tenant-scoped storage key.
   *
   * @param tenant - The tenant identifier.
   * @param id - The order identifier.
   *
   * @returns The storage key.
   */
  #makeKey(tenant: TenantId, id: OrderId): string {
    return `${tenant.toString()}\u0000${id.toString()}`;
  }

  /**
   * @inheritdoc
   */
  async getById(
    id: OrderId,
    ctx: OrderRepositoryContext
  ): Promise<Result<Order | null, RepositoryError>> {
    const state = this.#store.get(this.#makeKey(ctx.tenant, id));

    if (state === undefined) {
      return success(null);
    }

    return success(new Order(state, state.id));
  }

  /**
   * @inheritdoc
   */
  async save(order: Order, ctx: OrderRepositoryContext): Promise<Result<void, RepositoryError>> {
    const key = this.#makeKey(ctx.tenant, order.id);
    const suppliedVersion = order.version;

    if (
      !Number.isSafeInteger(suppliedVersion) ||
      suppliedVersion < 0 ||
      suppliedVersion >= Number.MAX_SAFE_INTEGER
    ) {
      return failure(
        new RepositoryError("invalid_data", {
          details: { repository: "order", operation: "save", suppliedVersion },
        })
      );
    }

    let outcome: MemoryOrderCasResult;

    try {
      outcome = this.#store.compareAndSet(key, suppliedVersion, stateOf(order));
    } catch (cause) {
      return failure(
        new RepositoryError("unknown", {
          cause,
          details: { repository: "order", operation: "save" },
        })
      );
    }

    if (outcome.applied) {
      return success(undefined);
    }

    return failure(
      new RepositoryError("conflict", {
        details: {
          repository: "order",
          operation: "save",
          suppliedVersion,
          ...(outcome.storedVersion !== undefined ? { storedVersion: outcome.storedVersion } : {}),
        },
      })
    );
  }

  /**
   * @inheritdoc
   */
  async search(
    criteria: OrderSearchCriteria | undefined,
    ctx: OrderRepositoryContext
  ): Promise<Result<OrderSearchResult, RepositoryError>> {
    const tenantPrefix = `${ctx.tenant.toString()}\u0000`;
    let filtered = this.#store.list(tenantPrefix);

    if (criteria?.status !== undefined) {
      filtered = filtered.filter((o) => o.status === criteria.status);
    }

    const limit = criteria?.limit ?? filtered.length;
    const offset = criteria?.offset ?? 0;
    const items = filtered.slice(offset, offset + limit).map((o) => stateOf(new Order(o, o.id)));

    return success({
      items,
      total: filtered.length,
    });
  }
}
