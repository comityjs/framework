# @comity/search

Generic search abstractions for Comity domain modules.

---

## Purpose

Defines search criteria and result contracts shared across domain modules. Provides aggregation, filter, pagination, and sort models in a library-independent manner.

---

## Scope

This package:

- ✅ defines search result and criteria contracts
- ✅ defines filter, pagination, and sort models
- ✅ provides aggregation model contracts

This package does NOT:

- ❌ implement a search engine or index
- ❌ query data stores directly
- ❌ bind to a specific pagination format

---

## Public API

- `SearchCriteriaModel` — search criteria contract
- `SearchResultModel` — search result envelope
- `SearchCriteriaFilter`, `SearchCriteriaSort`, `SearchCriteriaPagination` — filter/sort/pagination models
- `AggregationModel`, `AggregationOptionModel` — aggregation contracts
- `SearchPort<TProjection>` — generic search port. Implementations live in adapter or application-layer packages; the projection type is owned by the consuming domain module. Search never imports a domain module.
- `SearchError` (`SearchErrorReason`, `SearchErrorMeta`) — search-owned error extending `BaseError`, compatible with the existing Result conventions. Also exported from the intentional `@comity/search/errors` subpath.

Search is intentionally **dependency-free of domain modules**: it must never
import `@comity/catalog`, `@comity/content`, `@comity/taxonomy`,
`@comity/storefront`, or any other domain module.

No exhaustive reference; see docs for constraints.

---

## Documentation

- docs/overview.md
- docs/conventions.md

---

## Related Packages

- @comity/catalog — catalog product models
- @comity/order — order entity interfaces

---

## Status

Stable

_Review Completed: 2026-07-25_
_Reviewer: Hobiri MAGI (DeepSeek v4 Pro)_
_Compliance Score: 99.5% (Green)_