import type { ModuleMeta } from "@comity/composition/setup";
import { failure, success } from "@comity/primitives/result";
import type { PaymentProviderBinding } from "../contracts/payment-capabilities.js";
import { validatePaymentProviderBinding } from "../validation/validate-binding.js";

import { PAYMENT_PROVIDER_TOKEN } from "./constants.js";
import type { PaymentModuleContext, PaymentModuleServices } from "./types.js";

/** Options of the payment module. */
export type PaymentModuleOptions = {
  /**
   * The provider binding to use: the provider with its capability declaration. Required for production.
   * It is validated against the static rules of ADR-037 §5 when the module is configured; an invalid binding
   * fails composition with `invalid_configuration`.
   */
  binding?: PaymentProviderBinding;
};

export default {
  name: "@comity/payment",
  version: "0.1.0",

  dependsOn: {},
  incompatibleWith: [],

  /** @inheritdoc */
  setup: async (ctx: PaymentModuleContext, options?: PaymentModuleOptions) => {
    const initial: PaymentModuleOptions = {
      ...(options ?? {}),
    };

    let binding: PaymentModuleServices[typeof PAYMENT_PROVIDER_TOKEN] | undefined;

    ctx.services.define(PAYMENT_PROVIDER_TOKEN, () => binding!);

    return success(async () => {
      const cfg = (await ctx.hooks.execute("@comity/payment:configuring", initial)) ?? initial;

      if (!cfg.binding) {
        // No binding configured: resolving PAYMENT_PROVIDER_TOKEN yields undefined (it does not throw),
        // following the Comity convention for unconfigured optional services. The Application must wire a binding.
      } else {
        const validation = validatePaymentProviderBinding(cfg.binding);
        if (!validation.success) {
          return failure(validation.error);
        }
        binding = cfg.binding;
      }

      await ctx.hooks.execute("@comity/payment:initialized", undefined);

      return success(undefined);
    });
  },
} satisfies ModuleMeta<PaymentModuleOptions, PaymentModuleContext>;
