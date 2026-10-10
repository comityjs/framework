/**
 * Dependency Injection (DI) Container Property Types.
 */
export type PropertyKey = string | symbol;

/**
 * DI token brand: a symbol carrying the type of the service it resolves to.
 *
 * @typeParam R - The service type the token resolves to.
 *
 * @remarks
 * A token is a `symbol` branded (at the type level) with `__returnType: R`.
 * The container's token overloads read this brand so that `resolve(token)`
 * returns `R` exactly, independent of the service map. This is what preserves
 * the `TOKEN IDENTITY → SERVICE TYPE` relationship: the brand is declared once
 * (by `createToken` in `@comity/kernel`), checked at every `define` call, and
 * returned by every `resolve` call.
 *
 * The brand is structural: `Token<T, R>` from `@comity/kernel` satisfies this
 * type without importing it here (the dependency direction is kernel →
 * primitives). A plain `symbol` — branded or not — cannot be forged through
 * ordinary API usage: the only public constructor is `createToken`, which
 * derives the brand from its caller-supplied type argument.
 *
 * @example
 * ```typescript
 * const token = createToken<"my-service", MyService>("my-service");
 * // typeof token is Token<"my-service", MyService>,
 * // assignable to ServiceToken<MyService>.
 * ```
 */
export type ServiceToken<R> = symbol & {
  /** Service type the token resolves to. */
  __returnType: R;
};

/**
 * Map-driven key guard: the subset of `keyof Services` keys that may be
 * resolved through the service map itself.
 *
 * @typeParam K - A candidate key.
 *
 * @remarks
 * Two kinds of keys are excluded:
 *
 * - **Tokens** (`ServiceToken`-branded keys) are owned by the container's
 *   token overloads, which resolve from the token's own brand. Excluding them
 *   here guarantees that a mis-typed `define` (factory returning the wrong
 *   service for that token) is rejected instead of silently falling back to
 *   the map's widened symbol value union.
 * - **Bare `symbol` values** carry no identity, so accepting them would
 *   silently re-open the hole this guard closes: when a service map is keyed
 *   by tokens, TypeScript widens `keyof Services` to `symbol`, and without
 *   this guard `resolve(Symbol("…"))` would compile and return the union of
 *   all registered services. `unique symbol` keys (declared `const TOKEN =
 *   Symbol(…)`) and string keys pass through unchanged.
 */
export type ServiceKey<K> = K extends ServiceToken<unknown> ? never : symbol extends K ? never : K;

/**
 * Dependency Injection Container Contract.
 *
 * @typeParam Services - Record mapping service identifiers to their types.
 *
 * @remarks
 * Two resolution paths exist, and both preserve exact types:
 *
 * - **Token-driven** — `resolve(token)` derives the result from the token's
 *   own `ServiceToken` brand, so the service type travels with the token
 *   itself. Registration through `define(token, factory)` checks the factory
 *   against that same brand.
 * - **Map-driven** — `resolve(key)` derives the result from `Services[K]`,
 *   preserving the existing behaviour for string keys and `unique symbol`
 *   keys. Bare `symbol` values are rejected (see {@link ServiceKey}).
 *
 * This interface defines the contract for a Dependency Injection (DI)
 * Container, which allows registering and resolving services by their
 * identifiers.
 */
export interface DiContainer<Services extends Record<PropertyKey, unknown>> {
  /**
   * Register a service for a token, checking the factory against the
   * token's own service type.
   *
   * @typeParam K - Key of the token in the Services record.
   * @typeParam R - Service type carried by the token.
   *
   * @param token - Service token.
   * @param factory - Factory function to create the service instance.
   *
   * @throws {ContainerError} - If the service is already registered.
   */
  define<K extends keyof Services, R>(token: K & ServiceToken<R>, factory: () => R): void;

  /**
   * Register a service with a factory function.
   *
   * @typeParam K - Key of the service in the Services record.
   *
   * @param name - Service identifier (string key or `unique symbol`).
   * @param factory - Factory function to create the service instance.
   *
   * @throws {ContainerError} - If the service is already registered.
   */
  define<K extends keyof Services>(name: K & ServiceKey<K>, factory: () => Services[K]): void;

  /**
   * Register a service for keys held in a generic `K extends keyof Services`
   * position (e.g. inside a helper function). The `Extract` bound admits only
   * string/number keys, so symbol keys — bare or otherwise — still resolve
   * exclusively through the overloads above.
   *
   * @typeParam K - A string/number key of the service in the Services record.
   *
   * @param name - Service identifier.
   * @param factory - Factory function to create the service instance.
   *
   * @throws {ContainerError} - If the service is already registered.
   */
  define<K extends Extract<keyof Services, string | number>>(
    name: K,
    factory: () => Services[K]
  ): void;

  /**
   * Resolve the service a token points to, returning the exact type carried
   * by the token.
   *
   * @typeParam K - Key of the token in the Services record.
   * @typeParam R - Service type carried by the token.
   *
   * @param token - Service token.
   *
   * @returns - The service instance, typed by the token itself.
   *
   * @throws {ContainerError} - If the service is not registered.
   */
  resolve<K extends keyof Services, R>(token: K & ServiceToken<R>): R;

  /**
   * Resolve a service by its name.
   *
   * @typeParam K - Key of the service in the Services record.
   *
   * @param name - Service identifier (string key or `unique symbol`).
   *
   * @returns - The service instance.
   *
   * @throws {ContainerError} - If the service is not registered.
   */
  resolve<K extends keyof Services>(name: K & ServiceKey<K>): Services[K];

  /**
   * Resolve a service for a key held in a generic `K extends keyof Services`
   * position (e.g. inside a helper function). The `Extract` bound admits only
   * string/number keys, so a bare `symbol` can never satisfy it — on
   * symbol-keyed maps `Extract<keyof Services, string | number>` is `never`.
   *
   * @typeParam K - A string/number key of the service in the Services record.
   *
   * @param name - Service identifier.
   *
   * @returns - The service instance.
   *
   * @throws {ContainerError} - If the service is not registered.
   */
  resolve<K extends Extract<keyof Services, string | number>>(name: K): Services[K];

  /**
   * Clear cached instances.
   */
  clear(): void;
}
