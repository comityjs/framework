import type {
  OrderAddressSnapshot,
  OrderCreate,
  OrderCustomerSnapshot,
  OrderLine,
  OrderPaymentSnapshot,
  OrderPaymentStatus,
  OrderStatus,
} from "@comity/order";

import { ChannelId } from "@comity/organization";
import { Currency, Money, PriceRecord } from "@comity/pricing";
import { BaseError } from "@comity/primitives/errors";
import { Instant } from "@comity/primitives/time";

/** Raised when persisted data cannot be decoded into the aggregate. */
export class OrderCodecError extends BaseError {
  /** Namespaced error code. */
  readonly code = "order-sql:malformed_data" as const;

  /**
   * @param message - What was malformed.
   */
  constructor(message: string) {
    super(`Malformed persisted order data: ${message}`, { reason: "malformed_data" });
  }
}

/** A plain JSON object. */
type JsonObject = Readonly<Record<string, unknown>>;

/**
 * Narrows to a plain object.
 *
 * @param value - Candidate value.
 * @param path - Location used in error messages.
 *
 * @returns The object.
 */
function obj(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OrderCodecError(`${path} is not an object`);
  }

  return Object.fromEntries(Object.entries(value));
}

/**
 * Narrows to an array.
 *
 * @param value - Candidate value.
 * @param path - Location used in error messages.
 *
 * @returns The array elements.
 */
function arr(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new OrderCodecError(`${path} is not an array`);
  }

  return value;
}

/**
 * Reads a required string property.
 *
 * @param o - Source object.
 * @param key - Property name.
 *
 * @returns The string.
 */
function str(o: JsonObject, key: string): string {
  const v = o[key];

  if (typeof v !== "string") {
    throw new OrderCodecError(`${key} is not a string`);
  }

  return v;
}

/**
 * Reads an optional string property.
 *
 * @param o - Source object.
 * @param key - Property name.
 *
 * @returns The string or `undefined`.
 */
function optStr(o: JsonObject, key: string): string | undefined {
  const v = o[key];

  if (v === undefined || v === null) return undefined;

  if (typeof v !== "string") {
    throw new OrderCodecError(`${key} is not a string`);
  }

  return v;
}

/**
 * Reads a required finite number property (also accepts integer strings from `bigint` columns).
 *
 * @param o - Source object.
 * @param key - Property name.
 *
 * @returns The number.
 */
function num(o: JsonObject, key: string): number {
  const v = o[key];
  const n = typeof v === "string" ? Number(v) : v;

  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new OrderCodecError(`${key} is not a number`);
  }

  return n;
}

/**
 * Reads an optional instant stored as epoch milliseconds.
 *
 * @param o - Source object.
 * @param key - Property name.
 *
 * @returns The instant or `undefined`.
 */
function optInstant(o: JsonObject, key: string): Instant | undefined {
  return o[key] === undefined || o[key] === null
    ? undefined
    : Instant.fromEpochMilliseconds(num(o, key));
}

const ORDER_STATUSES: readonly OrderStatus[] = [
  "draft",
  "pending",
  "confirmed",
  "fulfilled",
  "cancelled",
];
const PAYMENT_STATUSES: readonly OrderPaymentStatus[] = [
  "authorized",
  "captured",
  "failed",
  "cancelled",
];

/**
 * Validates an order status.
 *
 * @param value - Candidate value.
 *
 * @returns The status.
 */
export function decodeStatus(value: string): OrderStatus {
  const found = ORDER_STATUSES.find((s) => s === value);

  if (found === undefined) throw new OrderCodecError(`unknown order status "${value}"`);

  return found;
}

/**
 * Tags `bigint` and `Instant` values inside free-form metadata so they survive JSON.
 *
 * @param value - Any value.
 *
 * @returns A JSON-safe value.
 */
export function encodeMeta(value: unknown): unknown {
  if (typeof value === "bigint") return { $bigint: value.toString() };

  if (value instanceof Instant) return { $instant: value.epochMilliseconds };

  if (Array.isArray(value)) return value.map(encodeMeta);

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encodeMeta(v)]));
  }

  return value;
}

/**
 * Reverses {@link encodeMeta}.
 *
 * @param value - A JSON value produced by `encodeMeta`.
 *
 * @returns The original value.
 */
export function decodeMeta(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeMeta);

  if (typeof value === "object" && value !== null) {
    const o = Object.fromEntries(Object.entries(value));
    const keys = Object.keys(o);
    const only = keys.length === 1 ? keys[0] : undefined;

    if (only === "$bigint" && typeof o["$bigint"] === "string") return BigInt(o["$bigint"]);

    if (only === "$instant" && typeof o["$instant"] === "number") {
      return Instant.fromEpochMilliseconds(o["$instant"]);
    }

    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, decodeMeta(v)]));
  }

  return value;
}

/**
 * Encodes a price record to its plain, JSON-safe wire form (ADR-014).
 *
 * @param price - Price record.
 *
 * @returns Plain record.
 */
export function encodePrice(price: PriceRecord): unknown {
  return PriceRecord.toPlain(price);
}

/**
 * Encodes a line to its persisted JSON form.
 *
 * @param line - Order line.
 *
 * @returns JSON-safe line.
 */
export function encodeLine(line: OrderLine): unknown {
  return {
    lineId: line.lineId,
    subject: { ...line.subject },
    quantity: line.quantity,
    price: PriceRecord.toPlain(line.price),
    ...(line.meta !== undefined ? { meta: encodeMeta(line.meta) } : {}),
  };
}

/**
 * Decodes a persisted line.
 *
 * @param value - Persisted JSON.
 *
 * @returns The order line.
 */
export function decodeLine(value: unknown): OrderLine {
  const o = obj(value, "line");
  const subject = obj(o["subject"], "line.subject");
  const price = PriceRecord.restore(o["price"]);

  if (!price.success) throw new OrderCodecError("line.price is not a valid price record");

  const reference = optStr(subject, "reference");
  const description = optStr(subject, "description");
  const meta = o["meta"] === undefined ? undefined : obj(decodeMeta(o["meta"]), "line.meta");

  return {
    lineId: str(o, "lineId"),
    subject: {
      ...(reference !== undefined ? { reference } : {}),
      name: str(subject, "name"),
      ...(description !== undefined ? { description } : {}),
    },
    quantity: num(o, "quantity"),
    price: price.value,
    ...(meta !== undefined ? { meta: { ...meta } } : {}),
  };
}

/**
 * Encodes a payment fact.
 *
 * @param payment - Payment snapshot.
 *
 * @returns JSON-safe payment.
 */
export function encodePayment(payment: OrderPaymentSnapshot): unknown {
  return {
    ...(payment.paymentId !== undefined ? { paymentId: payment.paymentId } : {}),
    amount: payment.amount.amount.toString(),
    currency: payment.amount.currency.code,
    status: payment.status,
    ...(payment.provider !== undefined ? { provider: payment.provider } : {}),
    ...(payment.reference !== undefined ? { reference: payment.reference } : {}),
    ...(payment.authorizedAt !== undefined
      ? { authorizedAt: payment.authorizedAt.epochMilliseconds }
      : {}),
    ...(payment.capturedAt !== undefined
      ? { capturedAt: payment.capturedAt.epochMilliseconds }
      : {}),
  };
}

/**
 * Decodes a persisted payment fact.
 *
 * @param value - Persisted JSON.
 *
 * @returns The payment snapshot.
 */
export function decodePayment(value: unknown): OrderPaymentSnapshot {
  const o = obj(value, "payment");
  const currency = Currency.create(str(o, "currency"));

  if (!currency.success) throw new OrderCodecError("payment.currency is not valid");

  const money = Money.create(BigInt(str(o, "amount")), currency.value);

  if (!money.success) throw new OrderCodecError("payment.amount is not valid");

  const status = PAYMENT_STATUSES.find((s) => s === str(o, "status"));

  if (status === undefined) throw new OrderCodecError("payment.status is unknown");

  const paymentId = optStr(o, "paymentId");
  const provider = optStr(o, "provider");
  const reference = optStr(o, "reference");
  const authorizedAt = optInstant(o, "authorizedAt");
  const capturedAt = optInstant(o, "capturedAt");

  return {
    ...(paymentId !== undefined ? { paymentId } : {}),
    amount: money.value,
    status,
    ...(provider !== undefined ? { provider } : {}),
    ...(reference !== undefined ? { reference } : {}),
    ...(authorizedAt !== undefined ? { authorizedAt } : {}),
    ...(capturedAt !== undefined ? { capturedAt } : {}),
  };
}

/**
 * Encodes the customer snapshot.
 *
 * @param customer - Customer snapshot.
 *
 * @returns JSON-safe customer.
 */
export function encodeCustomer(customer: OrderCustomerSnapshot): unknown {
  return {
    ...(customer.customerId !== undefined ? { customerId: customer.customerId } : {}),
    displayName: customer.displayName,
    ...(customer.contacts !== undefined
      ? { contacts: customer.contacts.map((c) => ({ type: c.type, value: c.value })) }
      : {}),
    capturedAt: customer.capturedAt.epochMilliseconds,
  };
}

/**
 * Decodes the customer snapshot.
 *
 * @param value - Persisted JSON.
 *
 * @returns The customer snapshot.
 */
export function decodeCustomer(value: unknown): OrderCustomerSnapshot {
  const o = obj(value, "customer");
  const customerId = optStr(o, "customerId");
  const contacts =
    o["contacts"] === undefined
      ? undefined
      : arr(o["contacts"], "customer.contacts").map((c) => {
          const co = obj(c, "contact");

          return { type: str(co, "type"), value: str(co, "value") };
        });

  return {
    ...(customerId !== undefined ? { customerId } : {}),
    displayName: str(o, "displayName"),
    ...(contacts !== undefined ? { contacts } : {}),
    capturedAt: Instant.fromEpochMilliseconds(num(o, "capturedAt")),
  };
}

/**
 * Encodes the address snapshots.
 *
 * @param addresses - Address snapshots.
 *
 * @returns JSON-safe addresses.
 */
export function encodeAddresses(addresses: ReadonlyArray<OrderAddressSnapshot>): unknown {
  return addresses.map((a) => ({
    ...(a.addressId !== undefined ? { addressId: a.addressId } : {}),
    role: a.role,
    lines: [...a.lines],
    city: a.city,
    ...(a.administrativeArea !== undefined ? { administrativeArea: a.administrativeArea } : {}),
    postalCode: a.postalCode,
    countryCode: a.countryCode,
    capturedAt: a.capturedAt.epochMilliseconds,
  }));
}

/**
 * Decodes the address snapshots.
 *
 * @param value - Persisted JSON.
 *
 * @returns The address snapshots.
 */
export function decodeAddresses(value: unknown): OrderAddressSnapshot[] {
  return arr(value, "addresses").map((item) => {
    const o = obj(item, "address");
    const role = str(o, "role");

    if (role !== "shipping" && role !== "billing") {
      throw new OrderCodecError(`address.role "${role}" is unknown`);
    }

    const addressId = optStr(o, "addressId");
    const administrativeArea = optStr(o, "administrativeArea");

    return {
      ...(addressId !== undefined ? { addressId } : {}),
      role,
      lines: arr(o["lines"], "address.lines").map((l) => {
        if (typeof l !== "string") throw new OrderCodecError("address.lines entry is not a string");

        return l;
      }),
      city: str(o, "city"),
      ...(administrativeArea !== undefined ? { administrativeArea } : {}),
      postalCode: str(o, "postalCode"),
      countryCode: str(o, "countryCode"),
      capturedAt: Instant.fromEpochMilliseconds(num(o, "capturedAt")),
    };
  });
}

/**
 * Converts a persisted `bigint` version to the aggregate's safe-integer `number`, losslessly.
 *
 * @param value - Raw column value.
 *
 * @returns The version as a safe non-negative integer.
 *
 * @throws {OrderCodecError} If the value is not a non-negative integer within the safe range.
 *
 * @remarks
 * Drivers return `bigint` columns as strings, `bigint` values or (small) numbers. The value is
 * parsed as `bigint` first and converted to `number` only after it is proven to be inside the safe
 * integer range; nothing is rounded, truncated or wrapped.
 *
 */
export function decodeVersion(value: unknown): number {
  let big: bigint;

  if (typeof value === "bigint") {
    big = value;
  } else if (typeof value === "string" && /^[0-9]+$/.test(value)) {
    big = BigInt(value);
  } else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  } else {
    throw new OrderCodecError("version is not a non-negative integer");
  }

  if (big < 0n || big > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new OrderCodecError("version is outside the safe integer range");
  }

  return Number(big);
}

/** One row of the order read query. */
export type OrderRow = Readonly<Record<string, unknown>>;

/**
 * Rebuilds the hydration fields (including the persisted version) from one read-query row.
 *
 * @param row - Row of the order read query.
 *
 * @returns Hydration fields.
 */
export function decodeOrderRow(row: OrderRow): OrderCreate {
  const status = decodeStatus(str(row, "status"));
  const channel = ChannelId.create(str(row, "channel_id"));

  if (!channel.success) throw new OrderCodecError("channel_id is not valid");

  const currency = obj(row["currency"], "currency");
  const price = PriceRecord.restore(row["price"]);

  if (!price.success) throw new OrderCodecError("price is not a valid price record");

  const hasPayments = row["has_payments"] === true;
  const meta =
    row["meta"] === null || row["meta"] === undefined
      ? undefined
      : obj(decodeMeta(row["meta"]), "meta");

  return {
    lines: arr(row["lines"], "lines").map(decodeLine),
    price: price.value,
    currency: { code: str(currency, "code"), exponent: num(currency, "exponent") },
    channelId: channel.value,
    status,
    ...(row["customer"] !== null && row["customer"] !== undefined
      ? { customer: decodeCustomer(row["customer"]) }
      : {}),
    ...(row["addresses"] !== null && row["addresses"] !== undefined
      ? { addresses: decodeAddresses(row["addresses"]) }
      : {}),
    ...(hasPayments ? { payments: arr(row["payments"], "payments").map(decodePayment) } : {}),
    ...(meta !== undefined ? { meta: { ...meta } } : {}),
    createdAt: Instant.fromEpochMilliseconds(num(row, "created_at")),
    updatedAt: Instant.fromEpochMilliseconds(num(row, "updated_at")),
    version: decodeVersion(row["version"]),
  };
}

/**
 * Reads the persisted order identifier from a row.
 *
 * @param row - Row of the order read query.
 *
 * @returns The raw identifier.
 */
export function rowId(row: OrderRow): string {
  return str(row, "id");
}
