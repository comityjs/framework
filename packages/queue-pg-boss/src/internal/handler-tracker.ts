/** @internal */

/**
 * Tracks handler executions accepted from pg-boss.
 *
 * @remarks
 * Tracking starts synchronously, in the same tick in which pg-boss invokes the
 * worker callback. pg-boss invokes that callback directly in the awaited
 * `runPromise` chain (`manager.ts`, `#processJobs`), so no other JavaScript can
 * run between job claim and registration.
 *
 * `drain()` is a quiescence loop rather than a single snapshot: it re-reads the
 * set after every settle. Once pg-boss's `offWork({ wait: true })` has resolved,
 * no new callback can start, so the loop normally completes after one pass; the
 * loop makes that an observed fact rather than an assumption.
 *
 * Tracked promises never reject, so handler failure cannot corrupt the drain.
 */
export class HandlerTracker {
  readonly #inFlight = new Set<Promise<void>>();

  /**
   * Number of executions that have not settled.
   *
   * @returns The current in-flight count
   */
  get size(): number {
    return this.#inFlight.size;
  }

  /**
   * Register an execution.
   *
   * @param execution - The handler execution. Its rejection is observed by the
   * caller; the tracked wrapper always resolves.
   */
  track(execution: Promise<void>): void {
    const tracked = execution
      .then(
        () => undefined,
        () => undefined
      )
      .finally(() => {
        this.#inFlight.delete(tracked);
      });

    this.#inFlight.add(tracked);
  }

  /**
   * Wait until no tracked execution remains.
   *
   * @remarks
   * Unbounded by design: the core contract defines no shutdown deadline. A
   * handler that never settles makes this promise never settle.
   */
  async drain(): Promise<void> {
    while (this.#inFlight.size > 0) {
      await Promise.allSettled([...this.#inFlight]);
    }
  }
}
