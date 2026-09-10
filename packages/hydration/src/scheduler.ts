import type { IslandElement } from "./client/island-element.js";
import type {
  HydrationSchedulingAdapter,
  HydrationPlatformCapabilities,
  HydrationVisibilityObserver,
} from "./contracts/hydration-scheduler.js";
import {
  createNoopHydrationCapabilities,
} from "./contracts/hydration-scheduler.js";
import type {
  HydrationInteractionStrategy,
  HydrationMediaStrategy,
} from "./contracts/strategy.js";

/**
 * Default strategy-based scheduler adapter.
 */
export class DefaultHydrationScheduler implements HydrationSchedulingAdapter {
  readonly #capabilities: HydrationPlatformCapabilities;

  constructor(capabilities?: HydrationPlatformCapabilities) {
    this.#capabilities = capabilities ?? createNoopHydrationCapabilities();
  }

  /** @inheritdoc */
  schedule(island: IslandElement, run: () => Promise<void>): void {
    const strategy = island.contract?.strategy;

    // If no strategy is defined, hydrate immediately
    if (!strategy) {
      run();

      return;
    }

    switch (strategy.kind) {
      case "idle":
        this.#idle(run);
        break;

      case "visible": {
        this.#visible(island, run);
        break;
      }

      case "interaction": {
        this.#interaction(strategy.options, island, run);
        break;
      }

      case "media": {
        this.#media(strategy.options, run);
        break;
      }

      case "immediate":
      default:
        run();
        break;
    }
  }

  /**
   * Idle hydration strategy.
   *
   * @param run - Function to run when the browser is idle
   */
  #idle(run: () => Promise<void>): void {
    this.#capabilities.requestIdleCallback(run);
  }

  /**
   * Visible hydration strategy
   *
   * When visibility observation is unavailable the island hydrates
   * immediately instead of waiting for a signal that never arrives.
   *
   * @param elem - Element to observe for visibility
   * @param run - Function to run when the element becomes visible
   */
  #visible(elem: IslandElement, run: () => Promise<void>): void {
    let observation: HydrationVisibilityObserver | null = null;
    let hydrated = false;

    /**
     * Hydrates the island once, disconnecting the observation first.
     */
    const onVisible = (): void => {
      if (hydrated) return;

      hydrated = true;
      observation?.disconnect();
      run();
    };

    observation = this.#capabilities.observeVisibility(elem, onVisible);

    // No visibility observation available - hydrate immediately.
    if (!observation && !hydrated) {
      run();
    }
  }

  /**
   * Hydration strategy that hydrates an island upon user interaction
   *
   * @param events The user interaction events to listen for
   * @param elem The HTML element representing the island
   * @param run The function to run to perform hydration
   */
  #interaction(
    events: HydrationInteractionStrategy["options"],
    elem: IslandElement,
    run: () => Promise<void>
  ): void {
    /** Event handler for user interaction */
    const handler = () => {
      cleanup();
      run();
    };

    /** Cleans up event listeners */
    const cleanup = () => {
      events.forEach((event) => {
        elem.removeEventListener(event, handler);
      });
    };

    // Attach event listeners for the specified events
    events.forEach((event) => {
      elem.addEventListener(event, handler, { once: true });
    });
  }

  /**
   * Hydrates when a media query matches
   *
   * @param query The media query to match
   * @param run The function to run to perform hydration
   *
   * @returns void
   */
  #media(query: HydrationMediaStrategy["options"], run: () => Promise<void>): void {
    const mql = this.#capabilities.matchMedia(query);

    if (!mql) {
      // No matchMedia available - hydrate immediately
      run();

      return;
    }

    if (mql.matches) {
      run();

      return;
    }

    /**
     * Listener for media query changes
     *
     * @param evt Media query list event
     */
    const listener = (evt: MediaQueryListEvent) => {
      // If the media query does not match, do nothing
      if (!evt.matches) return;

      mql.removeEventListener("change", listener);
      run();
    };

    mql.addEventListener("change", listener);
  }
}
