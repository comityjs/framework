import { afterEach, describe, expect, it, vi } from "vitest";

describe("@comity/hydration/client import safety (Node, no DOM)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("imports without browser globals", async () => {
    expect(typeof HTMLElement).toBe("undefined");

    const client = await import("../index.js");

    expect(typeof client.IslandElement).toBe("function");
    expect(typeof client.registerIslandElement).toBe("function");
  });

  it("does not invoke customElements.define during module evaluation", async () => {
    const define = vi.fn();

    vi.stubGlobal("customElements", {
      get: vi.fn(),
      define,
    });

    await import("../index.js");

    expect(define).not.toHaveBeenCalled();
  });

  it("throws a no_dom HydrationError when constructing an island element", async () => {
    const { IslandElement } = await import("../index.js");
    const { HydrationError } = await import("../../errors/index.js");

    let thrown: unknown;

    try {
      new IslandElement();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HydrationError);
    expect((thrown as HydrationError).code).toBe("hydration:no_dom");
  });

  it("throws a no_dom HydrationError when registering the island element", async () => {
    const { registerIslandElement } = await import("../index.js");
    const { HydrationError } = await import("../../errors/index.js");

    let thrown: unknown;

    try {
      registerIslandElement();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HydrationError);
    expect((thrown as HydrationError).code).toBe("hydration:no_dom");
  });
});