# Public API Migration Plan — @comity/*

This document tracks the migration of existing `@comity/*` packages toward the
normative rules defined in the canonical Comity-wide standard
[`comity-development/docs/standards/public-api.md`](../../../development/docs/standards/public-api.md).

It does **not** redefine the standard. It records which packages are not yet
compliant, the severity of each gap, and the required action.

Normative rules: see the canonical Comity-wide standard in
[`comity-development/docs/standards/public-api.md`](../../../development/docs/standards/public-api.md).

> **Completion status (Phase 6.4/6.5):** The P0–P6 backlog below is a
> **historical record** of the migration plan and is NOT a list of current
> outstanding work. Every P0–P3 item has been completed or superseded by the
> Phase 5 / Phase 6.4 public-API work (explicit barrels, canonical subpaths,
> `export type` conversion, empty-barrel fixes, hydration runtime hardening).
> Current conformance is enforced by `scripts/normalize-exports.mjs`, the
> `@comity-dev/*` enforcement packages, and the authoritative inventory in
> [`rule-reconciliation.md`](../../../development/docs/architecture/rule-reconciliation.md).
> Rows marked ✅ are historic; nothing below is OPEN unless it says so.

---

## 1. Scope of This Document

- Catalog of non-conforming packages and their gaps
- Severity classification (P0–P6)
- Required actions per package
- Pending decisions that affect migration order

Approved architectural decisions (out of scope here):

- `@comity/storefront` is a **domain Core Module**, not an adapter
- `DefaultProductPageComposer` and similar are **canonical domain implementations**, not facades
- Public Entities follow the `Customer` pattern (entity class + value-object id + snapshot types + repository contract)
- One Adapter = one package = one technology
- Core Modules MUST NOT contain technology-specific code
- `GraphqlClient` in `@comity/graphql-client` is a **canonical, transport-independent client facade**, not a technology-bound implementation. It depends only on `GraphqlTransport`, `GraphqlRequest`, and `GraphqlResponse` and stays in the Core Module root. `GraphqlTransport` is the replaceable boundary; only technology-bound transports (WebSocket, fetch, HTTP-specific) belong in adapter packages.

---

## 2. Severity Tiers

| Tier  | Meaning                                                               |
| ----- | --------------------------------------------------------------------- |
| P0    | Empty or unusable public API. Blocks consumers immediately.           |
| P1    | Architectural violation. Misleading or unstable contract.             |
| P2    | Wrong export kind or misplaced wiring. API surface correct but leaky. |
| P3    | Dead code or partial ADR compliance.                                  |
| P4–P6 | Style, documentation, naming drift.                                   |

---

## 3. P0 — Immediate

| Package               | Issue        | Action                             |
| --------------------- | ------------ | ---------------------------------- |
| `@comity/cache-kv`    | Empty barrel | Export `KvCacheStore` from root    |
| `@comity/cache-redis` | Empty barrel | Export `RedisCacheStore` from root |

> ✅ COMPLETED — Phase 6.4B. Both adapters export their concrete store from the
> root (`packages/cache-kv/src/index.ts`, `packages/cache-redis/src/index.ts`).

---

## 4. P1 — Critical

| Package               | Issue                          | Action                                                                                                                |
| --------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `@comity/auth`        | 18 exports including types     | Move `CompositeAssuranceEvaluator`, `AuthGuard` to appropriate sub-entrypoint. Move types/interfaces to `export type` |
| `@comity/http`        | Client enforced implementation | Issue separate, move to adapter packages                                                                              |
| `@comity/kernel`      | Hooks path                     | Migrate to `/observers`, move wiring types to `/setup`                                                                |
| `@comity/composition` | Wiring types in root           | Move to `/setup`                                                                                                      |

> ✅ COMPLETED / SUPERSEDED — Phase 6.4B:
> - `@comity/auth` — interfaces are `export type`; the root surface stays canonical and explicit
>   `/use-cases` and `/repositories` barrels were added. `CompositeAssuranceEvaluator`/`AuthGuard`
>   remain canonical root exports (supersedes the subpath-move proposal).
> - `@comity/http` — the concrete client was extracted to the Technology Adapter `@comity/http-fetch`
>   (see §11); `@comity/http` now models the request/response contract surface.
> - `@comity/kernel` — hooks migrated to `/observers`; wiring types live under `/setup`.
> - `@comity/composition` — root narrowed to `load`/`resolveOrder`; wiring types live under `/setup`.

---

## 5. P2 — High

| Package               | Issue                                                      | Action                                               |
| --------------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| `@comity/auth-tokens` | Topics exported as values                                  | Convert to `export type`                             |
| `@comity/cache`       | `DefaultCache`, `serializeCacheKey`, `CACHE_TOKEN` in root | Evaluate if canonical; move to `/facade` if external |
| `@comity/storage`     | `DefaultStorage`, `STORAGE_TOKEN` in root                  | Evaluate if canonical; move to `/facade` if external |

> ✅ COMPLETED / SUPERSEDED — `@comity/auth-tokens` no longer exports topics and all
> interfaces are `export type`. `@comity/cache` keeps `DefaultCache`/`serializeCacheKey`
> canonical in the root (from `/facade`); `CACHE_TOKEN` was removed.
> `@comity/storage` keeps `DefaultStorage` canonical in the root (from `/facade`);
> `STORAGE_TOKEN` was removed.

---

## 6. P3 — Medium

| Package                 | Issue                     | Action                                         |
| ----------------------- | ------------------------- | ---------------------------------------------- |
| `@comity/hydration`     | Dead code commented       | Remove or export properly                      |
| `@comity/order`         | Verify ADR-002 compliance | Ensure `OrderCommands` exists as separate port |
| `@comity/i18n-typesafe` | Wiring types in root      | Move to `/setup`                               |

> ✅ COMPLETED / SUPERSEDED — `@comity/hydration` dead code was removed during the
> Phase 6.4A–C runtime hardening. `@comity/order` ADR-002 migration is complete:
> `OrderRepository` is the persistence boundary (`getById`/`save`/`search`) and domain
> operations (item mutation, status transitions) live on the `Order` entity — the
> separate `OrderCommands` port was not needed in the settled shape. `@comity/i18n-typesafe`
> root exposes only `createTypesafeFactory` and `TypesafeI18nLoader`.

---

## 7. P4–P6 — Low

| Package | Issue                        | Action                        |
| ------- | ---------------------------- | ----------------------------- |
| Various | TypeScript exports as values | Convert to `export type`      |
| Various | Missing docs/README          | Add documentation             |
| Various | Wrong sub-entrypoint names   | Rename `hooks` to `observers` |

> ✅ SUPERSEDED — rolled into the Phase 6.4 public-API cleanup (explicit barrels
> and `export type`); `hooks` → `observers` completed (§8).

---

## 8. Hooks → Observers Migration

Rule reference: [`public-api.md`](../../../development/docs/standards/public-api.md) §5.

| Old Path       | New Path           | Status  |
| -------------- | ------------------ | ------- |
| `auth/hooks`   | `auth/observers`   | Done    |
| `html/hooks`   | `html/observers`   | Done    |
| `http/hooks`   | `http/observers`   | Done    |
| `kernel/hooks` | `kernel/observers` | Done    |

Hooks are lifecycle extension points called by the framework/kernel.
Observers are passive subscribers implemented by consumers. The migration
removes the dual semantic of `hooks/` and aligns every package with the
observer pattern.

> ✅ COMPLETED — Phase 6.4. All four packages expose `/observers`; the legacy
> `hooks/` paths are gone.

---

## 9. Empty Barrels

| Package               | Required root export |
| --------------------- | -------------------- |
| `@comity/cache-kv`    | `KvCacheStore`       |
| `@comity/cache-redis` | `RedisCacheStore`    |

Rule reference: [`public-api.md`](../../../development/docs/standards/public-api.md) §2 (Adapters MUST export the concrete implementation of the Core Module contract).

> ✅ COMPLETED — Phase 6.4B (see §3).

---

## 10. `export type` Conversion

| Package               | Symbol(s)               | Current  | Target        |
| --------------------- | ----------------------- | -------- | ------------- |
| `@comity/auth-tokens` | Topic types             | `export` | `export type` |
| Various               | TypeScript-only exports | `export` | `export type` |

Rule reference: [`public-api.md`](../../../development/docs/standards/public-api.md) §8.

> ✅ COMPLETED — `export type` conversion is enforced by the repository lint surface;
> root barrels consistently use `export type` for type-only symbols.

---

## 11. `@comity/http` Client Task

Current state: `@comity/http` exposes an enforced client implementation
alongside the contract.

Required direction:

- Core Module `@comity/http` keeps the request/response contract only.
- Concrete client implementations move to dedicated adapter packages
  (one adapter per transport technology).

Pending decisions:

- Adapter naming (e.g. `@comity/http-fetch`, `@comity/http-node`).
- Whether existing consumers are migrated in lockstep or behind a deprecation alias.

> ✅ COMPLETED — Phase 6.4B. The fetch client was extracted to the Technology
> Adapter `@comity/http-fetch` (canonical name `fetchHttp`); `@comity/http`
> retained the request/response contract surface only.

---

## 11b. `@comity/graphql-client` Fetch Transport Extraction

Current state: `FetchGraphqlTransport` was moved out of `@comity/graphql-client`
into the dedicated Technology Adapter `@comity/graphql-client-fetch`.

Migration:

```ts
// before
import { FetchGraphqlTransport } from "@comity/graphql-client/transports";

// after
import { FetchGraphqlTransport } from "@comity/graphql-client-fetch";
```

`@comity/graphql-client/transports` still exists and continues to export
`CombinedGraphqlTransport` (pure transport composition, no technology binding).
`FetchGraphqlTransport` and `FetchTransportOptions` are no longer exported from
the Core Module.

---

## 12. Pending Decisions

| Topic                              | Status                                                              |
| ---------------------------------- | ------------------------------------------------------------------- |
| `@comity/http` client adapters     | ✅ RESOLVED — `@comity/http-fetch` (canonical `fetchHttp`) extracted |
| `@comity/cache` root exports       | ✅ RESOLVED — `DefaultCache`/`serializeCacheKey` canonical in root     |
| `@comity/storage` root exports     | ✅ RESOLVED — `DefaultStorage` canonical in root                       |
| `@comity/order` ADR-002 compliance | ✅ RESOLVED — `OrderRepository` persistence-only; domain ops on `Order` entity |

Each pending decision may shift the migration order in §3–§7.

---

## 13. How to Use This Document

1. This document is the **historical record** of the public-API migration.
2. Completed/superseded items are marked ✅ — do not treat them as open work.
3. For the current authoritative conformance inventory, see
   [`rule-reconciliation.md`](../../../development/docs/architecture/rule-reconciliation.md)
   and the enforcement packages (`@comity-dev/*`).
4. New compliance gaps should be tracked against the current standards, not re-added here.
5. Once a package is compliant, remove its row from §3–§7.

---

## 14. Search Contract Isolation (Phase 15)

Normative decision: ADR-008 — Explicit Core Module Composition Exceptions
(Closed Register), as migrated by Phase 15 (Phase 15A.1 approved).

### What changed

The search-shaped retrieval methods were **removed** from domain repository
contracts. Search now has its own contract surface owned by `@comity/search`.

| Old API                                                        | New API                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------- |
| `ProductRepository.search(criteria, ctx?)`                     | `SearchPort<ProductProjection>` (`@comity/search`)          |
| `PageRepository.search(criteria, ctx?)`                        | `SearchPort<PageModel>` (`@comity/search`)                  |
| `BlockRepository.search<T>(criteria, ctx?)`                    | `SearchPort<BlockModel>` (`@comity/search`)                 |
| `TaxonomyRepository.search(criteria, ctx?)`                    | `SearchPort<TaxonomyModel>` (`@comity/search`)              |
| Repository failures surfaced as `RepositoryError`              | Search failures surface as `SearchError` (`@comity/search/errors`) |

### New `@comity/search` public API

- `SearchPort<TProjection>` — generic search port. The projection type stays
  owned by the consuming domain module; Search itself is projection-agnostic
  and MUST NOT import any domain module.
- `SearchError` (with `SearchErrorReason`) — search-owned error extending
  `BaseError`, compatible with the existing Result conventions. Exported from
  the root and from the intentional `@comity/search/errors` subpath.

### Before / after

```ts
// before — repository-owned search
import type { ProductRepository } from "@comity/catalog";

class MyAdapter implements ProductRepository {
  async search(criteria: SearchCriteriaModel) { /* ... */ }
}

// after — search lives on a SearchPort
import type { SearchPort } from "@comity/search";
import type { ProductProjection } from "@comity/catalog";

export class ProductSearchAdapter implements SearchPort<ProductProjection> {
  async search(criteria: SearchCriteriaModel) { /* ... */ }
}
```

### Composition

`@comity/storefront`'s `DefaultSearchPageComposer` now consumes
`SearchPort<ProductProjection>` instead of `ProductRepository`. Application /
composition layers wire the repository together with the search port:

```ts
ctx.services.define(
  SEARCH_PAGE_COMPOSER_TOKEN,
  () => new DefaultSearchPageComposer(options.productSearchPort!)
);
```

### Affected packages

| Package                 | Change                                                        | Release |
| ----------------------- | ------------------------------------------------------------- | ------- |
| `@comity/search`        | Added `SearchPort<TProjection>` + `SearchError`                | minor   |
| `@comity/catalog`       | Removed `ProductRepository.search()`; dropped `@comity/search` | major   |
| `@comity/content`       | Removed `PageRepository.search()` / `BlockRepository.search()` | major   |
| `@comity/taxonomy`      | Removed `TaxonomyRepository.search()`                          | major   |
| `@comity/storefront`    | Composer consumes `SearchPort<ProductProjection>`              | major   |

`@comity/storefront → @comity/search` remains the approved capability
dependency (ADR-008 closed register, unchanged).

### Enterprise adapter migration

- **catalog-magento** — remove the repository `search()` implementation and
  implement `SearchPort<ProductProjection>` instead.
- **storefront-magento** — remove repository-owned search implementation and
  consume/implement the Search Port as appropriate for that adapter.
- **content-magento** — no repository search implementation exists today; the
  POC is already compatible with the repository-contract removal.

### Compatibility / breaking-change implications

- Any consumer calling `ProductRepository.search()` (or the page/block/taxonomy
  equivalents) must migrate to a `SearchPort` implementation or to the
  composing application layer.
- Repository contracts no longer import `@comity/search`; domain packages must
  not re-introduce that dependency.
- Search failures are now typed `SearchError`; adapters must not leak raw
  exceptions across the port boundary.
- The ADR-008 closed register no longer lists `catalog → search`,
  `content → search`, or `taxonomy → search`; these edges must not be
  re-introduced.

---
