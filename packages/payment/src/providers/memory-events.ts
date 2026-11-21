import type { Result } from "@comity/primitives/result";
import type { Money } from "@comity/pricing";

import type {
  PaymentNotification,
  PaymentNotificationSubject,
} from "../contracts/payment-notification.js";

import type { ReportedAmount } from "../contracts/payment-outcome.js";
import type { UnrepresentableSuccessDetails } from "../errors/payment.js";

import { failure, success } from "@comity/primitives/result";
import { Currency, Money as MoneyValue } from "@comity/pricing";
import { PaymentError } from "../errors/payment.js";

/** A parsed wire object. */
type WireObject = Readonly<Record<string, unknown>>;

/** An event that became a notification. */
interface ClassifiedNotification {
  /** The notification. */
  readonly notification: PaymentNotification;
}

/** An event that fails the whole delivery (VR-9). */
interface ClassifiedFailure {
  /** The failure. */
  readonly failure: PaymentError;
}

/** Classification of one event: a notification, or the failure of the whole delivery. */
type Classified = ClassifiedNotification | ClassifiedFailure;

/** An `amount` field the provider did not supply. */
interface AbsentAmount {
  /** Discriminator. */
  readonly kind: "absent";
}

/** An `amount` field that cannot be represented or validated. */
interface UnusableAmount {
  /** Discriminator. */
  readonly kind: "unusable";

  /** The underlying error, when there is one. */
  readonly cause?: unknown;
}

/** A valid provider amount. */
interface UsableAmount {
  /** Discriminator. */
  readonly kind: "usable";

  /** The amount. */
  readonly amount: Money;
}

/** Parse state of an amount field. */
type AmountField = AbsentAmount | UnusableAmount | UsableAmount;

/** Shared decoder of delivery bodies. */
const decoder = new TextDecoder();

/**
 * Narrows to a plain wire object.
 *
 * @param value - The value.
 *
 * @returns The object, or `undefined`.
 */
function asObject(value: unknown): WireObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

/**
 * A non-empty string field.
 *
 * @param event - The event.
 * @param field - The field name.
 *
 * @returns The string, or `undefined` when absent, empty or not a string.
 */
function text(event: WireObject, field: string): string | undefined {
  const value = event[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Parses the `amount` field.
 *
 * @param event - The event.
 *
 * @returns Whether the amount is absent, unusable, or a valid {@link Money}.
 */
function parseAmount(event: WireObject): AmountField {
  if (event["amount"] === undefined) return { kind: "absent" };
  const raw = asObject(event["amount"]);
  const minor = raw ? text(raw, "minor") : undefined;
  const code = raw ? text(raw, "currency") : undefined;
  if (minor === undefined || code === undefined || !/^-?\d+$/.test(minor)) {
    return { kind: "unusable" };
  }
  const currency = Currency.create(code);
  if (!currency.success) return { kind: "unusable", cause: currency.error };
  const money = MoneyValue.create(BigInt(minor), currency.value);
  return money.success
    ? { kind: "usable", amount: money.value }
    : { kind: "unusable", cause: money.error };
}

/**
 * Optional common notification fields: `eventId` when supplied, `reference` when echoed.
 *
 * @param event - The event.
 *
 * @returns The fields to spread into a notification.
 */
function eventIdField(event: WireObject): Readonly<Partial<Record<"eventId", string>>> {
  const eventId = text(event, "eventId");
  return eventId === undefined ? {} : { eventId };
}

/**
 * The echoed reference, when supplied.
 *
 * @param event - The event.
 *
 * @returns The field to spread into a notification or subject.
 */
function referenceField(event: WireObject): Readonly<Partial<Record<"reference", string>>> {
  const reference = text(event, "reference");
  return reference === undefined ? {} : { reference };
}

/**
 * Builds the `other` notification of an event that establishes no state.
 *
 * @param provider - The binding id.
 * @param type - The event type.
 * @param event - The event.
 * @param subject - The narrowest truthful subject, when any.
 *
 * @returns The notification.
 */
function other(
  provider: string,
  type: string,
  event: WireObject,
  subject?: PaymentNotificationSubject
): Classified {
  return {
    notification: {
      kind: "other",
      provider,
      ...eventIdField(event),
      providerEventType: type,
      ...(subject ? { subject } : {}),
    },
  };
}

/**
 * Subject of a payment-scoped event.
 *
 * @param event - The event.
 *
 * @returns A `payment` subject when `paymentId` is valid.
 */
function paymentSubject(event: WireObject): PaymentNotificationSubject | undefined {
  const paymentId = text(event, "paymentId");
  return paymentId === undefined
    ? undefined
    : { kind: "payment", paymentId, ...referenceField(event) };
}

/**
 * Subject of a refund-scoped event: the refund when identified, otherwise the payment.
 *
 * @param event - The event.
 *
 * @returns The narrowest truthful subject.
 */
function refundSubject(event: WireObject): PaymentNotificationSubject | undefined {
  const refundId = text(event, "refundId");
  if (refundId === undefined) return paymentSubject(event);
  const paymentId = text(event, "paymentId");
  return {
    kind: "refund",
    refundId,
    ...(paymentId === undefined ? {} : { paymentId }),
    ...referenceField(event),
  };
}

/**
 * Case B failure of a settled success whose amount is absent or unusable (VR-9).
 *
 * @param details - The typed details.
 * @param amount - The amount field observed.
 *
 * @returns The failure, with the underlying error as cause when there is one.
 */
function unrepresentable(details: UnrepresentableSuccessDetails, amount: AmountField): Classified {
  const cause = amount.kind === "unusable" ? amount.cause : undefined;
  return {
    failure: new PaymentError("unrepresentable_success", {
      details,
      ...(cause === undefined ? {} : { cause }),
    }),
  };
}

/**
 * Amount fields of a non-settled state: absent, usable or unusable.
 *
 * @param amount - The amount field observed.
 *
 * @returns The fields to spread into the notification.
 */
function reported(amount: AmountField): ReportedAmount {
  if (amount.kind === "usable") return { amount: amount.amount };
  return amount.kind === "unusable" ? { providerAmountUnusable: true } : {};
}

/**
 * Classifies a `payment` event.
 *
 * @param provider - The binding id.
 * @param event - The event.
 *
 * @returns The classification.
 */
function classifyPayment(provider: string, event: WireObject): Classified {
  const paymentId = text(event, "paymentId");
  const state = text(event, "state");
  if (paymentId === undefined) return other(provider, "payment", event);
  if (
    state !== "authorized" &&
    state !== "captured" &&
    state !== "failed" &&
    state !== "cancelled"
  ) {
    return other(provider, "payment", event, paymentSubject(event));
  }

  const base = {
    kind: "payment",
    provider,
    ...eventIdField(event),
    paymentId,
    ...referenceField(event),
  } as const;
  const amount = parseAmount(event);
  if (state === "failed" || state === "cancelled") {
    return { notification: { ...base, state, ...reported(amount) } };
  }
  if (amount.kind !== "usable") {
    return unrepresentable(
      {
        scope: "payment",
        provider,
        paymentId,
        ...referenceField(event),
        ...eventIdField(event),
      },
      amount
    );
  }
  return { notification: { ...base, state, amount: amount.amount } };
}

/**
 * Classifies a `refund` event.
 *
 * @param provider - The binding id.
 * @param event - The event.
 *
 * @returns The classification.
 */
function classifyRefund(provider: string, event: WireObject): Classified {
  const paymentId = text(event, "paymentId");
  const refundId = text(event, "refundId");
  const status = text(event, "status");
  if (
    paymentId === undefined ||
    refundId === undefined ||
    (status !== "succeeded" && status !== "pending" && status !== "failed")
  ) {
    return other(provider, "refund", event, refundSubject(event));
  }

  const base = {
    kind: "refund",
    provider,
    ...eventIdField(event),
    paymentId,
    refundId,
    ...referenceField(event),
  } as const;
  const amount = parseAmount(event);
  if (status !== "succeeded") {
    return { notification: { ...base, status, ...reported(amount) } };
  }
  if (amount.kind !== "usable") {
    return unrepresentable(
      {
        scope: "refund",
        provider,
        paymentId,
        refundId,
        ...referenceField(event),
        ...eventIdField(event),
      },
      amount
    );
  }
  return { notification: { ...base, status, amount: amount.amount } };
}

/**
 * Classifies an `operation` event.
 *
 * @param provider - The binding id.
 * @param event - The event.
 *
 * @returns The classification.
 */
function classifyOperation(provider: string, event: WireObject): Classified {
  const paymentId = text(event, "paymentId");
  const operationId = text(event, "operationId");
  const operation = text(event, "operation");
  const status = text(event, "status");
  if (
    paymentId === undefined ||
    operationId === undefined ||
    (operation !== "capture" && operation !== "cancel") ||
    (status !== "succeeded" && status !== "failed")
  ) {
    return other(provider, "operation", event, paymentSubject(event));
  }
  return {
    notification: {
      kind: "operation",
      provider,
      ...eventIdField(event),
      operation,
      paymentId,
      operationId,
      status,
    },
  };
}

/**
 * Classifies one event through the mapping.
 *
 * @param provider - The binding id.
 * @param type - The event type.
 * @param event - The event.
 *
 * @returns The classification.
 */
function classifyEvent(provider: string, type: string, event: WireObject): Classified {
  switch (type) {
    case "payment":
      return classifyPayment(provider, event);
    case "refund":
      return classifyRefund(provider, event);
    case "operation":
      return classifyOperation(provider, event);
    case "notice": {
      const objectId = text(event, "objectId");
      return other(
        provider,
        type,
        event,
        objectId === undefined
          ? undefined
          : { kind: "payment_or_refund", providerId: objectId, ...referenceField(event) }
      );
    }
    default:
      return other(provider, type, event);
  }
}

/**
 * Parses and classifies the body of an authentic memory delivery through the documented event mapping of the memory
 * provider (ADR-037 §7, VR-10), pinned to its own wire schema.
 *
 * A delivery body is JSON `{ "events": [ ... ] }`. Every event is an object with a string `type`; the other fields
 * are `eventId`, `reference`, `paymentId`, `refundId`, `operationId`, `objectId`, `operation`, `state`, `status`
 * and `amount` (`{ "minor": "<integer>", "currency": "<ISO 4217>" }`). Fields outside this schema are ignored.
 *
 * | Event `type`       | Class  | Required fields                                                     | Declared financial field                   |
 * | ------------------ | ------ | ------------------------------------------------------------------- | ------------------------------------------ |
 * | `payment`          | state  | `paymentId`, `state` (`authorized`, `captured`, `failed`, `cancelled`) | `amount`: required for a settled success   |
 * | `refund`           | state  | `refundId`, `paymentId`, `status` (`succeeded`, `pending`, `failed`) | `amount`: required for `succeeded`         |
 * | `operation`        | state  | `paymentId`, `operationId`, `operation`, `status`                   | none                                       |
 * | `notice`           | signal | none; `objectId` is a payment or a refund of the binding            | none                                       |
 * | `operation_notice` | signal | none; `objectId` may be an operation, so it forms no subject        | none                                       |
 * | any other `type`   | none   | not mapped: `other` without `subject`                               | none                                       |
 *
 * Classification, in order, for each event:
 * - an unmapped type is `other` without `subject`;
 * - a signal event is `other`, with a `payment_or_refund` subject only for `notice` with a valid `objectId`;
 * - a state event missing a required identifier, with a missing or unmapped state value, is `other` with the
 *   narrowest truthful `subject` (a `refund` subject needs `refundId`, a `payment` subject needs `paymentId`; a
 *   `reference` alone forms none);
 * - a settled success (`authorized`, `captured`, refund `succeeded`) with its identifiers but without a valid
 *   amount is `unrepresentable_success` for the first such event, and the delivery fails as a whole;
 * - a `failed` / `cancelled` payment or `pending` / `failed` refund with an unusable amount carries
 *   `providerAmountUnusable: true`; with an absent amount it carries none;
 * - any other state event is its state kind.
 *
 * `eventId` is copied only when the event carries a non-empty string. A body that is not JSON, has no `events`
 * array, or has an event without a string `type` is `malformed`.
 *
 * @param provider - The binding id, copied onto every notification and onto the case B details.
 * @param body - The authentic raw body.
 *
 * @returns Every event in delivery order; `malformed` when events or types cannot be determined; or
 * `unrepresentable_success` for the first event meeting VR-9 (VR-4, VR-9, VR-10).
 */
export function classifyMemoryDelivery(
  provider: string,
  body: Uint8Array
): Result<ReadonlyArray<PaymentNotification>, PaymentError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(body));
  } catch {
    return failure(new PaymentError("invalid_notification", { details: { cause: "malformed" } }));
  }

  const events = asObject(parsed)?.["events"];
  const objects = Array.isArray(events) ? events.map(asObject) : undefined;
  if (
    objects === undefined ||
    objects.some((event) => event === undefined || text(event, "type") === undefined)
  ) {
    return failure(new PaymentError("invalid_notification", { details: { cause: "malformed" } }));
  }

  const notifications: PaymentNotification[] = [];
  for (const event of objects) {
    const type = event ? text(event, "type") : undefined;
    if (event === undefined || type === undefined) continue;
    const entry = classifyEvent(provider, type, event);
    if ("failure" in entry) return failure(entry.failure);
    notifications.push(entry.notification);
  }
  return success(notifications);
}
