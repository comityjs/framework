import type { Route, RouteMatch, Router, RouteResolutionContext } from "@comity/router";
import type { CompiledRoute } from "./types.js";

import { match } from "path-to-regexp";
import { encodePath } from "./encode-path.js";

/**
 * PathRouter is a router implementation that matches incoming HTTP requests based on their URL path and HTTP method. It supports static paths and can be extended to support dynamic path parameters in the future.
 *
 * @typeParam State - Route state type carried by the registered routes.
 * @typeParam Services - Application service map carried by the registered routes.
 *
 * @remarks
 * The constructor is generic in `State` and `Services` (with the same defaults
 * as `Route`) so a service-typed route — `Route<{}, AppServices>` — is
 * *checked* at registration instead of being rejected against `Route[]`'s
 * erased defaults. All routes registered with one router must share the same
 * state and service map; routes whose maps differ belong in separate routers
 * (routers themselves are heterogeneous inside `Router[]`).
 *
 * The service typing deliberately stops at this boundary: matching returns
 * the non-generic `RouteMatch`, whose `route` slot is `Route` with defaults.
 * This is an intentional erasure, not an oversight — `HttpContext` is
 * invariant in `Services` (its `resolve` return type is covariant in
 * `Services` and its key is contravariant), so no erased route slot could
 * accept a typed route soundly, and the request context handed to a handler
 * at dispatch time is the kernel's real, fully-registered container at
 * runtime regardless of the static type. The erase happens once, inside this
 * constructor, immediately after the routes have been type-checked.
 */
export class PathRouter<
  State = Record<string, unknown>,
  Services extends Record<keyof Services, unknown> = Record<string, unknown>,
> implements Router {
  #routes: CompiledRoute[];

  /**
   * @param routes - An array of Route objects that define the routing rules for this router.
   */
  constructor(routes: Route<State, Services>[]) {
    this.#routes = routes
      .filter((r) => r.path)
      .map((r) => ({
        // Local, justified erase: the routes were just checked against
        // Route<State, Services>; storage and dispatch are the router's
        // intentional erased boundary (see class JSDoc).
        route: r as Route,
        match: match(r.path!, { decode: decodeURIComponent, encodePath }),
      }));
  }

  /**
   * Matches an incoming HTTP request against the defined routes.
   *
   * @param ctx - The context of the incoming HTTP request.
   *
   * @returns A promise that resolves to a RouteMatch object if a matching route is found, or null if no match is found.
   *
   * @remarks
   * Never rejects because of a malformed request path: a parameter that is not
   * valid percent-encoding (e.g. `/user/100%`) makes that route not match, and
   * resolution continues with the next route. Literal route text is compared
   * in the percent-encoded form of `URL.pathname`, so routes may contain
   * non-ASCII characters or spaces (`/café`, `/a b`).
   */
  async match(ctx: RouteResolutionContext): Promise<RouteMatch | null> {
    const method = ctx.http.request.method;
    const pathname = ctx.url.pathname;

    for (const r of this.#routes) {
      if (r.route.method && r.route.method !== method) {
        continue;
      }

      let m;

      try {
        m = r.match(pathname);
      } catch (error) {
        // A parameter that cannot be percent-decoded is client input, not a
        // server fault: treat the route as not matching.
        if (error instanceof URIError) continue;
        throw error;
      }

      if (!m) continue;

      return {
        route: r.route,
        params: m.params as Record<string, string>,
      };
    }

    return null;
  }
}
