import type { DiContainer, PropertyKey, ServiceKey, ServiceToken } from "./types.js";

import { DiContainerError } from "./error.js";

/**
 * Dependency Injection Container.
 *
 * @typeParam Services - Record of service identifiers and their corresponding types.
 *
 * @remarks
 * Lifecycle controls and disposal are demanded to the services themselves.
 * The container only manages instantiation and caching.
 *
 * Resolution follows the {@link DiContainer} contract: token keys resolve
 * through the token's own `ServiceToken` brand, map keys (strings and
 * `unique symbol`s) resolve through `Services[K]`, and bare `symbol` values
 * are rejected at compile time.
 *
 * @example
 * ```ts
 * const container = new DefaultDiContainer<{
 *   logger: LoggerService;
 *   userService: UserService;
 * }>();
 *
 * container.define("logger", () => new LoggerService());
 * container.define("userService", () => new UserService(container.resolve("logger")));
 *
 * const userService = container.resolve("userService");
 * ```
 */
export class DefaultDiContainer<
  Services extends Record<PropertyKey, unknown> = {},
> implements DiContainer<Services> {
  /** Factories map */
  #factories = new Map<PropertyKey, () => unknown>();

  /** Instances map */
  #instances = new Map<PropertyKey, unknown>();

  /**
   * @inheritdoc
   */
  define<K extends keyof Services, R>(token: K & ServiceToken<R>, factory: () => R): void;
  /**
   * @inheritdoc
   */
  define<K extends keyof Services>(name: K & ServiceKey<K>, factory: () => Services[K]): void;
  /**
   * @inheritdoc
   */
  define<K extends Extract<keyof Services, string | number>>(
    name: K,
    factory: () => Services[K]
  ): void;
  /**
   * Implementation signature — callers only ever see the overloads above.
   *
   * @param name - Service identifier.
   * @param factory - Service factory.
   */
  define(name: PropertyKey, factory: () => unknown): void {
    if (this.#factories.has(name)) {
      throw new DiContainerError("already_registered", {
        service: name,
      });
    }

    this.#factories.set(name, factory);
  }

  /**
   * @inheritdoc
   */
  resolve<K extends keyof Services, R>(token: K & ServiceToken<R>): R;
  /**
   * @inheritdoc
   */
  resolve<K extends keyof Services>(name: K & ServiceKey<K>): Services[K];
  /**
   * @inheritdoc
   */
  resolve<K extends Extract<keyof Services, string | number>>(name: K): Services[K];
  /**
   * Implementation signature — callers only ever see the overloads above.
   *
   * @param name - Service identifier.
   *
   * @returns The service instance.
   */
  resolve(name: PropertyKey): unknown {
    // Return existing instance if available
    if (this.#instances.has(name)) {
      return this.#instances.get(name);
    }

    // Get the factory for the service
    const factory = this.#factories.get(name);

    // Service not registered
    if (!factory) {
      throw new DiContainerError("not_registered", {
        service: name,
      });
    }

    // Create a new instance
    const instance = factory();

    // Cache the instance for future use
    this.#instances.set(name, instance);

    return instance;
  }

  /**
   * @inheritdoc
   */
  clear(): void {
    this.#instances.clear();
  }
}
