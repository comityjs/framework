import type { ModuleSetupContext } from "@comity/composition/setup";

import type { PaymentProviderBinding } from "../contracts/payment-capabilities.js";
import type { PAYMENT_PROVIDER_TOKEN } from "./constants.js";

/** Hooks exposed by the module */
export interface PaymentModuleHooks {
  /** Called when the payment module is being configured. */
  "@comity/payment:configuring": PaymentModuleOptions;

  /** Called when the payment module has been initialized. */
  "@comity/payment:initialized": undefined;

  [key: string]: unknown;
}

/** Events emitted by the module */
export type PaymentModuleEvents = {};

/**
 * Services exposed by the module
 */
export type PaymentModuleServices = {
  /** Payment provider binding resolver token: the validated provider with its capability declaration */
  [PAYMENT_PROVIDER_TOKEN]: PaymentProviderBinding;
};

/**
 * Context provided to the payment module setup function.
 */
export interface PaymentModuleContext extends ModuleSetupContext<
  PaymentModuleServices,
  PaymentModuleEvents,
  PaymentModuleHooks
> {}

/** Options of the payment module. */
export type PaymentModuleOptions = {
  /** The provider binding to use. Required for production. Validated at composition (ADR-037 §5). */
  binding?: PaymentProviderBinding;
};
