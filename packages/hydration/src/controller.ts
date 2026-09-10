import type { IslandElement } from "./client/island-element.js";
import type { HydrationSchedulingAdapter } from "./contracts/hydration-scheduler.js";
import type { IslandHydrationAdapter } from "./contracts/island-hydrator.js";
import type { HydrationRuntimeObserver } from "./lifecycle/runtime.js";

import { DefaultHydrationScheduler } from "./scheduler.js";

/**
 * Hydration Controller Options
 */
export interface HydrationControllerOptions {
  /**
   * The island hydrator adapter
   */
  hydrator: IslandHydrationAdapter;

  /**
   * The hydration scheduler adapter
   */
  scheduler?: HydrationSchedulingAdapter;

  /**
   * The hydration runtime observer
   */
  observer?: HydrationRuntimeObserver;

  /**
   * Function to get the current high-resolution timestamp.
   * Used for measuring hydration duration.
   * Defaults to a no-op implementation suitable for non-browser environments.
   */
  now?: () => number;
}

/**
 * Hydration Controller
 */
export class HydrationController {
  /** */
  readonly #hydrator: IslandHydrationAdapter;

  /**  */
  readonly #scheduler: HydrationSchedulingAdapter;

  /**  */
  readonly #observer: HydrationRuntimeObserver | undefined;

  /**  */
  readonly #now: () => number;

  /**
   * @param options - The hydration controller options
   */
  constructor(options: HydrationControllerOptions) {
    this.#hydrator = options.hydrator;
    this.#scheduler = options.scheduler ?? new DefaultHydrationScheduler();
    this.#observer = options.observer;
    this.#now = options.now ?? (() => Date.now());
  }

  /**
   *
   * @param island
   */
  onDiscovered(island: IslandElement): void {
    const contract = island.contract;

    // 1. Validate contract
    if (!contract) {
      // Emit hydration failed event
      this.#observer?.onIslandHydrationFailed?.({
        reason: "invalid_contract",
        duration: 0,
      });

      return;
    }

    const { id, strategy } = contract;

    // Emit discovery event
    this.#observer?.onIslandDiscovered?.({ id, strategy });

    // 2. Schedule hydration
    this.#scheduler.schedule(island, async () => {
      this.#observer?.onIslandScheduled?.({ id, strategy });
      this.#observer?.onIslandHydrationStarted?.({ id });

      // 3. Start hydration
      const start = this.#now();

      try {
        // 3.1 Registry / adapter validation
        if (!this.#hydrator.supports(contract)) {
          this.#observer?.onIslandHydrationFailed?.({
            id,
            reason: "not_registered",
            duration: this.#now() - start,
          });

          return;
        }

        // 3.2 Perform hydration
        await this.#hydrator.hydrate(island, contract);

        // Emit hydration completed event
        this.#observer?.onIslandHydrationCompleted?.({
          id,
          duration: this.#now() - start,
        });
      } catch (error) {
        // Emit hydration failed event
        this.#observer?.onIslandHydrationFailed?.({
          id,
          reason: "hydrate_failed",
          duration: this.#now() - start,
        });
      }
    });
  }
}
