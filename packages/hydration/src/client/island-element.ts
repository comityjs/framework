import type { IslandHydrationState } from "../contracts/island.js";
import type { MaybeIslandContract } from "../serializer.js";

import { HydrationError } from "../errors/hydration.js";
import { JsonIslandSerializer } from "../serializer.js";

/**
 * Base class used when no browser DOM is available.
 *
 * Importing this module must not dereference browser globals: the island
 * element only extends `HTMLElement` when the global actually exists. Without
 * a DOM, construction and registration fail with a clear `HydrationError`
 * instead of an accidental `ReferenceError`.
 */
class NoDomIslandElement {
  /**
   * Constructing an island requires a browser DOM.
   *
   * @throws {HydrationError} When no browser DOM is available.
   */
  constructor() {
    throw new HydrationError("no_dom");
  }
}

/**
 * Resolves the DOM base class for the island element.
 *
 * `typeof HTMLElement` never throws for an undeclared global, so this stays
 * safe in Node/SSR/worker environments. The resolved class keeps the
 * `HTMLElement` compile-time type in every environment; without a DOM the
 * runtime base raises the documented error on construction.
 *
 * @returns The `HTMLElement` base class, or the no-DOM stand-in.
 */
function resolveIslandBase(): typeof HTMLElement {
  if (typeof HTMLElement === "undefined") {
    return NoDomIslandElement as unknown as typeof HTMLElement;
  }

  return HTMLElement;
}

/**
 * Custom element representing a Comity hydration island.
 *
 * @remarks
 * Responsibilities:
 * - Bridge DOM lifecycle → Island lifecycle
 * - Expose parsed island contract
 * - Emit lifecycle events at DOM level
 *
 * This class only extends `HTMLElement` in browser environments. Importing it
 * (or the whole `@comity/hydration/client` surface) stays safe in Node/SSR;
 * construction and registration without a DOM raise a `HydrationError`.
 */
export class IslandElement extends resolveIslandBase() {
  /** Current hydration state */
  #state: IslandHydrationState = "idle";

  // Cached island contract (lazy)
  #contract: MaybeIslandContract;

  /** @returns Current hydration state */
  get state(): IslandHydrationState {
    return this.#state;
  }

  /** @returns MaybeIslandContract */
  get contract(): MaybeIslandContract {
    // Return cached value if available
    if (this.#contract !== undefined) {
      return this.#contract;
    }

    // Parse contract from embedded script tag
    const script = this.querySelector('script[type="application/json"]');

    // If no script tag or empty content, cache null
    if (!script?.textContent) {
      this.#contract = null;

      return this.#contract;
    }

    // Deserialize contract
    try {
      this.#contract = JsonIslandSerializer.deserialize(script.textContent);
    } catch {
      this.#contract = null;
    }

    return this.#contract;
  }

  /** @inheritdoc */
  connectedCallback() {
    this.transition("materialized");
  }

  /** @inheritdoc */
  disconnectedCallback() {
    this.#contract = undefined;
  }

  /**
   * Transition to next state
   *
   * @param next - Next state
   *
   * @returns True if the transition was successful, false otherwise
   *
   * @remarks
   * This method dispatches a "island-state-transition" event with details about the transition.
   *
   * NOTE:
   * The "materialized" state is triggered automatically when the element is connected to the DOM.
   */
  transition(next: IslandHydrationState): boolean {
    const from = this.#state;
    const validTransitions: Record<IslandHydrationState, IslandHydrationState[]> = {
      idle: ["materialized"],
      materialized: ["hydrating", "failed"],
      hydrating: ["completed", "failed"],
      completed: [],
      failed: [],
    };

    // Validate transition
    if (!validTransitions[from]?.includes(next)) {
      // Emit failed transition event
      this.dispatchEvent(
        new CustomEvent("island-state-transition", {
          detail: { from, to: next, success: false },
        })
      );

      return false;
    }

    this.#state = next;

    // Emit transition event
    this.dispatchEvent(
      new CustomEvent("island-state-transition", {
        detail: { from, to: this.#state, success: true },
      })
    );

    return true;
  }
}

/**
 * Registers the Comity island custom element
 *
 * @throws {HydrationError} When no browser DOM is available.
 */
export function registerIslandElement(): void {
  if (typeof HTMLElement === "undefined" || typeof customElements === "undefined") {
    throw new HydrationError("no_dom");
  }

  if (!customElements.get("comity-island")) {
    customElements.define("comity-island", IslandElement);
  }
}
