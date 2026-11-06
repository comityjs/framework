import type { PriceCurrency, PriceModifier } from "@comity/pricing";
import type { Result } from "@comity/primitives/result";
import type { OrderAddressSnapshot } from "../contracts/address-snapshot.js";
import type { OrderContact } from "../contracts/contact.js";
import type { OrderCustomerSnapshot } from "../contracts/customer-snapshot.js";
import type { OrderLine, OrderLineSubject } from "../contracts/line.js";
import type {
  OrderCreate,
  OrderData,
  OrderSnapshot,
  OrderStatus,
  OrderUpdate,
} from "../contracts/order.js";
import type { OrderPaymentSnapshot } from "../contracts/payment-snapshot.js";
import type { OrderId } from "../value-objects/order-id.js";
import type { ChannelId } from "@comity/organization";

import { PriceRecord } from "@comity/pricing";
import { failure, success } from "@comity/primitives/result";
import { Instant } from "@comity/primitives/time";
import { transitionOrderStatus } from "../domain/order-transitions.js";
import { OrderError } from "../errors/order.js";

/**
 * Returns a defensive copy of a line subject snapshot so later mutations of the
 * input cannot leak into the order.
 *
 * @param subject - The subject snapshot to copy.
 *
 * @returns A defensive copy of the subject.
 */
function copySubject(subject: OrderLineSubject): OrderLineSubject {
  return { ...subject };
}

/**
 * Returns a defensive copy of one recorded modifier.
 *
 * @param modifier - The recorded modifier to copy.
 *
 * @returns A defensive copy of the modifier.
 */
function copyModifierRecord(
  modifier: PriceRecord["modifiers"][number]
): PriceRecord["modifiers"][number] {
  const adjustment = modifier.adjustment;
  const copiedAdjustment: PriceRecord["modifiers"][number]["adjustment"] =
    adjustment.type === "money"
      ? { type: "money", amount: adjustment.amount, operation: adjustment.operation }
      : { type: "percentage", rate: adjustment.rate, operation: adjustment.operation };

  return { ...modifier, adjustment: copiedAdjustment };
}

/**
 * Returns a defensive copy of a price record so later mutations of the input
 * cannot leak into the aggregate.
 *
 * @param price - The record to copy.
 *
 * @returns A defensive copy of the record.
 */
function copyPriceRecord(price: PriceRecord): PriceRecord {
  return {
    ...price,
    currency: { ...price.currency },
    modifiers: price.modifiers.map(copyModifierRecord),
  };
}

/**
 * Returns a defensive copy of a committed line so later mutations of the input
 * cannot leak into the order.
 *
 * @param line - The line to copy.
 *
 * @returns A defensive copy of the line.
 */
function copyLine(line: OrderLine): OrderLine {
  return {
    ...line,
    subject: copySubject(line.subject),
    price: copyPriceRecord(line.price),
    ...(line.meta !== undefined ? { meta: { ...line.meta } } : {}),
  };
}

/**
 * Returns whether a quantity is a valid line quantity: an integer greater than
 * or equal to 1.
 *
 * @param quantity - The quantity to validate.
 *
 * @returns `true` when the quantity is a positive integer, otherwise `false`.
 */
function isValidLineQuantity(quantity: number): boolean {
  return Number.isInteger(quantity) && quantity >= 1;
}

/**
 * Returns a defensive copy of a contact so later mutations of the input cannot
 * leak into the order.
 *
 * @param contact - The contact to copy.
 *
 * @returns A defensive copy of the contact.
 */
function copyContact(contact: OrderContact): OrderContact {
  return { ...contact };
}

/**
 * Returns a defensive copy of the buyer fact so later mutations of the input
 * cannot leak into the order.
 *
 * @param customer - The customer fact to copy.
 *
 * @returns A defensive copy of the customer fact.
 */
function copyCustomerSnapshot(customer: OrderCustomerSnapshot): OrderCustomerSnapshot {
  return {
    ...customer,
    ...(customer.contacts !== undefined
      ? { contacts: customer.contacts.map((contact) => copyContact(contact)) }
      : {}),
  };
}

/**
 * Returns a defensive copy of an address fact so later mutations of the input
 * cannot leak into the order.
 *
 * @param address - The address fact to copy.
 *
 * @returns A defensive copy of the address fact.
 */
function copyAddressSnapshot(address: OrderAddressSnapshot): OrderAddressSnapshot {
  return {
    ...address,
    lines: [...address.lines],
  };
}

/**
 * Returns whether a stored address fact and a replacement destination are
 * structurally identical.
 *
 * @param address - The address fact stored on the order.
 * @param destination - The replacement destination to compare against.
 *
 * @returns `true` when every field matches, otherwise `false`.
 */
function isSameShippingDestination(
  address: OrderAddressSnapshot,
  destination: Omit<OrderAddressSnapshot, "role">
): boolean {
  return (
    address.addressId === destination.addressId &&
    address.lines.length === destination.lines.length &&
    address.lines.every((line, index) => line === destination.lines[index]) &&
    address.city === destination.city &&
    address.administrativeArea === destination.administrativeArea &&
    address.postalCode === destination.postalCode &&
    address.countryCode === destination.countryCode &&
    address.capturedAt.epochMilliseconds === destination.capturedAt.epochMilliseconds
  );
}

/**
 * Outcome of evaluating one payment fact against the recorded facts.
 *
 * - `append`: the fact is a new, legal fact and must be recorded.
 * - `noop`: the fact is an identical repeat of a recorded `(paymentId, status)`
 *   fact; the operation succeeds and nothing is recorded.
 * - `conflict`: the fact contradicts the recorded facts.
 */
type PaymentFactOutcome = "append" | "noop" | "conflict";

/**
 * Evaluates one payment fact against the recorded facts (invariant O-9).
 *
 * The deduplication key is `(paymentId, status)`. An identical repeat is a
 * no-op; the same key with a different amount is a conflict; a fact without a
 * `paymentId` is always appended. A new status for a known `paymentId` is
 * legal only from `authorized` to `captured`, `failed` or `cancelled`; recorded
 * facts are terminal. Amounts are not compared across different statuses.
 *
 * @param existing - The payment facts already recorded on the order.
 * @param fact - The candidate fact.
 *
 * @returns The outcome of the candidate fact.
 */
function evaluatePaymentFact(
  existing: ReadonlyArray<OrderPaymentSnapshot>,
  fact: OrderPaymentSnapshot
): PaymentFactOutcome {
  if (fact.paymentId === undefined) {
    return "append";
  }

  const samePayment = existing.filter((candidate) => candidate.paymentId === fact.paymentId);
  const sameKey = samePayment.filter((candidate) => candidate.status === fact.status);
  const recordedForKey = sameKey[sameKey.length - 1];

  if (recordedForKey !== undefined) {
    return recordedForKey.amount.equals(fact.amount) ? "noop" : "conflict";
  }

  const previous = samePayment[samePayment.length - 1];

  if (previous === undefined) {
    return "append";
  }

  if (previous.status !== "authorized") {
    return "conflict";
  }

  return fact.status === "authorized" ? "conflict" : "append";
}

/**
 * Returns whether two structural currencies are equal on `(code, exponent)`.
 *
 * @param left - The first currency.
 * @param right - The second currency.
 *
 * @returns `true` when both fields match.
 */
function currencyEquals(left: PriceCurrency, right: PriceCurrency): boolean {
  return left.code === right.code && left.exponent === right.exponent;
}

/**
 * Compares two recorded modifiers on every persisted field.
 *
 * @param left - The first recorded modifier.
 * @param right - The second recorded modifier.
 *
 * @returns `true` when the modifiers are identical.
 */
function modifierRecordsEqual(
  left: PriceRecord["modifiers"][number],
  right: PriceRecord["modifiers"][number]
): boolean {
  if (
    left.code !== right.code ||
    left.label !== right.label ||
    left.kind !== right.kind ||
    left.component !== right.component
  ) {
    return false;
  }

  const leftAdjustment = left.adjustment;
  const rightAdjustment = right.adjustment;

  if (
    leftAdjustment.type !== rightAdjustment.type ||
    leftAdjustment.operation !== rightAdjustment.operation
  ) {
    return false;
  }

  if (leftAdjustment.type === "money" && rightAdjustment.type === "money") {
    return leftAdjustment.amount === rightAdjustment.amount;
  }

  if (leftAdjustment.type === "percentage" && rightAdjustment.type === "percentage") {
    return (
      leftAdjustment.rate.amount === rightAdjustment.rate.amount &&
      leftAdjustment.rate.scale === rightAdjustment.rate.scale
    );
  }

  return false;
}

/**
 * Returns whether two records are commitment-equal (ADR-014 A14-12).
 *
 * Compares every persisted field, including format, semantics identifier,
 * currency, amounts and the ordered modifier list. Arithmetic equality alone
 * is insufficient.
 *
 * @param left - The first record.
 * @param right - The second record.
 *
 * @returns `true` when the records are commitment-equal.
 */
function priceRecordsEqual(left: PriceRecord, right: PriceRecord): boolean {
  if (
    left.format !== right.format ||
    left.semanticsId !== right.semanticsId ||
    !currencyEquals(left.currency, right.currency) ||
    left.subtotal !== right.subtotal ||
    left.total !== right.total ||
    left.modifiers.length !== right.modifiers.length
  ) {
    return false;
  }

  return left.modifiers.every((modifier, index) => {
    const other = right.modifiers[index];

    return other !== undefined && modifierRecordsEqual(modifier, other);
  });
}

/**
 * Maps a Pricing failure to the approved Order reason (ADR-032 AM-5d).
 *
 * @param error - The Pricing error.
 * @param error.meta - The Pricing error metadata.
 * @param error.meta.reason - The Pricing failure reason.
 * @param orderId - The order identifier, used in the error details.
 *
 * @returns The corresponding Order error.
 */
function mapPricingFailure(
  error: {
    /** Pricing error metadata. */
    readonly meta: {
      /** Pricing failure reason. */
      readonly reason: string;
    };
  },
  orderId: string
): OrderError {
  const reason =
    error.meta.reason === "currency_mismatch" ? "currency_mismatch" : "price_incoherent";

  return new OrderError(reason, { details: { orderId, field: "price" } });
}

/**
 * Derives the order-level record from line records and adjustments.
 *
 * @param lines - The lines whose records are the parts.
 * @param adjustments - The order-level adjustments.
 * @param orderId - The order identifier, used in the error details.
 *
 * @returns The derived record, or the mapped Order error.
 */
function combinePricedLines(
  lines: ReadonlyArray<OrderLine>,
  adjustments: ReadonlyArray<PriceModifier | PriceRecord["modifiers"][number]>,
  orderId: string
): Result<PriceRecord, OrderError> {
  const combined = PriceRecord.combine(
    lines.map((line) => line.price),
    adjustments
  );

  if (combined.success === false) {
    return failure(mapPricingFailure(combined.error, orderId));
  }

  return success(combined.value);
}

/**
 * Returns the first structural line violation (O-1, O-2), or `null`.
 *
 * @param lines - The candidate lines.
 * @param orderId - The order identifier, used in the error details.
 *
 * @returns The first violation, or `null`.
 */
function findLineStructureViolation(
  lines: ReadonlyArray<OrderLine>,
  orderId: string
): OrderError | null {
  const seen = new Set<string>();

  for (const line of lines) {
    if (!isValidLineQuantity(line.quantity)) {
      return new OrderError("invalid_quantity", {
        details: { orderId, itemId: line.lineId, field: "quantity" },
      });
    }

    if (seen.has(line.lineId)) {
      return new OrderError("duplicate_item_id", { details: { orderId, itemId: line.lineId } });
    }

    seen.add(line.lineId);
  }

  return null;
}

/**
 * Returns the first O-6 violation against the order currency, or `null`.
 *
 * @param lines - The candidate lines.
 * @param currency - The order currency.
 * @param orderId - The order identifier, used in the error details.
 *
 * @returns The violation, or `null`.
 */
function findLineCurrencyViolation(
  lines: ReadonlyArray<OrderLine>,
  currency: PriceCurrency,
  orderId: string
): OrderError | null {
  for (const line of lines) {
    if (!currencyEquals(line.price.currency, currency)) {
      return new OrderError("currency_mismatch", {
        details: { orderId, itemId: line.lineId, field: "price" },
      });
    }
  }

  return null;
}

/**
 * Returns the first payment-fact violation (O-9) in a supplied sequence, or
 * `null` when the whole sequence is legal.
 *
 * @param payments - The candidate payment facts, in recorded order.
 * @param orderId - The order identifier, used in the error details.
 *
 * @returns The violation, or `null`.
 */
function findPaymentViolation(
  payments: ReadonlyArray<OrderPaymentSnapshot>,
  orderId: string
): OrderError | null {
  const accepted: OrderPaymentSnapshot[] = [];

  for (const fact of payments) {
    if (evaluatePaymentFact(accepted, fact) === "conflict") {
      return new OrderError("payment_fact_conflict", {
        details: { orderId, field: "payments" },
      });
    }

    accepted.push(fact);
  }

  return null;
}

/**
 * Validates the canonical zero record of an empty order (ADR-032 AM-5a).
 *
 * @param price - The supplied order record.
 * @param currency - The order currency.
 * @param orderId - The order identifier, used in the error details.
 *
 * @returns The violation, or `null`.
 */
function findEmptyOrderPriceViolation(
  price: PriceRecord,
  currency: PriceCurrency,
  orderId: string
): OrderError | null {
  if (!currencyEquals(price.currency, currency)) {
    return new OrderError("currency_mismatch", { details: { orderId, field: "currency" } });
  }

  if (price.subtotal !== 0n || price.total !== 0n || price.modifiers.length !== 0) {
    return new OrderError("price_incoherent", { details: { orderId, field: "price" } });
  }

  const combined = PriceRecord.combine([price], []);

  if (combined.success === false) {
    return mapPricingFailure(combined.error, orderId);
  }

  if (!priceRecordsEqual(combined.value, price)) {
    return new OrderError("price_incoherent", { details: { orderId, field: "price" } });
  }

  return null;
}

/**
 * Represents an order entity in the system.
 *
 * @remark
 * An order is a lifecycle aggregate: it owns its status transitions, its
 * committed lines, the applied pricing result, its advisory version token, and
 * its historical facts (buyer, addresses, payments). It does not validate
 * coupons, does not know promotion rules, and does not orchestrate external
 * services — those concerns belong to `@comity/pricing`, other Core Modules,
 * and application/domain services.
 *
 * @remark
 * The version token is ADVISORY: the aggregate carries it and never increments
 * it. Optimistic concurrency belongs to the repository (Comity precondition
 * ADR-029) and is not implemented here.
 */
export class Order {
  readonly #id: OrderId;
  #status: OrderStatus;
  #lines: OrderLine[];
  #price: PriceRecord;
  readonly #currency: PriceCurrency;
  #channelId: ChannelId;
  #customer: OrderCustomerSnapshot | undefined;
  #addresses: OrderAddressSnapshot[] | undefined;
  #payments: OrderPaymentSnapshot[] | undefined;
  #meta: Record<string, unknown> | undefined;
  readonly #createdAt: Instant;
  #updatedAt: Instant;
  readonly #version: number;

  /**
   * Creates a new, validated order (ADR-001, ADR-032 AM-5a).
   *
   * Applies the invariants decidable from creation data — O-1 (integer
   * quantity `>= 1`), O-2 (unique line ids), O-6 (one currency on `(code,
   * exponent)`), O-7 (exact `PriceRecord` commitment equality against
   * `combine`) and O-9 (supplied payment facts) — before any state exists. An
   * empty order is accepted only with the canonical zero record. A new order
   * is `draft` with `version: 0`.
   *
   * @param data - The business data of the order.
   * @param id - The unique identifier of the order, supplied by the caller.
   *
   * @returns The order, or `invalid_quantity` / `duplicate_item_id` /
   * `currency_mismatch` / `price_incoherent` / `payment_fact_conflict`.
   */
  static create(data: OrderData, id: OrderId): Result<Order, OrderError> {
    const orderId = id.toString();
    const structureViolation = findLineStructureViolation(data.lines, orderId);

    if (structureViolation !== null) {
      return failure(structureViolation);
    }

    const lineCurrencyViolation = findLineCurrencyViolation(data.lines, data.currency, orderId);

    if (lineCurrencyViolation !== null) {
      return failure(lineCurrencyViolation);
    }

    if (!currencyEquals(data.price.currency, data.currency)) {
      return failure(
        new OrderError("currency_mismatch", { details: { orderId, field: "currency" } })
      );
    }

    if (data.lines.length === 0) {
      const emptyViolation = findEmptyOrderPriceViolation(data.price, data.currency, orderId);

      if (emptyViolation !== null) {
        return failure(emptyViolation);
      }
    } else {
      const combined = combinePricedLines(data.lines, data.price.modifiers, orderId);

      if (combined.success === false) {
        return failure(combined.error);
      }

      if (!priceRecordsEqual(combined.value, data.price)) {
        return failure(
          new OrderError("price_incoherent", { details: { orderId, field: "price" } })
        );
      }
    }

    const paymentViolation = findPaymentViolation(data.payments ?? [], orderId);

    if (paymentViolation !== null) {
      return failure(paymentViolation);
    }

    return success(new Order({ ...data, status: "draft", version: 0 }, id));
  }

  /**
   * Hydrates an existing order (ADR-001).
   *
   * The constructor performs NO validation: it restores persisted state
   * verbatim, including `version`. Use {@link Order.create} for the validating
   * creation path.
   *
   * @param fields - The persisted fields of the order.
   * @param id - The unique identifier of the order, supplied by the caller.
   * The Order never generates its own aggregate ID; hydration preserves the
   * persisted ID verbatim.
   */
  constructor(fields: OrderCreate, id: OrderId) {
    this.#id = id;
    this.#status = fields.status ?? "draft";
    this.#lines = fields.lines.map(copyLine);
    this.#price = copyPriceRecord(fields.price);
    this.#currency = { ...fields.currency };
    this.#channelId = fields.channelId;
    this.#customer =
      fields.customer !== undefined ? copyCustomerSnapshot(fields.customer) : undefined;
    this.#addresses =
      fields.addresses !== undefined
        ? fields.addresses.map((address) => copyAddressSnapshot(address))
        : undefined;
    this.#payments =
      fields.payments !== undefined
        ? fields.payments.map((payment) => ({ ...payment }))
        : undefined;
    this.#meta = fields.meta ? { ...fields.meta } : undefined;
    this.#createdAt = fields.createdAt ?? Instant.now();
    this.#updatedAt = fields.updatedAt ?? this.#createdAt;
    this.#version = fields.version ?? 0;
  }

  /**
   * @returns The unique identifier of the order.
   */
  get id(): OrderId {
    return this.#id;
  }

  /**
   * @returns The commercial channel through which the order was placed.
   */
  get channelId(): ChannelId {
    return this.#channelId;
  }

  /**
   * @returns The lifecycle status of the order.
   */
  get status(): OrderStatus {
    return this.#status;
  }

  /**
   * @returns The committed lines.
   */
  get lines(): ReadonlyArray<OrderLine> {
    return this.#lines.map(copyLine);
  }

  /**
   * @returns The order price.
   */
  get price(): PriceRecord {
    return copyPriceRecord(this.#price);
  }

  /**
   * @returns The monetary unit of the order and of every amount it stores.
   */
  get currency(): PriceCurrency {
    return { ...this.#currency };
  }

  /**
   * @returns The historical buyer fact, if captured.
   */
  get customer(): OrderCustomerSnapshot | undefined {
    return this.#customer !== undefined
      ? {
          ...this.#customer,
          ...(this.#customer.contacts !== undefined
            ? { contacts: this.#customer.contacts.map((contact) => ({ ...contact })) }
            : {}),
        }
      : undefined;
  }

  /**
   * @returns The historical address facts, if captured.
   */
  get addresses(): ReadonlyArray<OrderAddressSnapshot> | undefined {
    return this.#addresses !== undefined
      ? this.#addresses.map((address) => ({ ...address, lines: [...address.lines] }))
      : undefined;
  }

  /**
   * @returns The historical payment facts, if attached.
   */
  get payments(): ReadonlyArray<OrderPaymentSnapshot> | undefined {
    return this.#payments?.map((payment) => ({ ...payment }));
  }

  /**
   * @returns The custom metadata of the order, if any.
   */
  get meta(): Readonly<Record<string, unknown>> | undefined {
    return this.#meta ? { ...this.#meta } : undefined;
  }

  /**
   * @returns The timestamp when the order was created.
   */
  get createdAt(): Instant {
    return this.#createdAt;
  }

  /**
   * @returns The timestamp when the order was last updated.
   */
  get updatedAt(): Instant {
    return this.#updatedAt;
  }

  /**
   * Returns the persisted-version token (read-only; advisory, never
   * incremented by the aggregate).
   *
   * @returns The version token: `0` while unpersisted.
   */
  get version(): number {
    return this.#version;
  }

  /**
   * Updates non-semantic metadata.
   *
   * Status transitions pass through the domain methods; priced content is
   * replaced atomically through {@link setPricedContent}. Metadata is
   * updatable in any status.
   *
   * @param changes - The changes to apply to the order.
   *
   * @returns Success.
   */
  update(changes: OrderUpdate): Result<void, OrderError> {
    if (changes.meta !== undefined) {
      this.#meta = { ...changes.meta };
    }

    this.#updatedAt = Instant.now();

    return success(undefined);
  }

  /**
   * Appends a historical payment fact to the order.
   *
   * A payment may be processed after the order is created, so the outcome is
   * recorded through a dedicated method rather than the generic update path.
   * This records a historical fact only: it performs no payment logic, knows
   * no payment module, and does not coordinate, authorize, or capture.
   *
   * Facts dedupe on `(paymentId, status)`: an identical repeat is an idempotent
   * no-op that touches nothing; the same key with a different amount, and an
   * illegal progression for a known `paymentId`, are conflicts. A fact without
   * a `paymentId` is always appended.
   *
   * @param snapshot - The payment fact to record.
   *
   * @returns Success (including an idempotent no-op), or
   * `payment_fact_conflict`.
   */
  attachPayment(snapshot: OrderPaymentSnapshot): Result<void, OrderError> {
    const existing = this.#payments ?? [];
    const outcome = evaluatePaymentFact(existing, snapshot);

    if (outcome === "conflict") {
      return failure(
        new OrderError("payment_fact_conflict", {
          details: {
            orderId: this.#id.toString(),
            ...(snapshot.paymentId !== undefined ? { field: "payments" } : {}),
          },
        })
      );
    }

    if (outcome === "noop") {
      return success(undefined);
    }

    this.#payments = [...existing, { ...snapshot }];
    this.#updatedAt = Instant.now();

    return success(undefined);
  }

  /**
   * Replaces the shipping destination of the order.
   *
   * Allowed only while the order is `draft | pending`; in later statuses the
   * shipping destination is immutable. The order must hold exactly one shipping
   * address fact; a missing or ambiguous one is an error rather than a guess. A
   * structurally identical destination is a successful no-op that leaves
   * timestamps untouched. The operation never reaches the generic `update()`
   * path, never touches billing, customer, line, price, or payment facts, and
   * records no history: the aggregate retains only the current shipping
   * destination.
   *
   * @param destination - The replacement shipping destination. The address
   * role is owned by this operation and is always stored as `"shipping"`.
   *
   * @returns A result indicating the success or failure of the change.
   */
  changeShippingDestination(
    destination: Omit<OrderAddressSnapshot, "role">
  ): Result<void, OrderError> {
    if (this.#status !== "draft" && this.#status !== "pending") {
      return failure(
        new OrderError("shipping_destination_immutable", {
          details: {
            orderId: this.#id.toString(),
          },
        })
      );
    }

    const addresses = this.#addresses;
    const shipping = (addresses ?? []).filter((address) => address.role === "shipping");
    const current = shipping.length === 1 ? shipping[0] : undefined;

    if (current === undefined || addresses === undefined) {
      return failure(
        new OrderError("ambiguous_shipping_destination", {
          details: {
            orderId: this.#id.toString(),
          },
        })
      );
    }

    if (isSameShippingDestination(current, destination)) {
      return success(undefined);
    }

    this.#addresses = addresses.map((address) =>
      address.role === "shipping"
        ? copyAddressSnapshot({ ...destination, role: "shipping" })
        : address
    );
    this.#updatedAt = Instant.now();

    return success(undefined);
  }

  /**
   * Atomically replaces the priced content of the order.
   *
   * `lines` and `adjustments` are the complete desired priced content. The
   * order-level `PriceRecord` is derived with `PriceRecord.combine`; line
   * modifiers are provenance and are never reapplied or copied. All validation
   * happens before any state changes, so a failure leaves the aggregate
   * completely unchanged. Allowed only while the order is `draft`.
   *
   * @param lines - The complete desired line collection; must be non-empty.
   * @param adjustments - The order-level adjustments, in application order.
   *
   * @returns Success, or `commitment_immutable` outside `draft` /
   * `currency_mismatch` / `price_incoherent` / `invalid_quantity` /
   * `duplicate_item_id`.
   */
  setPricedContent(
    lines: ReadonlyArray<OrderLine>,
    adjustments: ReadonlyArray<PriceModifier>
  ): Result<void, OrderError> {
    if (this.#status !== "draft") {
      return failure(
        new OrderError("commitment_immutable", { details: { orderId: this.#id.toString() } })
      );
    }

    const orderId = this.#id.toString();
    if (lines.length === 0) {
      return failure(new OrderError("price_incoherent", { details: { orderId, field: "lines" } }));
    }

    const structureViolation = findLineStructureViolation(lines, orderId);

    if (structureViolation !== null) {
      return failure(structureViolation);
    }

    const currencyViolation = findLineCurrencyViolation(lines, this.#currency, orderId);

    if (currencyViolation !== null) {
      return failure(currencyViolation);
    }

    const combined = combinePricedLines(lines, adjustments, orderId);

    if (combined.success === false) {
      return failure(combined.error);
    }

    if (!currencyEquals(combined.value.currency, this.#currency)) {
      return failure(new OrderError("currency_mismatch", { details: { orderId, field: "price" } }));
    }

    this.#lines = lines.map(copyLine);
    this.#price = copyPriceRecord(combined.value);
    this.#updatedAt = Instant.now();

    return success(undefined);
  }

  /**
   * Submits the order: `draft` → `pending`.
   *
   * Before leaving `draft`, re-derives the order-level record from the stored
   * line records and the stored order-level modifiers and requires exact
   * commitment equality (ADR-032 AM-5c). An empty draft is validated against
   * the canonical zero record. Reconciliation uses only `PriceRecord.combine`,
   * never `verify()` and never an aggregate-side `PriceRecord.from()`.
   *
   * @returns A result indicating the success or failure of the transition.
   */
  submit(): Result<void, OrderError> {
    if (this.#status !== "draft") {
      return this.#transition("pending");
    }

    const orderId = this.#id.toString();

    if (this.#lines.length === 0) {
      const emptyViolation = findEmptyOrderPriceViolation(this.#price, this.#currency, orderId);

      if (emptyViolation !== null) {
        return failure(emptyViolation);
      }
    } else {
      if (!currencyEquals(this.#price.currency, this.#currency)) {
        return failure(
          new OrderError("currency_mismatch", { details: { orderId, field: "currency" } })
        );
      }

      const lineCurrencyViolation = findLineCurrencyViolation(
        this.#lines,
        this.#price.currency,
        orderId
      );

      if (lineCurrencyViolation !== null) {
        return failure(lineCurrencyViolation);
      }

      const combined = combinePricedLines(this.#lines, this.#price.modifiers, orderId);

      if (combined.success === false) {
        return failure(combined.error);
      }

      if (!priceRecordsEqual(combined.value, this.#price)) {
        return failure(
          new OrderError("price_incoherent", { details: { orderId, field: "price" } })
        );
      }
    }

    return this.#transition("pending");
  }

  /**
   * Confirms the order: `pending` → `confirmed`.
   *
   * @returns A result indicating the success or failure of the transition.
   */
  confirm(): Result<void, OrderError> {
    return this.#transition("confirmed");
  }

  /**
   * Fulfills the order: `confirmed` → `fulfilled`.
   *
   * @returns A result indicating the success or failure of the transition.
   */
  fulfill(): Result<void, OrderError> {
    return this.#transition("fulfilled");
  }

  /**
   * Cancels the order: `draft | pending | confirmed` → `cancelled`.
   *
   * Takes no argument: the Order is business-model neutral and the application
   * records why the commitment ended.
   *
   * @returns A result indicating the success or failure of the transition.
   */
  cancel(): Result<void, OrderError> {
    return this.#transition("cancelled");
  }

  /**
   * Creates a snapshot of the current state of the order.
   *
   * @returns A snapshot representing the current state of the order.
   */
  snapshot(): OrderSnapshot {
    return {
      id: this.#id,
      status: this.#status,
      lines: this.#lines.map(copyLine),
      price: copyPriceRecord(this.#price),
      currency: { ...this.#currency },
      channelId: this.#channelId,
      ...(this.#customer !== undefined ? { customer: copyCustomerSnapshot(this.#customer) } : {}),
      ...(this.#addresses !== undefined
        ? { addresses: this.#addresses.map((address) => copyAddressSnapshot(address)) }
        : {}),
      ...(this.#payments !== undefined
        ? {
            payments: this.#payments.map((payment) => ({ ...payment })),
          }
        : {}),
      ...(this.#meta !== undefined ? { meta: { ...this.#meta } } : {}),
      createdAt: this.#createdAt,
      updatedAt: this.#updatedAt,
      version: this.#version,
      capturedAt: Instant.now(),
    };
  }

  /**
   * Applies a lifecycle transition through the centralized transition rules.
   *
   * @param to - The target status.
   *
   * @returns A result indicating the success or failure of the transition.
   */
  #transition(to: OrderStatus): Result<void, OrderError> {
    const result = transitionOrderStatus(this.#status, to);

    if (!result.success) {
      return result;
    }

    this.#status = to;
    this.#updatedAt = Instant.now();

    return success(undefined);
  }
}
