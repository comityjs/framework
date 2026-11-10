import type { ModuleSetupContext } from "@comity/composition/setup";

import { describe, expect, it } from "vitest";
import { DefaultDiContainer } from "@comity/primitives/di";
import { DefaultHookBus } from "@comity/primitives/lifecycle";

import composition, { PAYMENT_PROVIDER_TOKEN } from "../setup/index.js";
import type { PaymentModuleOptions } from "../setup/composition.js";
import * as root from "../index.js";
import { MemoryPaymentProvider } from "../providers/memory.js";
import { asyncCapabilities, bindingFor, syncCapabilities } from "./fixtures.js";

function createContext() {
  const services = new DefaultDiContainer<any>();
  const ctx = {
    services,
    events: {},
    hooks: new DefaultHookBus<any>(),
  } as unknown as ModuleSetupContext;
  return { ctx, services };
}

async function compose(options?: PaymentModuleOptions) {
  const { ctx, services } = createContext();
  const setup = await composition.setup(ctx as never, options);
  if (!setup.success) throw new Error("setup failed");
  return { init: await setup.value(), services };
}

describe("payment module composition", () => {
  it("resolves the validated binding through the token", async () => {
    const binding = bindingFor(asyncCapabilities);
    const { init, services } = await compose({ binding });

    expect(init.success).toBe(true);
    expect(services.resolve(PAYMENT_PROVIDER_TOKEN)).toBe(binding);
  });

  it("composes the in-memory provider binding", async () => {
    const memory = new MemoryPaymentProvider({ asynchronousCapture: true });
    const { init, services } = await compose({ binding: memory.binding });

    expect(init.success).toBe(true);
    expect(services.resolve(PAYMENT_PROVIDER_TOKEN)).toBe(memory.binding);
  });

  it("composes a valid synchronous binding", async () => {
    const { init } = await compose({ binding: bindingFor(syncCapabilities) });
    expect(init.success).toBe(true);
  });

  it("refuses to compose an invalid binding with invalid_configuration naming the rule", async () => {
    const binding = bindingFor({ ...asyncCapabilities, incompleteResolution: false });
    const { init, services } = await compose({ binding });

    expect(init.success).toBe(false);
    if (!init.success) {
      expect(init.error.meta.reason).toBe("invalid_configuration");
      expect(
        (init.error.meta.details as { violations: ReadonlyArray<{ rule: string }> }).violations.map(
          (v) => v.rule
        )
      ).toEqual(["C-11"]);
    }
    expect(services.resolve(PAYMENT_PROVIDER_TOKEN)).toBeUndefined();
  });

  it("does not accept a bare provider in place of a binding", async () => {
    const bare = { initiate: bindingFor(syncCapabilities).provider.initiate };
    // @ts-expect-error a provider without its capability declaration is not a PaymentModuleOptions
    const options: PaymentModuleOptions = { provider: bare };
    const { init, services } = await compose(options);

    expect(init.success).toBe(true);
    expect(services.resolve(PAYMENT_PROVIDER_TOKEN)).toBeUndefined();
  });

  it("resolves undefined when no binding is configured", async () => {
    const { init, services } = await compose();

    expect(init.success).toBe(true);
    expect(services.resolve(PAYMENT_PROVIDER_TOKEN)).toBeUndefined();
  });
});

describe("public exports", () => {
  it("exports the validator, the conformance runner and the test double", () => {
    expect(typeof root.validatePaymentProviderBinding).toBe("function");
    expect(typeof root.getPaymentBindingViolations).toBe("function");
    expect(typeof root.runPaymentOperationConformance).toBe("function");
    expect(typeof root.isPaymentOperationConformant).toBe("function");
    expect(typeof root.MemoryPaymentProvider).toBe("function");
  });

  it("keeps the module setup contract on the setup entry point", () => {
    expect(composition.name).toBe("@comity/payment");
    expect(typeof PAYMENT_PROVIDER_TOKEN).toBe("symbol");
  });
});
