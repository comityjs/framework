# @comity/http-fetch

Fetch HTTP transport adapter for Comity.

---

## Purpose

Implements the `HttpTransport` contract from `@comity/http` using the global fetch API. Moves the concrete transport out of the core so the core only defines HTTP semantics.

---

## Scope

This package:

- ✅ implements `HttpTransport` via `FetchHttpClient`
- ✅ provides `fetchHttp` with timeout, delay, and abort-signal combining
- ✅ exposes `HttpOptions` for typed request configuration

This package does NOT:

- ❌ define HTTP contracts or pipeline semantics
- ❌ implement business logic
- ❌ bind to a specific runtime

---

## Public API

- `FetchHttpClient` — fetch implementation of `HttpTransport`
- `fetchHttp` — standalone fetch helper with timeout and delay
- `HttpOptions` — request options type


No exhaustive reference; see docs for constraints.
---

## Documentation

- docs/overview.md
- docs/conventions.md

---

## Related Packages

- @comity/http — defines the `HttpTransport` contract this adapter implements

---

## Status

Experimental
