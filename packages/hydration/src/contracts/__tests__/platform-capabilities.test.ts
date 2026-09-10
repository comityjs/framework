import type { IslandElement } from "../../client/island-element.js";

import { afterEach, describe, expect, it, vi } from "vitest";

import { HydrationError } from "../../errors/index.js";
import {
  createBrowserHydrationCapabilities,
  createNoopHydrationCapabilities,
} from "../hydration-scheduler.js";

describe("HydrationPlatformCapabilities", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  describe("createNoopHydrationCapabilities", () => {
    it("returns null for visibility observation", () => {
      const capabilities = createNoopHydrationCapabilities();

      expect(capabilities.observeVisibility({} as unknown as IslandElement, vi.fn())).toBeNull();
    });

    it("preserves timing, idle, and media fallbacks", () => {
      const capabilities = createNoopHydrationCapabilities();

      expect(capabilities.now()).toBeTypeOf("number");
      expect(capabilities.matchMedia("(min-width: 768px)")).toBeNull();

      const callback = vi.fn();

      vi.useFakeTimers();

      capabilities.requestIdleCallback(callback);

      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(200);

      expect(callback).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });
  });

  describe("createBrowserHydrationCapabilities", () => {
    it("observes visibility with IntersectionObserver", () => {
      let observerCallback: IntersectionObserverCallback | undefined;
      const observe = vi.fn();
      const disconnect = vi.fn();

      class FakeIntersectionObserver {
        constructor(callback: IntersectionObserverCallback) {
          observerCallback = callback;
        }

        observe = observe;

        disconnect = disconnect;
      }

      vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
      vi.stubGlobal("window", {});

      const capabilities = createBrowserHydrationCapabilities();
      const element = {} as unknown as IslandElement;
      const onVisible = vi.fn();

      const observation = capabilities.observeVisibility(element, onVisible);

      expect(observerCallback).toBeDefined();
      expect(observe).toHaveBeenCalledWith(element);
      expect(observation).not.toBeNull();

      observerCallback!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);

      expect(onVisible).toHaveBeenCalledTimes(1);
      expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it("does not notify when the observed element is not intersecting", () => {
      let observerCallback: IntersectionObserverCallback | undefined;

      class FakeIntersectionObserver {
        constructor(callback: IntersectionObserverCallback) {
          observerCallback = callback;
        }

        observe = vi.fn();

        disconnect = vi.fn();
      }

      vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
      vi.stubGlobal("window", {});

      const capabilities = createBrowserHydrationCapabilities();
      const onVisible = vi.fn();

      capabilities.observeVisibility({} as unknown as IslandElement, onVisible);

      observerCallback!([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);

      expect(onVisible).not.toHaveBeenCalled();
    });

    it("returns null when IntersectionObserver is unavailable", () => {
      vi.stubGlobal("IntersectionObserver", undefined);
      vi.stubGlobal("window", {});

      const capabilities = createBrowserHydrationCapabilities();

      expect(capabilities.observeVisibility({} as unknown as IslandElement, vi.fn())).toBeNull();
    });

    it("preserves browser behavior for now, idle callbacks, and matchMedia", () => {
      const idle = vi.fn((callback: () => void) => callback());
      const matchMedia = vi.fn().mockReturnValue({ matches: true });

      vi.stubGlobal("window", {
        requestIdleCallback: idle,
        matchMedia,
      });

      const capabilities = createBrowserHydrationCapabilities();
      const callback = vi.fn();

      expect(capabilities.now()).toBeTypeOf("number");

      expect(capabilities.matchMedia("(min-width: 768px)")).toEqual({ matches: true });
      expect(matchMedia).toHaveBeenCalledWith("(min-width: 768px)");

      capabilities.requestIdleCallback(callback);

      expect(idle).toHaveBeenCalledWith(callback);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("throws a no_dom HydrationError without a browser window", () => {
      vi.stubGlobal("window", undefined);

      let thrown: unknown;

      try {
        createBrowserHydrationCapabilities();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(HydrationError);
      expect((thrown as HydrationError).code).toBe("hydration:no_dom");
      expect((thrown as HydrationError).message).toBe("Hydration requires a browser DOM");
    });
  });
});