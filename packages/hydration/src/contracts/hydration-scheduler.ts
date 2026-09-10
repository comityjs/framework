import type { IslandElement } from "../client/island-element.js";

import { HydrationError } from "../errors/hydration.js";

/**
 * Handle for an active visibility observation.
 */
export interface HydrationVisibilityObserver {
  /** Stops observing the element. Safe to call more than once. */
  disconnect(): void;
}

/**
 * Platform capability interface for hydration scheduling.
 * Implementations provide browser-specific APIs without coupling core to globals.
 */
export interface HydrationPlatformCapabilities {
  /**
   * Returns the current high-resolution timestamp in milliseconds.
   * Used for hydration duration measurements.
   */
  now(): number;

  /**
   * Schedules a callback to run during browser idle periods.
   * Falls back to setTimeout if not available.
   */
  requestIdleCallback(callback: () => void): void;

  /**
   * Creates a MediaQueryList for the given query string.
   * Returns null if matchMedia is not available.
   */
  matchMedia(query: string): MediaQueryList | null;

  /**
   * Observes an element and invokes `onVisible` once it becomes visible.
   *
   * @param element - The element to observe.
   * @param onVisible - Called when the element becomes visible.
   *
   * @returns A handle to stop observing, or `null` when visibility
   * observation is unavailable.
   */
  observeVisibility(
    element: IslandElement,
    onVisible: () => void
  ): HydrationVisibilityObserver | null;
}

/**
 * Default browser implementation of platform capabilities.
 *
 * This factory is explicitly browser-only: calling it without browser
 * globals raises a clear `HydrationError` instead of failing with an
 * accidental `ReferenceError`.
 */
export function createBrowserHydrationCapabilities(): HydrationPlatformCapabilities {
  if (typeof window === "undefined") {
    throw new HydrationError("no_dom");
  }

  return {
    now(): number {
      if (typeof window === "undefined") {
        return Date.now();
      }

      return window.performance?.now() ?? Date.now();
    },
    requestIdleCallback(callback: () => void): void {
      if (typeof window === "undefined") {
        setTimeout(callback, 200);

        return;
      }

      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(callback);
      } else {
        setTimeout(callback, 200);
      }
    },
    matchMedia(query: string): MediaQueryList | null {
      if (typeof window === "undefined") {
        return null;
      }

      return window.matchMedia(query) ?? null;
    },
    /**
     * Observes the element with a real IntersectionObserver.
     *
     * @param element - The element to observe.
     * @param onVisible - Called once when the element becomes visible.
     *
     * @returns A handle to stop observing, or null when unavailable.
     */
    observeVisibility(element, onVisible): HydrationVisibilityObserver | null {
      if (typeof IntersectionObserver === "undefined") {
        return null;
      }

      const observer = new IntersectionObserver(([entry]) => {
        // Element is visible, disconnect observer and run the function
        if (entry?.isIntersecting) {
          observer.disconnect();
          onVisible();
        }
      });

      observer.observe(element);

      return {
        /**
         * Stops observing the element.
         *
         * @returns void
         */
        disconnect(): void {
          observer.disconnect();
        },
      };
    },
  };
}

/**
 * Minimal no-op capabilities for non-browser environments (SSR, workers, tests).
 * Use when browser APIs are not available.
 */
export function createNoopHydrationCapabilities(): HydrationPlatformCapabilities {
  return {
    now(): number {
      return Date.now();
    },
    requestIdleCallback(callback: () => void): void {
      setTimeout(callback, 200);
    },
    matchMedia(_query: string): MediaQueryList | null {
      return null;
    },
    /**
     * No visibility observation is available.
     *
     * @param _element - The element to observe.
     * @param _onVisible - Called when the element becomes visible.
     *
     * @returns Always null.
     */
    observeVisibility(_element: IslandElement, _onVisible: () => void): HydrationVisibilityObserver | null {
      return null;
    },
  };
}

/**
 * Scheduler adapter contract.
 */
export interface HydrationSchedulingAdapter {
  /**
   * Schedules the hydration of the given island based on its strategy.
   *
   * @param island The island state to schedule for hydration.
   *
   * @returns A promise that resolves when the scheduling is complete.
   */
  schedule(island: IslandElement, run: () => Promise<void>): void;
}
