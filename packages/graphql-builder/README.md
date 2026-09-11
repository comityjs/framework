# @comity/graphql-builder

GraphQL query building contracts and serializer helpers for Comity.

---

## Purpose

Provides the abstractions used to build GraphQL queries and serialize GraphQL values in a predictable way.

---

## Scope

This package:

- ✅ defines GraphQL query and value contracts
- ✅ provides query building helpers
- ✅ exposes value serialization helpers

This package does NOT:

- ❌ execute GraphQL requests
- ❌ own transport concerns
- ❌ bind to a GraphQL client runtime

---

## Public API

- Query builder
- GraphQL value and node contracts
- Serializer contracts — GraphQL value serialization (`@comity/graphql-builder/serializers`)
- Variable helper

No exhaustive reference; see docs for constraints.
---

## Documentation

- docs/overview.md
- docs/conventions.md

---

## Related Packages

- @comity/graphql-client

---

## Status

Stable
