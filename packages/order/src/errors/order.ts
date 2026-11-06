import type { ErrorMeta } from "@comity/primitives/errors";

import { BaseError } from "@comity/primitives/errors";

/**
 * Order error reason.
 *
 * Contains only domain conditions owned by the Order aggregate. Not-found is
 * a `null` repository result, never an error; infrastructure and
 * cross-module failures (`repository_error`, `insufficient_stock`,
 * `product_not_available`, coupon validation) belong to other layers/modules.
 *
 * The four `currency_mismatch`, `price_incoherent`, `commitment_immutable` and
 * `payment_fact_conflict` reasons are additive (errors.md §10): no existing
 * reason changed its meaning, and no other reason exists. The former
 * `invalid_buyer` reason is removed with O-11, whose commercial/fiscal buyer
 * coherence belongs to Commerce.
 */
export type OrderErrorReason =
  | "invalid_quantity"
  | "invalid_item"
  | "invalid_status_transition"
  | "shipping_destination_immutable"
  | "ambiguous_shipping_destination"
  | "duplicate_item_id"
  | "currency_mismatch"
  | "price_incoherent"
  | "commitment_immutable"
  | "payment_fact_conflict";

/**
 * Order error metadata.
 */
interface OrderErrorMeta extends ErrorMeta {
  /** Error reason. */
  readonly reason: OrderErrorReason;

  /** Contextual details. */
  readonly details?: Readonly<{
    /** Affected order ID. */
    orderId?: string;

    /** Affected item ID. */
    itemId?: string;

    /** Invalid input field. */
    field?: string;

    /** Source status of an invalid transition. */
    from?: string;

    /** Target status of an invalid transition. */
    to?: string;
  }>;
}

const REASON_MESSAGES: Record<OrderErrorReason, string> = {
  invalid_quantity: "Invalid order line quantity",
  invalid_item: "Order line not found",
  invalid_status_transition: "Invalid order status transition",
  shipping_destination_immutable:
    "Shipping destination cannot be changed in the current order status",
  ambiguous_shipping_destination: "Order must contain exactly one shipping destination",
  duplicate_item_id: "Duplicate order line identifier",
  currency_mismatch: "Order lines and price must share one currency",
  price_incoherent: "Order price is not coherent with its lines",
  commitment_immutable: "Committed lines and price cannot be changed outside draft",
  payment_fact_conflict: "Payment fact conflicts with the recorded payment facts",
};

const REASON_HTTP_STATUS: Record<OrderErrorReason, number> = {
  invalid_quantity: 400,
  invalid_item: 400,
  invalid_status_transition: 409,
  shipping_destination_immutable: 409,
  ambiguous_shipping_destination: 409,
  duplicate_item_id: 400,
  currency_mismatch: 409,
  price_incoherent: 409,
  commitment_immutable: 409,
  payment_fact_conflict: 409,
};

/**
 * Order operation error with typed reasons.
 */
export class OrderError extends BaseError<OrderErrorMeta> {
  /** Error code. */
  readonly code: `order:${OrderErrorReason}`;

  /**
   * @param reason - The reason for the order error.
   * @param meta - Additional metadata for the error.
   */
  constructor(reason: OrderErrorReason, meta?: Omit<OrderErrorMeta, "reason">) {
    super(REASON_MESSAGES[reason], {
      httpStatus: REASON_HTTP_STATUS[reason],
      ...meta,
      reason,
    });

    this.code = `order:${reason}`;
  }
}
