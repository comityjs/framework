import type { PriceCurrency, PriceRecord } from "@comity/pricing";
import type { Instant } from "@comity/primitives/time";
import type { OrderId } from "../value-objects/order-id.js";
import type { ChannelId } from "@comity/organization";
import type { OrderAddressSnapshot } from "./address-snapshot.js";
import type { OrderCustomerSnapshot } from "./customer-snapshot.js";
import type { OrderLine } from "./line.js";
import type { OrderPaymentSnapshot } from "./payment-snapshot.js";

/**
 * Order status.
 *
 * An order starts in `draft` and progresses through a linear lifecycle. Each
 * transition is explicit; the status cannot move backwards.
 *
 * Transitions:
 * - `draft` → `pending` (submit)
 * - `pending` → `confirmed` (confirm)
 * - `confirmed` → `fulfilled` (fulfill)
 * - `draft | pending | confirmed` → `cancelled` (cancel)
 *
 * `fulfilled` and `cancelled` are terminal.
 *
 * - `draft`: terms are being assembled; nothing is owed.
 * - `pending`: submitted for acceptance.
 * - `confirmed`: terms accepted; delivery obligations exist.
 * - `fulfilled`: every delivery obligation has been discharged.
 * - `cancelled`: the commitment is terminated.
 */
export type OrderStatus = "draft" | "pending" | "confirmed" | "fulfilled" | "cancelled";

/**
 * Business data of an order, independent of identity and lifecycle metadata.
 */
export interface OrderData {
  /** Committed lines. */
  readonly lines: ReadonlyArray<OrderLine>;

  /**
   * Frozen order-level price composed by `@comity/pricing`.
   *
   * The aggregate derives `price.subtotal` (the sum of the line totals) and
   * `price.total` (after order-level adjustments) through
   * `PriceRecord.combine`; it never performs pricing arithmetic itself (O-7).
   */
  readonly price: PriceRecord;

  /**
   * Monetary unit of the order and of every line and amount in `price`.
   *
   * A structural `PriceCurrency`, recorded verbatim. O-6 compares `(code,
   * exponent)` exactly.
   */
  readonly currency: PriceCurrency;

  /** The commercial channel through which the order was placed. */
  readonly channelId: ChannelId;

  /** Historical buyer fact, captured at purchase time. */
  readonly customer?: OrderCustomerSnapshot;

  /** Historical address facts (shipping/billing), captured at purchase time. */
  readonly addresses?: ReadonlyArray<OrderAddressSnapshot>;

  /** Historical payment facts, attached after processing. */
  readonly payments?: ReadonlyArray<OrderPaymentSnapshot>;

  /** Custom metadata. */
  readonly meta?: Record<string, unknown>;
}

/**
 * The persistent state of an existing order.
 */
export interface OrderState extends OrderData {
  /** Unique order identifier. */
  readonly id: OrderId;

  /** Order lifecycle status. */
  readonly status: OrderStatus;

  /** Creation timestamp. */
  readonly createdAt: Instant;

  /** Last update timestamp. */
  readonly updatedAt: Instant;

  /**
   * Persisted-version token.
   *
   * `0` while the aggregate has never been persisted; restored verbatim on
   * hydration. The aggregate NEVER increments it — the repository does, once
   * per successful save. ADVISORY until ADR-029 is accepted.
   */
  readonly version: number;
}

/**
 * Immutable point-in-time snapshot of an existing order.
 */
export type OrderSnapshot = Readonly<
  OrderState & {
    /** The timestamp when the snapshot was captured. */
    readonly capturedAt: Instant;
  }
>;

/**
 * Data required to create or hydrate an order.
 *
 * The identifier is supplied separately (`Order.create(data, id)` for
 * creation, the constructor `id` argument for hydration): the caller owns ID
 * generation. Creation ignores the lifecycle fields and always produces a
 * `draft` order with `version: 0`; hydration restores `status`, timestamps
 * and `version` verbatim (ADR-001).
 */
export type OrderCreate = OrderData & {
  /** Order lifecycle status, used to restore persisted state during hydration. */
  readonly status?: OrderStatus;

  /** The timestamp when the order was created. */
  readonly createdAt?: Instant;

  /** The timestamp when the order was last updated. */
  readonly updatedAt?: Instant;

  /** Persisted-version token restored during hydration. Defaults to `0`. */
  readonly version?: number;
};

/**
 * Partial mutation data for an order.
 *
 * Only non-semantic metadata is updatable here. Status transitions pass
 * through the entity's domain methods (`submit`, `confirm`, `fulfill`,
 * `cancel`); priced content is replaced atomically through
 * `setPricedContent`.
 */
export interface OrderUpdate {
  /** Custom metadata. */
  readonly meta?: Record<string, unknown>;
}
