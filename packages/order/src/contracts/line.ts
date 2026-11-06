import type { PriceRecord } from "@comity/pricing";

/**
 * Owned, immutable snapshot of what a line bought.
 *
 * Generic by construction: the Order preserves a displayable, traceable
 * description of the purchased subject and never classifies it. Commercial
 * taxonomy (product/asset/licence/service/plan), catalog identity, variants
 * and options belong to Commerce.
 *
 * Guarantees:
 * - `reference` is opaque and caller-owned; the Order never parses, resolves
 *   or compares it. It exists so a reader can trace the line back to its
 *   source when that is still known.
 * - `name` (required) and optional `description` make the line renderable
 *   without any external system.
 * - The value is an owned snapshot, defensively copied on creation and on
 *   `snapshot()`.
 * - Only JSON-representable strings are used.
 */
export interface OrderLineSubject {
  /** Opaque, application-owned reference to what was bought, when known. */
  readonly reference?: string;

  /** Human-readable label. */
  readonly name: string;

  /** Optional additional display text. */
  readonly description?: string;
}

/**
 * A committed line: an occurrence within the order.
 *
 * Embedded value structure: identity only as `lineId`, no lifecycle, no
 * repository. The full line price is a `PriceRecord` owned by
 * `@comity/pricing`; the Order stores it and never recomputes it.
 */
export interface OrderLine {
  /**
   * Caller-assigned technical key for one occurrence within the order.
   *
   * The key identifies the occurrence, not the subject, is unique within the
   * order, and is generated outside the Order.
   */
  readonly lineId: string;

  /** Self-contained snapshot of what was bought. */
  readonly subject: OrderLineSubject;

  /** Integer quantity, `>= 1`. */
  readonly quantity: number;

  /** Frozen committed price for the entire line. */
  readonly price: PriceRecord;

  /** Non-semantic metadata; the domain never reads it. */
  readonly meta?: Record<string, unknown>;
}
