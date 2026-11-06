import type { Percentage } from "../value-objects/percentage.js";
import type { AdjustmentOperation, PriceModifierKind } from "./price-modifier.js";

import {
  combine,
  fromPrice,
  historicalInputs,
  restorePlainRecord,
  toPlainRecord,
} from "../domain/price-record.js";
import { verifyRecord } from "../domain/pricing-semantics.js";

/**
 * Historical monetary unit, exactly as committed.
 *
 * This is a structural representation: it is never validated against the
 * current ISO 4217 table. `code` and `exponent` are recorded facts, not a
 * current-currency admission decision (ADR-014 §13).
 */
export interface PriceCurrency {
  /** Uppercase ISO 4217 code, exactly as committed. */
  readonly code: string;

  /** Minor-unit exponent, exactly as committed. */
  readonly exponent: number;
}

/**
 * Persisted modifier of a `PriceRecord`.
 *
 * The recorded counterpart of `PriceModifier`: monetary amounts are bare
 * `bigint` integer minor units in the enclosing record currency, and modifiers
 * are kept in their original order with their original provenance
 * (ADR-014 §14, A14-12).
 */
export interface PriceModifierRecord {
  /** Modifier code. */
  readonly code: string;

  /** Human-readable label, when recorded. */
  readonly label?: string;

  /** Modifier category (descriptive, never interpreted by pricing). */
  readonly kind: PriceModifierKind;

  /** Optional semantic component, when recorded. */
  readonly component?: string;

  /** The recorded mathematical adjustment. */
  readonly adjustment:
    | {
        /** Absolute adjustment type. */
        readonly type: "money";

        /** Integer minor units in the enclosing record currency. */
        readonly amount: bigint;

        /** Whether the amount is added to or subtracted from the total. */
        readonly operation: AdjustmentOperation;
      }
    | {
        /** Percentage adjustment type. */
        readonly type: "percentage";

        /** Recorded percentage rate. */
        readonly rate: Percentage;

        /** Whether the rate is added to or subtracted from the total. */
        readonly operation: AdjustmentOperation;
      };
}

/**
 * Immutable historical representation of a computed price.
 *
 * It is plain immutable data — constructible, serializable and comparable —
 * and it is what consumers persist instead of `Price` or `PriceSnapshot`
 * (ADR-014 §6, §7, §14). `format` identifies the record schema; `semanticsId`
 * identifies the calculation pipeline that produced `total`; the two are
 * independent (ADR-014 §14.5).
 */
export interface PriceRecord {
  /** Record schema/format version. */
  readonly format: 1;

  /** The one monetary unit for every amount in this record. */
  readonly currency: PriceCurrency;

  /** Integer minor-unit subtotal in `currency`. */
  readonly subtotal: bigint;

  /** Ordered modifiers; order is semantic. */
  readonly modifiers: ReadonlyArray<PriceModifierRecord>;

  /** Integer minor-unit committed total in `currency`. */
  readonly total: bigint;

  /** Identity of the calculation pipeline that produced `total`. */
  readonly semanticsId: number;
}

/**
 * Outcome of historical semantic verification (ADR-014 §14.2).
 */
export type PriceVerification =
  | {
      /** The record is faithful to the semantics that produced it. */
      readonly outcome: "verified";
    }
  | {
      /** The record is not faithful to the semantics that produced it. */
      readonly outcome: "mismatch";
    }
  | {
      /** The record cannot be verified with the available semantics. */
      readonly outcome: "unverifiable";

      /** Why the record cannot be verified. */
      readonly cause: "unknown_semantics" | "retired_semantics" | "unspecified";
    };
/**
 * Plain, JSON-safe wire form of a `PriceRecord` (ADR-014 §14.6).
 *
 * Integer monetary values are decimal strings; percentages are recorded as
 * `(amount, scale)`. The form is lossless for every supported record.
 */
export interface PlainPriceRecord {
  /** Record schema/format version. */
  readonly format: 1;

  /** Historical currency, verbatim. */
  readonly currency: {
    /** Uppercase ISO 4217 code, exactly as committed. */
    readonly code: string;
    /** Minor-unit exponent, exactly as committed. */
    readonly exponent: number;
  };

  /** Decimal-string integer minor units. */
  readonly subtotal: string;

  /** Ordered modifiers, verbatim. */
  readonly modifiers: ReadonlyArray<{
    /** Modifier code. */
    readonly code: string;
    /** Human-readable label, when present. */
    readonly label?: string;
    /** Modifier category. */
    readonly kind: PriceModifierKind;
    /** Optional semantic component, when present. */
    readonly component?: string;
    /** Recorded mathematical adjustment. */
    readonly adjustment:
      | {
          /** Absolute adjustment type. */
          readonly type: "money";
          /** Decimal-string integer minor units. */
          readonly amount: string;
          /** Whether the amount is added to or subtracted from the total. */
          readonly operation: AdjustmentOperation;
        }
      | {
          /** Percentage adjustment type. */
          readonly type: "percentage";
          /** Decimal-string percentage amount. */
          readonly amount: string;
          /** Percentage scale. */
          readonly scale: number;
          /** Whether the rate is added to or subtracted from the total. */
          readonly operation: AdjustmentOperation;
        };
  }>;

  /** Decimal-string integer minor units. */
  readonly total: string;

  /** Calculation pipeline identifier. */
  readonly semanticsId: number;
}

/**
 * Operations on historical `PriceRecord`s.
 *
 * Only `from` and `combine` construct a record with the current `format` and
 * `semanticsId`; callers cannot select either value (ADR-014 A14-1, A14-13).
 * `restore` is structural only; `verify` is historical; `combine` is the
 * commit-time eligibility boundary (ADR-014 §14.6).
 */
export const PriceRecord = {
  /** Creates a record from a computed `Price`, stamping current metadata. */
  from: fromPrice,

  /** Composes an order-level record from finalized line records. */
  combine,

  /** Exposes historical pricing inputs only. */
  historicalInputs,

  /** Re-executes the record's own frozen semantics. */
  verify: verifyRecord,

  /** Converts a record to its lossless plain wire form. */
  toPlain: toPlainRecord,

  /** Restores a record structurally from untrusted plain input. */
  restore: restorePlainRecord,
} as const;
