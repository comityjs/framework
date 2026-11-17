import type { Route, RouteResolutionContext } from "@comity/router";

import { describe, expect, it, vi } from "vitest";
import { PathRouter } from "../router.js";

describe("PathRouter", () => {
  describe("constructor", () => {
    it("should filter out routes without paths", () => {
      const routes: Route[] = [
        { path: "/test", handler: vi.fn() },
        { handler: vi.fn() }, // no path
        { path: "/another", handler: vi.fn() },
      ];
      const router = new PathRouter(routes);

      // We can't directly access #routes, but we can test behavior
      expect(router).toBeInstanceOf(PathRouter);
    });

    it("should compile routes with paths", () => {
      const routes: Route[] = [
        { path: "/test", handler: vi.fn() },
        { path: "/users/:id", handler: vi.fn() },
      ];
      const router = new PathRouter(routes);

      expect(router).toBeInstanceOf(PathRouter);
    });

    it("should handle empty routes array", () => {
      const router = new PathRouter([]);

      expect(router).toBeInstanceOf(PathRouter);
    });

    it("should handle routes with only path property", () => {
      const routes: Route[] = [{ path: "/test" }];
      const router = new PathRouter(routes);

      expect(router).toBeInstanceOf(PathRouter);
    });
  });

  describe("match", () => {
    it("should return null when no routes match", async () => {
      const routes: Route[] = [{ path: "/test", handler: vi.fn() }];
      const router = new PathRouter(routes);
      const ctx: RouteResolutionContext = {
        http: { request: { method: "GET" } },
        url: new URL("http://example.com/nonexistent"),
      };
      const result = await router.match(ctx);

      expect(result).toBeNull();
    });

    it("should match exact path", async () => {
      const handler = vi.fn();
      const routes: Route[] = [{ path: "/test", handler }];
      const router = new PathRouter(routes);
      const ctx: RouteResolutionContext = {
        http: { request: { method: "GET" } },
        url: new URL("http://example.com/test"),
      };
      const result = await router.match(ctx);

      expect(result).not.toBeNull();
      expect(result?.route).toBe(routes[0]);
      expect(result?.params).toEqual({});
    });

    it("should match path with query parameters", async () => {
      const handler = vi.fn();
      const routes: Route[] = [{ path: "/test", handler }];
      const router = new PathRouter(routes);
      const ctx: RouteResolutionContext = {
        http: { request: { method: "GET" } },
        url: new URL("http://example.com/test?param=value"),
      };
      const result = await router.match(ctx);

      expect(result).not.toBeNull();
      expect(result?.route).toBe(routes[0]);
      expect(result?.params).toEqual({});
    });

    it("should match path with trailing slash", async () => {
      const handler = vi.fn();
      const routes: Route[] = [{ path: "/test", handler }];
      const router = new PathRouter(routes);
      const ctx: RouteResolutionContext = {
        http: { request: { method: "GET" } },
        url: new URL("http://example.com/test/"),
      };
      const result = await router.match(ctx);

      expect(result).not.toBeNull();
      expect(result?.route).toBe(routes[0]);
    });

    it("should respect HTTP method when specified", async () => {
      const getHandler = vi.fn();
      const postHandler = vi.fn();
      const routes: Route[] = [
        { path: "/test", method: "GET", handler: getHandler },
        { path: "/test", method: "POST", handler: postHandler },
      ];
      const router = new PathRouter(routes);
      // Test GET request
      const getCtx: RouteResolutionContext = {
        http: { request: { method: "GET" } },
        url: new URL("http://example.com/test"),
      };
      const getResult = await router.match(getCtx);

      expect(getResult?.route).toBe(routes[0]);

      // Test POST request
      const postCtx: RouteResolutionContext = {
        http: { request: { method: "POST" } },
        url: new URL("http://example.com/test"),
      };
      const postResult = await router.match(postCtx);

      expect(postResult?.route).toBe(routes[1]);
    });

    it("should skip routes with non-matching methods", async () => {
      const routes: Route[] = [{ path: "/test", method: "POST", handler: vi.fn() }];
      const router = new PathRouter(routes);
      const ctx: RouteResolutionContext = {
        http: { request: { method: "GET" } },
        url: new URL("http://example.com/test"),
      };
      const result = await router.match(ctx);

      expect(result).toBeNull();
    });

    it("should match routes without method specified", async () => {
      const routes: Route[] = [{ path: "/test", handler: vi.fn() }];
      const router = new PathRouter(routes);
      const ctx: RouteResolutionContext = {
        http: { request: { method: "POST" } },
        url: new URL("http://example.com/test"),
      };
      const result = await router.match(ctx);

      expect(result).not.toBeNull();
    });

    it("should extract path parameters", async () => {
      const routes: Route[] = [{ path: "/users/:id", handler: vi.fn() }];
      const router = new PathRouter(routes);
      const ctx: RouteResolutionContext = {
        http: { request: { method: "GET" } },
        url: new URL("http://example.com/users/123"),
      };
      const result = await router.match(ctx);

      expect(result).not.toBeNull();
      expect(result?.params).toEqual({ id: "123" });
    });

    it("should extract multiple path parameters", async () => {
      const routes: Route[] = [{ path: "/users/:userId/posts/:postId", handler: vi.fn() }];
      const router = new PathRouter(routes);
      const ctx: RouteResolutionContext = {
        http: { request: { method: "GET" } },
        url: new URL("http://example.com/users/123/posts/456"),
      };
      const result = await router.match(ctx);

      expect(result).not.toBeNull();
      expect(result?.params).toEqual({ userId: "123", postId: "456" });
    });

    it("should handle URL encoded parameters", async () => {
      const routes: Route[] = [{ path: "/users/:name", handler: vi.fn() }];
      const router = new PathRouter(routes);
      const ctx: RouteResolutionContext = {
        http: { request: { method: "GET" } },
        url: new URL("http://example.com/users/John%20Doe"),
      };
      const result = await router.match(ctx);

      expect(result).not.toBeNull();
      expect(result?.params).toEqual({ name: "John Doe" });
    });

    it("should return first matching route", async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const routes: Route[] = [
        { path: "/test", handler: handler1 },
        { path: "/test", handler: handler2 },
      ];
      const router = new PathRouter(routes);
      const ctx: RouteResolutionContext = {
        http: { request: { method: "GET" } },
        url: new URL("http://example.com/test"),
      };
      const result = await router.match(ctx);

      expect(result?.route).toBe(routes[0]);
    });

    it("should handle root path", async () => {
      const routes: Route[] = [{ path: "/", handler: vi.fn() }];
      const router = new PathRouter(routes);
      const ctx: RouteResolutionContext = {
        http: { request: { method: "GET" } },
        url: new URL("http://example.com/"),
      };
      const result = await router.match(ctx);

      expect(result).not.toBeNull();
    });

    it("should handle wildcard patterns", async () => {
      const routes: Route[] = [{ path: "/files/:path", handler: vi.fn() }];
      const router = new PathRouter(routes);
      const ctx: RouteResolutionContext = {
        http: { request: { method: "GET" } },
        url: new URL("http://example.com/files/document.pdf"),
      };
      const result = await router.match(ctx);

      expect(result).not.toBeNull();
      expect(result?.params).toEqual({ path: "document.pdf" });
    });

    it("should handle optional parameters", async () => {
      const routes: Route[] = [{ path: "/users/:id", handler: vi.fn() }];
      const router = new PathRouter(routes);
      // Test with parameter
      const ctx1: RouteResolutionContext = {
        http: { request: { method: "GET" } },
        url: new URL("http://example.com/users/123"),
      };
      const result1 = await router.match(ctx1);

      expect(result1?.params).toEqual({ id: "123" });

      // Test without parameter - should not match
      const ctx2: RouteResolutionContext = {
        http: { request: { method: "GET" } },
        url: new URL("http://example.com/users"),
      };
      const result2 = await router.match(ctx2);

      expect(result2).toBeNull();
    });
  });

  describe("percent-encoding", () => {
    const resolve = (router: PathRouter, path: string, method = "GET") =>
      router.match({
        http: { request: { method } },
        url: new URL("http://example.com" + path),
      } as RouteResolutionContext);

    it("matches literal non-ASCII and space routes against the encoded pathname", async () => {
      const router = new PathRouter([
        { method: "GET", path: "/café", handler: vi.fn() },
        { method: "GET", path: "/a b", handler: vi.fn() },
      ]);

      expect((await resolve(router, "/café"))?.route.path).toBe("/café");
      expect((await resolve(router, "/a b"))?.route.path).toBe("/a b");
      expect((await resolve(router, "/caf%c3%a9"))?.route.path).toBe("/café");
    });

    it("matches literals the URL parser leaves unencoded or encodes", async () => {
      const router = new PathRouter([
        { path: "/a|b", handler: vi.fn() },
        { path: "/a^b", handler: vi.fn() },
        { path: "/a\\{b\\}", handler: vi.fn() },
      ]);

      expect(await resolve(router, "/a|b")).not.toBeNull();
      expect(await resolve(router, "/a^b")).not.toBeNull();
      expect(await resolve(router, "/a{b}")).not.toBeNull();
    });

    it("decodes non-ASCII parameters", async () => {
      const router = new PathRouter([{ path: "/user/:id", handler: vi.fn() }]);

      expect((await resolve(router, "/user/€"))?.params).toEqual({ id: "€" });
    });

    it("decodes %2F inside a parameter without splitting the segment", async () => {
      const router = new PathRouter([{ path: "/user/:id", handler: vi.fn() }]);

      expect((await resolve(router, "/user/a%2Fb"))?.params).toEqual({ id: "a/b" });
    });

    it.each(["/user/100%", "/user/%ZZ", "/user/%E0%A4%A"])(
      "resolves null instead of rejecting for malformed parameter %s",
      async (path) => {
        const router = new PathRouter([{ path: "/user/:id", handler: vi.fn() }]);

        await expect(resolve(router, path)).resolves.toBeNull();
      }
    );

    it("resolves null for a wildcard with a malformed segment", async () => {
      const router = new PathRouter([{ path: "/files/*rest", handler: vi.fn() }]);

      await expect(resolve(router, "/files/a/%ZZ")).resolves.toBeNull();
      expect((await resolve(router, "/files/a/b"))?.params).toEqual({ rest: ["a", "b"] });
    });

    it("falls through to the next route when a decode fails", async () => {
      const router = new PathRouter([
        { path: "/user/:id", handler: vi.fn() },
        { path: "/user/100%", handler: vi.fn() },
      ]);

      expect((await resolve(router, "/user/100%"))?.route.path).toBe("/user/100%");
    });
  });
});
