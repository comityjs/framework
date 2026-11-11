import type { RepositoryError } from "@comity/primitives/errors";
import type { Result } from "@comity/primitives/result";
import type { TenantId } from "@comity/organization";
import type { Order } from "../entities/order.js";
import type { OrderId } from "../value-objects/order-id.js";
import type { OrderState, OrderStatus } from "./order.js";

/**
 * Minimal search/filter criteria for orders.
 */
export interface OrderSearchCriteria {
  /** Filter orders by lifecycle status. */
  readonly status?: OrderStatus | undefined;

  /** The maximum number of results to return. */
  readonly limit?: number | undefined;

  /** The offset for paginated results. */
  readonly offset?: number | undefined;
}

/**
 * Result of listing or searching orders.
 */
export interface OrderSearchResult {
  /** The matching orders. */
  readonly items: ReadonlyArray<OrderState>;

  /** Total number of matching orders. */
  readonly total: number;
}

/**
 * Context for order repository operations.
 *
 * The tenant provides the isolation boundary for the operation.
 * It is not stored on the order itself — tenant is an operational
 * context, not a business fact of the order.
 */
export interface OrderRepositoryContext {
  /** The tenant identifier for isolation. */
  readonly tenant: TenantId;
}

/**
 * Order repository contract.
 *
 * @remarks
 * This contract is the persistence boundary only. Domain behavior (status
 * transitions, item mutations) lives on the `Order` entity; orchestration
 * belongs to application/domain services.
 *
 * @remarks
 * Not found is `null`, never an error. Orders are not physically deleted: the
 * terminal lifecycle states are `cancelled` and `fulfilled`, so no `remove`
 * operation is exposed.
 */
export interface OrderRepository {
  /**
   * Retrieve an order by identifier.
   *
   * @param id - Order ID.
   * @param ctx - Repository context containing tenant for isolation.
   *
   * @returns Order entity or null if not found.
   */
  getById(id: OrderId, ctx: OrderRepositoryContext): Promise<Result<Order | null, RepositoryError>>;

  /**
   * Persist an order.
   *
   * @param order - Order to persist.
   * @param ctx - Repository context containing tenant for isolation.
   *
   * @remarks
   * Versioned save (ADR-029). Let *supplied* be `order.version` and *stored* the persisted
   * version for the same identity within the context's tenant:
   *
   * - no stored record, supplied `0`: insert; stored becomes `1`;
   * - no stored record, supplied not `0`: `repository:conflict`, nothing persisted;
   * - stored record exists, supplied `0`: `repository:conflict`, nothing persisted;
   * - supplied equals stored: update; stored becomes supplied + 1;
   * - supplied differs from stored: `repository:conflict`, nothing persisted.
   *
   * A supplied version that is not a non-negative safe integer, or that is
   * `Number.MAX_SAFE_INTEGER` (a save could not increment it into a representable version), is
   * `repository:invalid_data`, never a `conflict`.
   *
   * The check and the write are one atomic compare-and-set; a conflict is never retried inside
   * the repository. On success the in-memory `order` keeps its pre-save version and is stale:
   * reload with `getById` before saving again. Infrastructure failures keep their own reasons
   * and never surface as `conflict`.
   */
  save(order: Order, ctx: OrderRepositoryContext): Promise<Result<void, RepositoryError>>;

  /**
   * Search orders matching the given criteria.
   *
   * @param criteria - Search criteria.
   * @param ctx - Repository context containing tenant for isolation.
   *
   * @returns Matching orders with a total count.
   */
  search(
    criteria: OrderSearchCriteria | undefined,
    ctx: OrderRepositoryContext
  ): Promise<Result<OrderSearchResult, RepositoryError>>;
}
