import { describe, expect, it } from "vitest";

import type {
  PaymentCapabilities,
  PaymentProviderBinding,
} from "../contracts/payment-capabilities.js";
import {
  getPaymentBindingViolations,
  validatePaymentProviderBinding,
} from "../validation/validate-binding.js";
import { asyncCapabilities, bindingFor, syncCapabilities } from "./fixtures.js";

const rulesOf = (binding: PaymentProviderBinding): string[] =>
  getPaymentBindingViolations(binding).map((v) => v.rule);
const withCaps = (
  overrides: Partial<PaymentCapabilities>,
  base = asyncCapabilities
): PaymentCapabilities => ({ ...base, ...overrides });

describe("validatePaymentProviderBinding: valid bindings", () => {
  it("accepts a synchronous binding", () => {
    expect(validatePaymentProviderBinding(bindingFor(syncCapabilities)).success).toBe(true);
  });

  it("accepts a fully featured asynchronous binding", () => {
    expect(validatePaymentProviderBinding(bindingFor(asyncCapabilities)).success).toBe(true);
    expect(getPaymentBindingViolations(bindingFor(asyncCapabilities))).toEqual([]);
  });

  it("accepts synchronous manual capture with cancel of authorizations", () => {
    const caps = withCaps(
      {
        manualCapture: { asynchronous: false },
        cancel: { incomplete: false, authorized: true, asynchronous: false },
      },
      syncCapabilities
    );
    expect(rulesOf(bindingFor(caps))).toEqual([]);
  });

  it("accepts an asynchronous binding that resolves by documented expiry", () => {
    const caps = withCaps({ incompleteResolution: { kind: "expiry", maxSeconds: 3600 } });
    expect(rulesOf(bindingFor(caps))).toEqual([]);
  });

  it("imposes no condition for refund.asynchronous (C-7)", () => {
    const caps = withCaps({ refund: { partial: false, multiple: false, asynchronous: true } });
    expect(rulesOf(bindingFor(caps))).toEqual([]);
  });
});

describe("C-1: declared capability matches port presence", () => {
  const cases: ReadonlyArray<
    readonly [string, Partial<PaymentCapabilities>, keyof PaymentProviderBinding]
  > = [
    ["statusLookup", { statusLookup: true }, "status"],
    ["notifications", { notifications: true }, "notifications"],
    ["operationLookup", { operationLookup: true }, "operations"],
    [
      "manualCapture",
      {
        manualCapture: { asynchronous: false },
        cancel: { incomplete: false, authorized: true, asynchronous: false },
      },
      "capture",
    ],
    ["cancel", { cancel: { incomplete: false, authorized: true, asynchronous: false } }, "cancel"],
    ["refund", { refund: { partial: false, multiple: false, asynchronous: false } }, "refund"],
  ];

  for (const [name, declared, port] of cases) {
    it(`rejects ${name} declared without its port`, () => {
      const complete = bindingFor(withCaps(declared, syncCapabilities));
      const { [port]: _removed, ...withoutPort } = complete;
      expect(rulesOf(withoutPort as PaymentProviderBinding)).toContain("C-1");
    });

    it(`rejects the ${String(port)} port present without ${name} declared`, () => {
      const complete = bindingFor(withCaps(declared, syncCapabilities));
      const undeclared = { ...complete, capabilities: syncCapabilities };
      expect(rulesOf(undeclared)).toContain("C-1");
    });
  }
});

describe("C-2 to C-6, C-8, C-9", () => {
  it("C-2: asynchronous initiation requires statusLookup", () => {
    const binding = bindingFor(withCaps({ statusLookup: false }));
    expect(rulesOf(binding)).toContain("C-2");
  });

  it("C-3: customer actions require asynchronous initiation", () => {
    const binding = bindingFor(
      withCaps({ asynchronousInitiation: false, customerActions: ["redirect"] }, syncCapabilities)
    );
    expect(rulesOf(binding)).toContain("C-3");
  });

  it("C-4: asynchronous capture requires operationLookup", () => {
    const binding = bindingFor(
      withCaps({
        operationLookup: false,
        cancel: { incomplete: true, authorized: true, asynchronous: false },
      })
    );
    expect(rulesOf(binding)).toContain("C-4");
  });

  it("C-4: asynchronous cancel requires operationLookup", () => {
    const binding = bindingFor(
      withCaps({ operationLookup: false, manualCapture: { asynchronous: false } })
    );
    expect(rulesOf(binding)).toContain("C-4");
  });

  it("C-4: notifications never substitute for operationLookup", () => {
    const binding = bindingFor(withCaps({ operationLookup: false, notifications: true }));
    expect(rulesOf(binding)).toContain("C-4");
  });

  it("C-5: manual capture requires cancel of authorizations", () => {
    const noCancel = bindingFor(
      withCaps({ cancel: false, incompleteResolution: { kind: "expiry", maxSeconds: 60 } })
    );
    expect(rulesOf(noCancel)).toContain("C-5");
    const noAuthorized = bindingFor(
      withCaps({ cancel: { incomplete: true, authorized: false, asynchronous: true } })
    );
    expect(rulesOf(noAuthorized)).toContain("C-5");
  });

  it("C-6: multiple refunds require partial refunds", () => {
    const binding = bindingFor(
      withCaps({ refund: { partial: false, multiple: true, asynchronous: false } })
    );
    expect(rulesOf(binding)).toContain("C-6");
  });

  for (const retention of [0, -1, Number.NaN]) {
    it(`C-8: rejects idempotencyRetentionSeconds ${String(retention)}`, () => {
      expect(rulesOf(bindingFor(withCaps({ idempotencyRetentionSeconds: retention })))).toContain(
        "C-8"
      );
    });
  }

  it("C-9: rejects an unsupported customer action kind", () => {
    const caps = withCaps({ customerActions: ["redirect", "embedded" as never] });
    expect(rulesOf(bindingFor(caps))).toContain("C-9");
  });
});

describe("C-11: incompleteResolution", () => {
  it("rejects an asynchronous initiation that declares no mechanism", () => {
    expect(rulesOf(bindingFor(withCaps({ incompleteResolution: false })))).toEqual(["C-11"]);
  });

  it("accepts a synchronous initiation without a mechanism", () => {
    expect(rulesOf(bindingFor(syncCapabilities))).toEqual([]);
  });

  it('rejects kind "cancel" without cancel', () => {
    const caps = withCaps({ manualCapture: false, cancel: false, operationLookup: false });
    expect(rulesOf(bindingFor(caps))).toEqual(["C-11"]);
  });

  it('rejects kind "cancel" when cancel.incomplete is false', () => {
    const caps = withCaps({ cancel: { incomplete: false, authorized: true, asynchronous: true } });
    expect(rulesOf(bindingFor(caps))).toEqual(["C-11"]);
  });

  it('accepts kind "cancel" with cancel.incomplete', () => {
    expect(rulesOf(bindingFor(asyncCapabilities))).toEqual([]);
  });

  it("applies to a mechanism declared on a synchronous initiation too", () => {
    const caps = withCaps({ incompleteResolution: { kind: "cancel" } }, syncCapabilities);
    expect(rulesOf(bindingFor(caps))).toEqual(["C-11"]);
  });

  for (const maxSeconds of [
    0,
    -1,
    -0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]) {
    it(`rejects expiry maxSeconds ${String(maxSeconds)}`, () => {
      const caps = withCaps({ incompleteResolution: { kind: "expiry", maxSeconds } });
      expect(rulesOf(bindingFor(caps))).toEqual(["C-11"]);
    });
  }

  for (const maxSeconds of [1, 0.001, 86_400]) {
    it(`accepts expiry maxSeconds ${String(maxSeconds)}`, () => {
      const caps = withCaps({ incompleteResolution: { kind: "expiry", maxSeconds } });
      expect(rulesOf(bindingFor(caps))).toEqual([]);
    });
  }

  it("rejects an unrecognized declaration", () => {
    const caps = withCaps({ incompleteResolution: { kind: "timeout" } as never });
    expect(rulesOf(bindingFor(caps))).toEqual(["C-11"]);
  });
});

describe("validator behaviour", () => {
  it("returns invalid_configuration listing every violated rule", () => {
    const caps = withCaps({
      statusLookup: false,
      idempotencyRetentionSeconds: 0,
      incompleteResolution: false,
    });
    const result = validatePaymentProviderBinding(bindingFor(caps));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.meta.reason).toBe("invalid_configuration");
      const rules = result.error.meta.details?.violations?.map((v) => v.rule);
      expect(rules).toEqual(["C-2", "C-8", "C-11"]);
      expect(result.error.meta.details?.violations?.every((v) => v.message.length > 0)).toBe(true);
    }
  });

  it("is deterministic and does not mutate or normalize its input", () => {
    const binding = bindingFor(
      withCaps({ incompleteResolution: { kind: "expiry", maxSeconds: Number.NaN } })
    );
    const snapshot = structuredClone(binding.capabilities);

    const first = getPaymentBindingViolations(binding);
    const second = getPaymentBindingViolations(binding);

    expect(second).toEqual(first);
    expect(binding.capabilities).toEqual(snapshot);
    expect(
      Number.isNaN((binding.capabilities.incompleteResolution as { maxSeconds: number }).maxSeconds)
    ).toBe(true);
  });

  it("does not check conformance rule C-10", () => {
    const rules = new Set(rulesOf(bindingFor(asyncCapabilities)));
    expect(rules.has("C-10" as never)).toBe(false);
  });
});
