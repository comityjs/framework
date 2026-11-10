import type {
  PaymentCancelProvider,
  PaymentCaptureProvider,
  PaymentOperationLookup,
  PaymentProvider,
  PaymentStatusProvider,
} from "./payment-provider.js";
import type { PaymentNotificationVerifier } from "./payment-notification.js";
import type { PaymentAction } from "./payment-outcome.js";
import type { PaymentRefundProvider } from "./payment-refund.js";

/**
 * How an incomplete (`pending` / `requires_action`) payment can be authoritatively resolved (ADR-037 §5, §6, OD-F10).
 *
 * - `false`: no mechanism declared.
 * - `{ kind: "cancel" }`: a cancellation path can resolve it (requires `cancel.incomplete`).
 * - `{ kind: "expiry"; maxSeconds }`: the provider's **documented** terminal-expiry deadline, after which `retrieve` exposes the terminal state.
 *
 * `maxSeconds` is not an application timeout and never evidence that an attempt has expired. Elapsed time only decides when
 * reconciliation is attempted; only an authoritative terminal result resolves an attempt. Whether the provider honours the
 * declaration is established by PSP selection and production acceptance, not by validation or conformance.
 */
export type PaymentIncompleteResolution =
  | false
  | {
      /** Resolution through an authoritative cancellation. */
      readonly kind: "cancel";
    }
  | {
      /** Resolution through the provider's documented terminal expiry, observed by lookup. */
      readonly kind: "expiry";

      /** The provider's documented terminal-expiry deadline, in seconds: finite and greater than zero. */
      readonly maxSeconds: number;
    };

/**
 * Static, data-only description of what a payment adapter supports (ADR-037 §5).
 *
 * Payment capabilities (`asynchronousInitiation`, `customerActions`, `incompleteResolution`), operation capabilities
 * (`manualCapture`, `cancel`, `refund`) and ports (`statusLookup`, `notifications`, `operationLookup`) are declared separately.
 */
export interface PaymentCapabilities {
  /** Initiation may return `pending` or `requires_action`. */
  readonly asynchronousInitiation: boolean;

  /** Customer actions the adapter may return. v1: `"redirect"`. */
  readonly customerActions: ReadonlyArray<PaymentAction["kind"]>;

  /** The `status` port (`retrieve`) is provided. */
  readonly statusLookup: boolean;

  /** The `notifications` port (`verify`) is provided. */
  readonly notifications: boolean;

  /** The `operations` port (`retrieveOperation`) is provided. */
  readonly operationLookup: boolean;

  /** Manual capture of the full authorized amount, and whether it may complete asynchronously. */
  readonly manualCapture:
    | false
    | {
        /** A capture may return `pending`. */
        readonly asynchronous: boolean;
      };

  /** Cancellation, the payments it applies to, and whether it may complete asynchronously. */
  readonly cancel:
    | false
    | {
        /** Incomplete (`pending` / `requires_action`) payments can be cancelled. */
        readonly incomplete: boolean;

        /** Authorizations can be voided. */
        readonly authorized: boolean;

        /** A cancel may return `pending`. */
        readonly asynchronous: boolean;
      };

  /** Refunds, their variants, and whether they may complete asynchronously. */
  readonly refund:
    | false
    | {
        /** Refunds of less than the remaining amount are accepted. */
        readonly partial: boolean;

        /** Several refunds of one payment are accepted. */
        readonly multiple: boolean;

        /** A refund may return `pending`. */
        readonly asynchronous: boolean;
      };

  /** How an incomplete payment is authoritatively resolved (rule C-11). */
  readonly incompleteResolution: PaymentIncompleteResolution;

  /** Provider idempotency retention in seconds (ADR-030 §4). Must be greater than zero (rule C-8). */
  readonly idempotencyRetentionSeconds: number;
}

/**
 * A provider instance bundled with its capability declaration and optional ports (ADR-037 §5).
 *
 * This is what the payment module composes and what `PAYMENT_PROVIDER_TOKEN` resolves. Each port must be present
 * exactly when its capability is declared (rule C-1); `validatePaymentProviderBinding` checks the static rules.
 */
export interface PaymentProviderBinding {
  /**
   * The configured provider instance (adapter plus merchant account). Scopes `paymentId`, `operationId`, `refundId`,
   * `eventId` and idempotency keys, and is carried as `provider` on outcomes, notifications and error details.
   */
  readonly id: string;

  /** The static capability declaration. */
  readonly capabilities: PaymentCapabilities;

  /** Initiation port. Always present. */
  readonly provider: PaymentProvider;

  /** Payment lookup port; present exactly when `statusLookup` is declared. */
  readonly status?: PaymentStatusProvider;

  /** Capture port; present exactly when `manualCapture` is declared. */
  readonly capture?: PaymentCaptureProvider;

  /** Cancel port; present exactly when `cancel` is declared. */
  readonly cancel?: PaymentCancelProvider;

  /** Operation lookup port; present exactly when `operationLookup` is declared. */
  readonly operations?: PaymentOperationLookup;

  /** Refund port (ADR-031); present exactly when `refund` is declared. */
  readonly refund?: PaymentRefundProvider;

  /** Notification verification port; present exactly when `notifications` is declared. */
  readonly notifications?: PaymentNotificationVerifier;
}
