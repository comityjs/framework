import { describe, expect, it, vi } from "vitest";

describe("@comity/hydration import safety (Node, no DOM)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("imports the default surface without DOM globals", async () => {
    const hydration = await import("../index.js");

    expect(typeof hydration.HydrationController).toBe("function");
    expect(typeof hydration.DefaultHydrationScheduler).toBe("function");
    expect(typeof hydration.createNoopHydrationCapabilities).toBe("function");
    expect(typeof hydration.createBrowserHydrationCapabilities).toBe("function");
    expect(typeof hydration.JsonIslandSerializer).toBe("object");
  });

  it("imports the errors surface without DOM globals", async () => {
    const errors = await import("../errors/index.js");

    expect(typeof errors.HydrationError).toBe("function");
  });

  it("imports the lifecycle surface without DOM globals", async () => {
    const lifecycle = await import("../lifecycle/index.js");

    expect(lifecycle).toBeDefined();
  });

  it("never dereferences browser globals during module evaluation", async () => {
    // Guard rails: assert the Node environment really has no DOM globals.
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
    expect(typeof HTMLElement).toBe("undefined");
    expect(typeof customElements).toBe("undefined");
    expect(typeof IntersectionObserver).toBe("undefined");

    // Any of the core default surfaces must evaluate without touching DOM.
    await import("../index.js");
    await import("../errors/index.js");
    await import("../lifecycle/index.js");
  });

  it("provides capabilities that are SSR-safe by default", async () => {
    const { createNoopHydrationCapabilities } = await import("../index.js");

    const capabilities = createNoopHydrationCapabilities();

    expect(capabilities.now()).toBeTypeOf("number");
    expect(capabilities.matchMedia("(min-width: 768px)")).toBeNull();
  });
});