# @comity/router

Route and URL rewriter contracts for Comity.

---

## Purpose

Defines the core route, router, and URL rewriting abstractions used to resolve requests before execution.

---

## Scope

This package:

- ✅ defines route and router contracts
- ✅ exposes URL rewriter contracts
- ✅ provides the router pipeline and HTTP handler factory

This package does NOT:

- ❌ bind to a specific routing backend
- ❌ render responses
- ❌ own application-specific routing policy

---

## Public API

- Route and router contracts
- URL rewriter contract
- Router pipeline
- HTTP handler factory
- Router implementations (`@comity/router/routers`)
- Module setup contracts (`@comity/router/setup`)

No exhaustive reference; see docs for constraints.
---

## Documentation

- docs/overview.md
- docs/conventions.md
- docs/architecture.md

---

## Related Packages

- @comity/http
- @comity/kernel
- @comity/primitives

---

## Status

Stable
