import type { Result } from "@comity/primitives/result";
import { success } from "@comity/primitives/result";

import type {
  PaymentCapabilities,
  PaymentProviderBinding,
} from "../contracts/payment-capabilities.js";
import type { PaymentOperationOutcome, PaymentOutcome } from "../contracts/payment-outcome.js";
import type { PaymentError } from "../errors/payment.js";

/** A minimal synchronous capability declaration: valid on its own. */
export const syncCapabilities: PaymentCapabilities = {
  asynchronousInitiation: false,
  customerActions: [],
  statusLookup: false,
  notifications: false,
  operationLookup: false,
  manualCapture: false,
  cancel: false,
  refund: false,
  incompleteResolution: false,
  idempotencyRetentionSeconds: 86_400,
};

/** A fully featured asynchronous declaration: valid on its own. */
export const asyncCapabilities: PaymentCapabilities = {
  asynchronousInitiation: true,
  customerActions: ["redirect"],
  statusLookup: true,
  notifications: true,
  operationLookup: true,
  manualCapture: { asynchronous: true },
  cancel: { incomplete: true, authorized: true, asynchronous: true },
  refund: { partial: true, multiple: true, asynchronous: true },
  incompleteResolution: { kind: "cancel" },
  idempotencyRetentionSeconds: 86_400,
};

const neverOutcome = async (): Promise<Result<PaymentOutcome, PaymentError>> =>
  success({ state: "pending", provider: "test" });
const neverNullable = async (): Promise<Result<PaymentOutcome | null, PaymentError>> =>
  success(null);
const neverOperation = async (): Promise<Result<PaymentOperationOutcome | null, PaymentError>> =>
  success(null);

/** Builds a binding whose ports match `capabilities`, so that only the descriptor decides validity. */
export function bindingFor(capabilities: PaymentCapabilities, id = "test"): PaymentProviderBinding {
  return {
    id,
    capabilities,
    provider: { initiate: neverOutcome },
    ...(capabilities.statusLookup ? { status: { retrieve: neverNullable } } : {}),
    ...(capabilities.notifications ? { notifications: { verify: async () => success([]) } } : {}),
    ...(capabilities.operationLookup ? { operations: { retrieveOperation: neverOperation } } : {}),
    ...(capabilities.manualCapture !== false
      ? {
          capture: {
            capture: async () =>
              success({
                operation: "capture",
                status: "succeeded",
                provider: id,
                paymentId: "p",
              } as const),
          },
        }
      : {}),
    ...(capabilities.cancel !== false
      ? {
          cancel: {
            cancel: async () =>
              success({
                operation: "cancel",
                status: "succeeded",
                provider: id,
                paymentId: "p",
              } as const),
          },
        }
      : {}),
    ...(capabilities.refund !== false
      ? {
          refund: {
            refund: async () =>
              success({ status: "failed", provider: id, paymentId: "p" } as const),
            retrieveRefund: async () => success(null),
          },
        }
      : {}),
  };
}
