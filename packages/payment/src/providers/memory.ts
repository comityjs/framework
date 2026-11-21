import type { Result } from "@comity/primitives/result";
import type { Money } from "@comity/pricing";
import type {
  PaymentCapabilities,
  PaymentProviderBinding,
} from "../contracts/payment-capabilities.js";
import type {
  PaymentNotification,
  PaymentNotificationDelivery,
  PaymentNotificationVerifier,
} from "../contracts/payment-notification.js";
import type {
  OperationStatus,
  PaymentOperationOutcome,
  PaymentOutcome,
  PaymentState,
  PaymentStatus,
} from "../contracts/payment-outcome.js";
import type {
  PaymentCancelProvider,
  PaymentCancelRequest,
  PaymentCaptureProvider,
  PaymentCaptureRequest,
  PaymentOperationLookup,
  PaymentProvider,
  PaymentStatusProvider,
} from "../contracts/payment-provider.js";
import type {
  PaymentRefundProvider,
  RefundOutcome,
  RefundRequest,
} from "../contracts/payment-refund.js";
import type { PaymentRequest } from "../contracts/payment-request.js";

import { failure, success } from "@comity/primitives/result";
import { Instant } from "@comity/primitives/time";
import { PaymentError } from "../errors/payment.js";
import { classifyMemoryDelivery } from "./memory-events.js";

/** Header carrying the identity of a delivery issued by {@link MemoryPaymentProvider}. */
const DELIVERY_HEADER = "x-memory-delivery";

/** Base of the redirect URL returned for `requires_action`. The `.invalid` TLD never resolves. */
const REDIRECT_BASE = "https://memory.invalid/redirect/";

/** Shared encoder for delivery bodies. */
const encoder = new TextEncoder();

/** Options of {@link MemoryPaymentProvider}. Every option is a deterministic behaviour switch of the test double. */
export interface MemoryPaymentProviderOptions {
  /** Binding identifier carried as `provider` on every result. Default `"memory"`. */
  readonly id?: string;

  /** Offer manual capture (the `capture` port). Default `true`. When `false`, `capture: "manual"` is `unsupported`. */
  readonly manualCapture?: boolean;

  /** Captures return `pending` until {@link MemoryPaymentProvider.settleOperation}. Default `false`. */
  readonly asynchronousCapture?: boolean;

  /** Cancels return `pending` until {@link MemoryPaymentProvider.settleOperation}. Default `false`. */
  readonly asynchronousCancel?: boolean;

  /** Refunds return `pending` until {@link MemoryPaymentProvider.settleRefund}. Default `false`. */
  readonly asynchronousRefund?: boolean;

  /**
   * Declared idempotency retention (ADR-030 §4). Default 86 400. The test double never forgets a key while the
   * instance lives, so any positive value is honoured within that instance.
   */
  readonly idempotencyRetentionSeconds?: number;

  /** Source of informational timestamps (`authorizedAt`, ...). Default {@link Instant.now}. Behaviour never depends on it. */
  readonly clock?: () => Instant;
}

/** Internal state of one payment. */
interface PaymentRecord {
  /** Provider payment identifier. */
  readonly paymentId: string;

  /** The `PaymentAttemptId` the payment was created with. */
  readonly reference: string;

  /** The amount the payment was created with. */
  readonly amount: Money;

  /** Capture mode of the payment. */
  readonly capture: PaymentRequest["capture"];

  /** Current payment state. */
  readonly state: PaymentState;

  /** When it was authorized. */
  readonly authorizedAt?: Instant;

  /** When it was captured. */
  readonly capturedAt?: Instant;
}

/** Internal state of one capture or cancel operation. */
interface OperationRecord {
  /** Provider operation identifier. */
  readonly operationId: string;

  /** Operation kind. */
  readonly operation: "capture" | "cancel";

  /** The payment the operation acts on. */
  readonly paymentId: string;

  /** Current operation status. */
  readonly status: OperationStatus;

  /** When it completed. */
  readonly completedAt?: Instant;
}

/** Internal state of one refund. */
interface RefundRecord {
  /** Provider refund identifier. */
  readonly refundId: string;

  /** The refunded payment. */
  readonly paymentId: string;

  /** The `RefundAttemptId`. */
  readonly reference: string;

  /** The refund amount. */
  readonly amount: Money;

  /** Current refund status. */
  readonly status: OperationStatus;

  /** When it succeeded. */
  readonly refundedAt?: Instant;
}

/** One remembered idempotency key: the command kind, its request fingerprint and its first result. */
type IdempotencyEntry =
  | {
      /** Command kind. */
      readonly kind: "initiate";

      /** Fingerprint of the Comity-owned request fields. */
      readonly fingerprint: string;

      /** The first result, replayed as is. */
      readonly result: PaymentOutcome;
    }
  | {
      /** Command kind. */
      readonly kind: "capture" | "cancel";

      /** Fingerprint of the Comity-owned request fields. */
      readonly fingerprint: string;

      /** The first result, replayed as is. */
      readonly result: PaymentOperationOutcome;
    }
  | {
      /** Command kind. */
      readonly kind: "refund";

      /** Fingerprint of the Comity-owned request fields. */
      readonly fingerprint: string;

      /** The first result, replayed as is. */
      readonly result: RefundOutcome;
    };

/**
 * One row of the verification result matrix (assessment AP11.12, "Final consolidated specification", rows 1 to 13),
 * for {@link MemoryPaymentProvider.issueMatrixRow}.
 */
export type MemoryPaymentMatrixRow = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;

/** A delivery issued by the test double. */
interface IssuedDelivery {
  /** The exact bytes issued. */
  readonly body: Uint8Array;

  /** The normalized notifications of the delivery, when issued by a scripted transition; otherwise the body is classified. */
  readonly notifications?: ReadonlyArray<PaymentNotification>;
}

/**
 * The JSON body of a raw memory delivery.
 *
 * @param list - The wire events, in delivery order.
 *
 * @returns The body text.
 */
function wireBody(...list: ReadonlyArray<Readonly<Record<string, unknown>>>): string {
  return JSON.stringify({ events: list });
}

/**
 * Default clock of informational timestamps.
 *
 * @returns The current instant.
 */
function systemClock(): Instant {
  return Instant.now();
}

/**
 * ADR-030 §3 key format: 1–255 characters, no whitespace or control characters.
 *
 * @param key - The idempotency key.
 *
 * @returns Whether the key is well formed.
 */
function isWellFormedKey(key: string): boolean {
  return key.length >= 1 && key.length <= 255 && !/[\s\p{Cc}]/u.test(key);
}

/**
 * Canonical text of a money value for request fingerprints.
 *
 * @param money - The amount.
 *
 * @returns Minor units, currency code and exponent.
 */
function moneyKey(money: Money): string {
  return `${money.amount}:${money.currency.code}:${money.currency.exponent}`;
}

/**
 * Byte-wise equality.
 *
 * @param a - First buffer.
 * @param b - Second buffer.
 *
 * @returns Whether both hold the same bytes.
 */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/**
 * A malformed-request error.
 *
 * @param reference - The caller reference, when known.
 *
 * @returns `invalid_request` with cause `malformed`.
 */
function malformed(reference?: string): PaymentError {
  return new PaymentError("invalid_request", {
    details: reference === undefined ? { cause: "malformed" } : { cause: "malformed", reference },
  });
}

/**
 * An unsupported-option error.
 *
 * @param reference - The caller reference, when known.
 *
 * @returns `invalid_request` with cause `unsupported`.
 */
function unsupported(reference?: string): PaymentError {
  return new PaymentError("invalid_request", {
    details:
      reference === undefined ? { cause: "unsupported" } : { cause: "unsupported", reference },
  });
}

/**
 * A same-key, different-request conflict (ADR-030 §5).
 *
 * @param reference - The caller reference, when known.
 *
 * @returns `idempotency_conflict` with cause `request_mismatch`.
 */
function mismatch(reference?: string): PaymentError {
  return new PaymentError("idempotency_conflict", {
    details:
      reference === undefined
        ? { cause: "request_mismatch" }
        : { cause: "request_mismatch", reference },
  });
}

/**
 * Deterministic in-memory implementation of every Payment port, for tests and local development.
 *
 * **A test double, not a provider.** Nothing is persisted or shared across instances; idempotency and every
 * guarantee hold only within one instance. Passing tests against it proves nothing about a real PSP.
 *
 * Behaviour:
 * - Every port is implemented: initiation, `retrieve`, capture, cancel, `retrieveOperation`, refund,
 *   `retrieveRefund` and notification verification. {@link MemoryPaymentProvider.binding} declares exactly the
 *   capabilities configured by the options, and is valid under `validatePaymentProviderBinding`.
 * - **Idempotency (ADR-030 §5):** one key space per instance across all commands. Same key and same request
 *   replays the first result unchanged (it may report an older state); same key with a different request, or with
 *   another command kind, is `idempotency_conflict` (`request_mismatch`). Calls complete synchronously within the
 *   instance, so `in_progress` never arises. Rejected requests (`invalid_request`) consume no key.
 * - **Scripted initiation** by the reference prefix: `fail:` → `failed`, `cancel:` → `cancelled`,
 *   `pending:` → `pending`, `action:` → `requires_action` (a redirect; requires `returnUrl`). Otherwise
 *   `captured` for `capture: "automatic"` and `authorized` for `capture: "manual"`.
 * - **Scripted asynchronous transitions** happen only when a test calls {@link MemoryPaymentProvider.settlePayment},
 *   {@link MemoryPaymentProvider.settleOperation} or {@link MemoryPaymentProvider.settleRefund}. Each returns the raw
 *   delivery the provider would send, which {@link MemoryPaymentProvider.verify} accepts. No timers, no clock-driven
 *   behaviour.
 * - **Simulated confirmation:** for `authorized`, `captured`, a `succeeded` capture and a `succeeded` refund, the
 *   double plays the provider and reports the requested amount as the provider-confirmed amount. Every non-settled
 *   outcome (`pending`, `requires_action`, `failed`, `cancelled`, pending refunds and captures) carries no amount: the
 *   requested amount is never echoed as provider-reported (ADR-037 §3).
 * - **Event mapping:** {@link MemoryPaymentProvider.issueRaw} and {@link MemoryPaymentProvider.issueMatrixRow} issue
 *   deliveries that `verify` classifies through the documented mapping of `memory-events.ts` (assessment AP11.12,
 *   VR-10). Such notifications carry an `eventId` only when the event supplies one.
 * - Identifiers are deterministic per instance: `mem_pay_n`, `mem_op_n`, `mem_re_n`, `mem_evt_n`.
 * - Capture is of the full authorized amount only (v1); another amount is `unsupported`. Over-refunds are `failed`
 *   outcomes, as a provider would decline them.
 */
export class MemoryPaymentProvider
  implements
    PaymentProvider,
    PaymentStatusProvider,
    PaymentCaptureProvider,
    PaymentCancelProvider,
    PaymentOperationLookup,
    PaymentRefundProvider,
    PaymentNotificationVerifier
{
  /** The binding of this instance: its capability declaration and its ports. */
  readonly binding: PaymentProviderBinding;

  readonly #id: string;
  readonly #manualCapture: boolean;
  readonly #asynchronousCapture: boolean;
  readonly #asynchronousCancel: boolean;
  readonly #asynchronousRefund: boolean;
  readonly #clock: () => Instant;

  readonly #payments = new Map<string, PaymentRecord>();
  readonly #operations = new Map<string, OperationRecord>();
  readonly #refunds = new Map<string, RefundRecord>();
  readonly #keys = new Map<string, IdempotencyEntry>();
  readonly #deliveries = new Map<string, IssuedDelivery>();
  readonly #counters = { payment: 0, operation: 0, refund: 0, event: 0, delivery: 0 };

  /**
   * @param options - Deterministic behaviour switches.
   */
  constructor(options: MemoryPaymentProviderOptions = {}) {
    this.#id = options.id ?? "memory";
    this.#manualCapture = options.manualCapture ?? true;
    this.#asynchronousCapture = options.asynchronousCapture ?? false;
    this.#asynchronousCancel = options.asynchronousCancel ?? false;
    this.#asynchronousRefund = options.asynchronousRefund ?? false;
    this.#clock = options.clock ?? systemClock;

    const capabilities: PaymentCapabilities = {
      asynchronousInitiation: true,
      customerActions: ["redirect"],
      statusLookup: true,
      notifications: true,
      operationLookup: true,
      manualCapture: this.#manualCapture ? { asynchronous: this.#asynchronousCapture } : false,
      cancel: { incomplete: true, authorized: true, asynchronous: this.#asynchronousCancel },
      refund: { partial: true, multiple: true, asynchronous: this.#asynchronousRefund },
      incompleteResolution: { kind: "cancel" },
      idempotencyRetentionSeconds: options.idempotencyRetentionSeconds ?? 86_400,
    };

    this.binding = {
      id: this.#id,
      capabilities,
      provider: this,
      status: this,
      ...(this.#manualCapture ? { capture: this } : {}),
      cancel: this,
      operations: this,
      refund: this,
      notifications: this,
    };
  }

  /**
   * @inheritdoc
   */
  async initiate(request: PaymentRequest): Promise<Result<PaymentOutcome, PaymentError>> {
    const { reference } = request;
    if (!isWellFormedKey(request.idempotencyKey) || reference.length === 0) {
      return failure(malformed(reference));
    }

    const fingerprint = JSON.stringify([
      moneyKey(request.amount),
      reference,
      request.capture,
      request.returnUrl ?? null,
    ]);
    const prior = this.#keys.get(request.idempotencyKey);
    if (prior) {
      return prior.kind === "initiate" && prior.fingerprint === fingerprint
        ? success(prior.result)
        : failure(mismatch(reference));
    }

    if (request.amount.amount <= 0n) {
      return failure(malformed(reference));
    }
    if (request.capture === "manual" && !this.#manualCapture) {
      return failure(unsupported(reference));
    }

    const state = this.#scriptedState(request);
    if (state === "requires_action" && request.returnUrl === undefined) {
      return failure(malformed(reference));
    }

    const now = this.#clock();
    const record: PaymentRecord = {
      paymentId: `mem_pay_${++this.#counters.payment}`,
      reference,
      amount: request.amount,
      capture: request.capture,
      state,
      ...(state === "authorized" || state === "captured" ? { authorizedAt: now } : {}),
      ...(state === "captured" ? { capturedAt: now } : {}),
    };
    this.#payments.set(record.paymentId, record);

    const outcome = this.#paymentOutcome(record);
    this.#keys.set(request.idempotencyKey, { kind: "initiate", fingerprint, result: outcome });
    return success(outcome);
  }

  /**
   * @inheritdoc
   */
  async retrieve(paymentId: string): Promise<Result<PaymentOutcome | null, PaymentError>> {
    const record = this.#payments.get(paymentId);
    return success(record ? this.#paymentOutcome(record) : null);
  }

  /**
   * @inheritdoc
   */
  async capture(
    request: PaymentCaptureRequest
  ): Promise<Result<PaymentOperationOutcome, PaymentError>> {
    if (!this.#manualCapture) {
      return failure(unsupported());
    }
    if (!isWellFormedKey(request.idempotencyKey)) {
      return failure(malformed());
    }

    const fingerprint = JSON.stringify([request.paymentId, moneyKey(request.amount)]);
    const prior = this.#keys.get(request.idempotencyKey);
    if (prior) {
      return prior.kind === "capture" && prior.fingerprint === fingerprint
        ? success(prior.result)
        : failure(mismatch());
    }

    const payment = this.#payments.get(request.paymentId);
    if (!payment) {
      return failure(new PaymentError("invalid_request"));
    }
    if (!payment.amount.currency.equals(request.amount.currency)) {
      return failure(malformed(payment.reference));
    }
    if (payment.amount.amount !== request.amount.amount) {
      return failure(unsupported(payment.reference));
    }

    let status: OperationStatus;
    if (payment.state !== "authorized" || payment.capture !== "manual") {
      status = "failed";
    } else if (this.#asynchronousCapture) {
      status = "pending";
    } else {
      status = "succeeded";
      this.#payments.set(payment.paymentId, {
        ...payment,
        state: "captured",
        capturedAt: this.#clock(),
      });
    }

    const outcome = this.#recordOperation("capture", payment.paymentId, status);
    this.#keys.set(request.idempotencyKey, { kind: "capture", fingerprint, result: outcome });
    return success(outcome);
  }

  /**
   * @inheritdoc
   */
  async cancel(
    request: PaymentCancelRequest
  ): Promise<Result<PaymentOperationOutcome, PaymentError>> {
    if (!isWellFormedKey(request.idempotencyKey)) {
      return failure(malformed());
    }

    const fingerprint = JSON.stringify([request.paymentId]);
    const prior = this.#keys.get(request.idempotencyKey);
    if (prior) {
      return prior.kind === "cancel" && prior.fingerprint === fingerprint
        ? success(prior.result)
        : failure(mismatch());
    }

    const payment = this.#payments.get(request.paymentId);
    if (!payment) {
      return failure(new PaymentError("invalid_request"));
    }

    let status: OperationStatus;
    if (!this.#isCancellable(payment.state)) {
      status = "failed";
    } else if (this.#asynchronousCancel) {
      status = "pending";
    } else {
      status = "succeeded";
      this.#payments.set(payment.paymentId, { ...payment, state: "cancelled" });
    }

    const outcome = this.#recordOperation("cancel", payment.paymentId, status);
    this.#keys.set(request.idempotencyKey, { kind: "cancel", fingerprint, result: outcome });
    return success(outcome);
  }

  /**
   * @inheritdoc
   */
  async retrieveOperation(
    operationId: string
  ): Promise<Result<PaymentOperationOutcome | null, PaymentError>> {
    const record = this.#operations.get(operationId);
    return success(record ? this.#operationOutcome(record) : null);
  }

  /**
   * @inheritdoc
   */
  async refund(request: RefundRequest): Promise<Result<RefundOutcome, PaymentError>> {
    const { reference } = request;
    if (!isWellFormedKey(request.idempotencyKey) || reference.length === 0) {
      return failure(malformed(reference));
    }

    const fingerprint = JSON.stringify([request.paymentId, moneyKey(request.amount), reference]);
    const prior = this.#keys.get(request.idempotencyKey);
    if (prior) {
      return prior.kind === "refund" && prior.fingerprint === fingerprint
        ? success(prior.result)
        : failure(mismatch(reference));
    }

    const payment = this.#payments.get(request.paymentId);
    if (!payment) {
      return failure(new PaymentError("invalid_request", { details: { reference } }));
    }
    if (request.amount.amount <= 0n || !payment.amount.currency.equals(request.amount.currency)) {
      return failure(malformed(reference));
    }

    let outcome: RefundOutcome;
    const committed = [...this.#refunds.values()]
      .filter((r) => r.paymentId === payment.paymentId && r.status !== "failed")
      .reduce((sum, r) => sum + r.amount.amount, 0n);

    if (payment.state !== "captured" || committed + request.amount.amount > payment.amount.amount) {
      outcome = { provider: this.#id, paymentId: payment.paymentId, reference, status: "failed" };
    } else {
      const record: RefundRecord = {
        refundId: `mem_re_${++this.#counters.refund}`,
        paymentId: payment.paymentId,
        reference,
        amount: request.amount,
        status: this.#asynchronousRefund ? "pending" : "succeeded",
        ...(this.#asynchronousRefund ? {} : { refundedAt: this.#clock() }),
      };
      this.#refunds.set(record.refundId, record);
      outcome = this.#refundOutcome(record);
    }

    this.#keys.set(request.idempotencyKey, { kind: "refund", fingerprint, result: outcome });
    return success(outcome);
  }

  /**
   * @inheritdoc
   */
  async retrieveRefund(refundId: string): Promise<Result<RefundOutcome | null, PaymentError>> {
    const record = this.#refunds.get(refundId);
    return success(record ? this.#refundOutcome(record) : null);
  }

  /**
   * Accepts only deliveries issued by this instance, byte for byte. Anything else is `invalid_notification` with
   * cause `signature`: the double stands in for the adapter's authenticity check. Deliveries issued through
   * {@link MemoryPaymentProvider.issueRaw} are classified by the documented event mapping (`memory-events.ts`),
   * which yields `malformed`, `unrepresentable_success` or the notifications in delivery order.
   *
   * @param input - The raw delivery.
   *
   * @returns The normalized notifications of the delivery.
   */
  async verify(
    input: PaymentNotificationDelivery
  ): Promise<Result<ReadonlyArray<PaymentNotification>, PaymentError>> {
    const deliveryId = input.headers[DELIVERY_HEADER];
    const issued = deliveryId === undefined ? undefined : this.#deliveries.get(deliveryId);
    if (!issued || !sameBytes(issued.body, input.body)) {
      return failure(new PaymentError("invalid_notification", { details: { cause: "signature" } }));
    }
    return issued.notifications
      ? success(issued.notifications)
      : classifyMemoryDelivery(this.#id, issued.body);
  }

  /**
   * Test control: issues a delivery with exactly these bytes as an authentic delivery of this instance. {@link
   * MemoryPaymentProvider.verify} classifies it through the documented event mapping (see `memory-events.ts`):
   * the body is JSON `{ "events": [ { "type": ..., ... } ] }`.
   *
   * @param body - The raw delivery body.
   *
   * @returns The raw delivery.
   */
  issueRaw(body: string): PaymentNotificationDelivery {
    return this.#issueBody(encoder.encode(body));
  }

  /**
   * Test control: issues the delivery of one row of the verification result matrix, so that `verify` returns the
   * result that row specifies. Rows 1 to 11 are issued through the documented event mapping:
   * 1 authenticity not established; 2 authentic, undeterminable events; 3 a state event with only optional fields
   * missing; 4 a confirmed failure with an unusable amount; 5 a signal event with a subject; 6 an unmapped event
   * type; 7 a settled payment success missing `paymentId`; 8 a signal event whose identifier may be an operation (no
   * subject); 9 a settled success whose amount is absent; 10 several representable events; 11 a representable
   * event and a row 9 event.
   *
   * Rows 12 and 13 concern the application's ingress, not the verifier's classification. Row 12 issues a delivery
   * that verifies to a notification whose `provider` is not this binding (a deliberate fault). Row 13 issues an
   * ordinary representable delivery, whose persistence the application's store then fails.
   *
   * @param row - The matrix row.
   *
   * @returns The raw delivery.
   */
  issueMatrixRow(row: MemoryPaymentMatrixRow): PaymentNotificationDelivery {
    const amount = { minor: "10000", currency: "EUR" };
    const captured = { type: "payment", paymentId: "mem_pay_row", state: "captured", amount };
    const unrepresentable = { type: "payment", paymentId: "mem_pay_row", state: "authorized" };

    switch (row) {
      case 1:
        return {
          ...this.issueRaw(wireBody(captured)),
          headers: { [DELIVERY_HEADER]: "mem_dlv_unissued" },
        };
      case 2:
        return this.issueRaw(JSON.stringify({ events: "undeterminable" }));
      case 3:
      case 13:
        return this.issueRaw(wireBody(captured));
      case 4:
        return this.issueRaw(
          wireBody({
            type: "payment",
            paymentId: "mem_pay_row",
            state: "failed",
            amount: { minor: "-1", currency: "EUR" },
          })
        );
      case 5:
        return this.issueRaw(
          wireBody({ type: "notice", objectId: "mem_obj_row", reference: "att-row" })
        );
      case 6:
        return this.issueRaw(wireBody({ type: "memory.unmapped" }));
      case 7:
        return this.issueRaw(wireBody({ type: "payment", state: "captured", amount }));
      case 8:
        return this.issueRaw(wireBody({ type: "operation_notice", objectId: "mem_obj_row" }));
      case 9:
        return this.issueRaw(wireBody(unrepresentable));
      case 10:
        return this.issueRaw(
          wireBody(captured, {
            type: "refund",
            refundId: "mem_re_row",
            paymentId: "mem_pay_row",
            status: "succeeded",
            amount,
          })
        );
      case 11:
        return this.issueRaw(wireBody(captured, unrepresentable));
      case 12:
        return this.#issue([
          { kind: "other", provider: "mem_foreign", providerEventType: "foreign" },
        ]);
    }
  }

  /**
   * Test control: completes an incomplete payment, or moves an automatic-capture authorization on, as the provider
   * would. Allowed from `pending` / `requires_action` to any settled state, and from an automatic-capture `authorized`
   * payment to `captured`, `failed` or `cancelled`.
   *
   * @param paymentId - The payment to transition.
   * @param state - The new settled state.
   *
   * @returns The raw delivery announcing the transition, or `invalid_request` for a transition the script forbids.
   */
  settlePayment(
    paymentId: string,
    state: PaymentStatus
  ): Result<PaymentNotificationDelivery, PaymentError> {
    const payment = this.#payments.get(paymentId);
    const incomplete = payment?.state === "pending" || payment?.state === "requires_action";
    const automaticAuthorization =
      payment?.state === "authorized" && payment.capture === "automatic" && state !== "authorized";
    if (!payment || !(incomplete || automaticAuthorization)) {
      return failure(new PaymentError("invalid_request"));
    }

    const now = this.#clock();
    const next: PaymentRecord = {
      ...payment,
      state,
      ...((state === "authorized" || state === "captured") && payment.authorizedAt === undefined
        ? { authorizedAt: now }
        : {}),
      ...(state === "captured" ? { capturedAt: now } : {}),
    };
    this.#payments.set(paymentId, next);
    return success(this.#issue([this.#paymentNotification(next)]));
  }

  /**
   * Test control: completes a `pending` capture or cancel operation. A `succeeded` capture moves the payment to
   * `captured`; a `succeeded` cancel moves it to `cancelled`.
   *
   * @param operationId - The pending operation.
   * @param status - The final operation status.
   *
   * @returns The raw delivery (`operation` notification, plus the `payment` notification on success), or
   * `invalid_request` when the operation is not pending or the payment no longer allows the success.
   */
  settleOperation(
    operationId: string,
    status: "succeeded" | "failed"
  ): Result<PaymentNotificationDelivery, PaymentError> {
    const operation = this.#operations.get(operationId);
    const payment = operation ? this.#payments.get(operation.paymentId) : undefined;
    if (!operation || !payment || operation.status !== "pending") {
      return failure(new PaymentError("invalid_request"));
    }

    const now = this.#clock();
    let next: PaymentRecord | undefined;
    if (status === "succeeded") {
      const allowed =
        operation.operation === "capture"
          ? payment.state === "authorized"
          : this.#isCancellable(payment.state);
      if (!allowed) {
        return failure(new PaymentError("invalid_request"));
      }
      next =
        operation.operation === "capture"
          ? { ...payment, state: "captured", capturedAt: now }
          : { ...payment, state: "cancelled" };
      this.#payments.set(payment.paymentId, next);
    }

    this.#operations.set(operationId, { ...operation, status, completedAt: now });
    const notifications: PaymentNotification[] = [
      {
        kind: "operation",
        provider: this.#id,
        eventId: this.#nextEventId(),
        operation: operation.operation,
        paymentId: operation.paymentId,
        operationId,
        status,
      },
    ];
    if (next) {
      notifications.push(this.#paymentNotification(next));
    }
    return success(this.#issue(notifications));
  }

  /**
   * Test control: completes a `pending` refund.
   *
   * @param refundId - The pending refund.
   * @param status - The final refund status.
   *
   * @returns The raw delivery announcing the `refund` notification, or `invalid_request` when the refund is not pending.
   */
  settleRefund(
    refundId: string,
    status: "succeeded" | "failed"
  ): Result<PaymentNotificationDelivery, PaymentError> {
    const refund = this.#refunds.get(refundId);
    if (!refund || refund.status !== "pending") {
      return failure(new PaymentError("invalid_request"));
    }

    const next: RefundRecord = {
      ...refund,
      status,
      ...(status === "succeeded" ? { refundedAt: this.#clock() } : {}),
    };
    this.#refunds.set(refundId, next);

    const base = {
      kind: "refund",
      provider: this.#id,
      eventId: this.#nextEventId(),
      paymentId: next.paymentId,
      refundId,
      reference: next.reference,
    } as const;
    return success(
      this.#issue([
        status === "succeeded"
          ? { ...base, status: "succeeded", amount: next.amount }
          : { ...base, status: "failed" },
      ])
    );
  }

  /**
   * Initial state selected by the reference prefix and the capture mode.
   *
   * @param request - The initiation request.
   *
   * @returns The scripted initial state.
   */
  #scriptedState(request: PaymentRequest): PaymentState {
    const { reference } = request;
    if (reference.startsWith("fail:")) return "failed";
    if (reference.startsWith("cancel:")) return "cancelled";
    if (reference.startsWith("pending:")) return "pending";
    if (reference.startsWith("action:")) return "requires_action";
    return request.capture === "automatic" ? "captured" : "authorized";
  }

  /**
   * Whether a payment in this state can be cancelled: an incomplete payment or an authorization.
   *
   * @param state - The payment state.
   *
   * @returns Whether a cancel can take effect.
   */
  #isCancellable(state: PaymentState): boolean {
    return state === "pending" || state === "requires_action" || state === "authorized";
  }

  /**
   * Stores a new operation record.
   *
   * @param operation - Operation kind.
   * @param paymentId - The payment acted on.
   * @param status - Initial status.
   *
   * @returns The operation result.
   */
  #recordOperation(
    operation: "capture" | "cancel",
    paymentId: string,
    status: OperationStatus
  ): PaymentOperationOutcome {
    const record: OperationRecord = {
      operationId: `mem_op_${++this.#counters.operation}`,
      operation,
      paymentId,
      status,
      ...(status === "pending" ? {} : { completedAt: this.#clock() }),
    };
    this.#operations.set(record.operationId, record);
    return this.#operationOutcome(record);
  }

  /**
   * Current outcome of a payment record.
   *
   * @param record - The payment.
   *
   * @returns The payment outcome; an amount only on `authorized` / `captured` (simulated confirmation).
   */
  #paymentOutcome(record: PaymentRecord): PaymentOutcome {
    const base = {
      provider: this.#id,
      paymentId: record.paymentId,
      reference: record.reference,
      ...(record.authorizedAt ? { authorizedAt: record.authorizedAt } : {}),
      ...(record.capturedAt ? { capturedAt: record.capturedAt } : {}),
    };
    switch (record.state) {
      case "authorized":
      case "captured":
        return { ...base, state: record.state, amount: record.amount };
      case "requires_action":
        return {
          ...base,
          state: "requires_action",
          action: { kind: "redirect", url: `${REDIRECT_BASE}${record.paymentId}` },
        };
      default:
        return { ...base, state: record.state };
    }
  }

  /**
   * Current outcome of an operation record.
   *
   * @param record - The operation.
   *
   * @returns The operation outcome; a `succeeded` capture carries the payment amount (simulated confirmation).
   */
  #operationOutcome(record: OperationRecord): PaymentOperationOutcome {
    const base = {
      provider: this.#id,
      paymentId: record.paymentId,
      operationId: record.operationId,
      ...(record.completedAt ? { completedAt: record.completedAt } : {}),
    };
    if (record.operation === "cancel") {
      return { ...base, operation: "cancel", status: record.status };
    }
    const payment = this.#payments.get(record.paymentId);
    if (record.status === "succeeded" && payment) {
      return { ...base, operation: "capture", status: "succeeded", amount: payment.amount };
    }
    return record.status === "succeeded"
      ? { ...base, operation: "capture", status: "succeeded" }
      : { ...base, operation: "capture", status: record.status };
  }

  /**
   * Current outcome of a refund record.
   *
   * @param record - The refund.
   *
   * @returns The refund outcome; an amount only when `succeeded` (simulated confirmation).
   */
  #refundOutcome(record: RefundRecord): RefundOutcome {
    const base = {
      provider: this.#id,
      paymentId: record.paymentId,
      refundId: record.refundId,
      reference: record.reference,
    };
    if (record.status === "succeeded") {
      return {
        ...base,
        status: "succeeded",
        amount: record.amount,
        ...(record.refundedAt ? { refundedAt: record.refundedAt } : {}),
      };
    }
    return record.status === "pending"
      ? { ...base, status: "pending" }
      : { ...base, status: "failed" };
  }

  /**
   * A `payment` notification for a settled payment record.
   *
   * @param record - The payment, in a settled state.
   *
   * @returns The notification; an amount only on `authorized` / `captured`.
   */
  #paymentNotification(record: PaymentRecord): PaymentNotification {
    const base = {
      kind: "payment",
      provider: this.#id,
      eventId: this.#nextEventId(),
      paymentId: record.paymentId,
      reference: record.reference,
    } as const;
    if (record.state === "authorized" || record.state === "captured") {
      return { ...base, state: record.state, amount: record.amount };
    }
    if (record.state === "failed" || record.state === "cancelled") {
      return { ...base, state: record.state };
    }
    return {
      kind: "other",
      provider: this.#id,
      eventId: base.eventId,
      providerEventType: record.state,
    };
  }

  /**
   * Issues a delivery: stores its bytes and notifications so that {@link MemoryPaymentProvider.verify} accepts it.
   *
   * @param notifications - The events of the delivery.
   *
   * @returns The raw delivery.
   */
  #issue(notifications: ReadonlyArray<PaymentNotification>): PaymentNotificationDelivery {
    const deliveryId = `mem_dlv_${++this.#counters.delivery}`;
    const body = encoder.encode(
      JSON.stringify({
        provider: this.#id,
        deliveryId,
        events: notifications.map((n) => ({ kind: n.kind, eventId: n.eventId })),
      })
    );
    this.#deliveries.set(deliveryId, { body, notifications });
    return { body, headers: { [DELIVERY_HEADER]: deliveryId } };
  }

  /**
   * Issues a delivery of exact bytes, classified by {@link MemoryPaymentProvider.verify}.
   *
   * @param body - The raw bytes.
   *
   * @returns The raw delivery.
   */
  #issueBody(body: Uint8Array): PaymentNotificationDelivery {
    const deliveryId = `mem_dlv_${++this.#counters.delivery}`;
    this.#deliveries.set(deliveryId, { body });
    return { body, headers: { [DELIVERY_HEADER]: deliveryId } };
  }

  /**
   * Next deterministic event identifier.
   *
   * @returns A new `eventId`.
   */
  #nextEventId(): string {
    return `mem_evt_${++this.#counters.event}`;
  }
}
