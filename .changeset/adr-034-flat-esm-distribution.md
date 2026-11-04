---
"@comity/acl": patch
"@comity/acl-casl": patch
"@comity/address": patch
"@comity/auth": patch
"@comity/auth-jose": patch
"@comity/auth-tokens": patch
"@comity/cache": patch
"@comity/cache-kv": patch
"@comity/cache-redis": patch
"@comity/catalog": patch
"@comity/cli": patch
"@comity/cli-commander": patch
"@comity/composition": patch
"@comity/content": patch
"@comity/customer": patch
"@comity/geography": patch
"@comity/graphql-builder": patch
"@comity/graphql-client": patch
"@comity/graphql-client-fetch": patch
"@comity/graphql-client-ws": patch
"@comity/html": patch
"@comity/html-preact": patch
"@comity/html-react": patch
"@comity/http": patch
"@comity/http-fetch": patch
"@comity/http-hono": patch
"@comity/hydration": patch
"@comity/hydration-preact": patch
"@comity/hydration-react": patch
"@comity/i18n": patch
"@comity/i18n-typesafe": patch
"@comity/identity": patch
"@comity/inventory": patch
"@comity/kernel": patch
"@comity/media": patch
"@comity/order": patch
"@comity/organization": patch
"@comity/payment": patch
"@comity/pricing": patch
"@comity/primitives": patch
"@comity/queue": patch
"@comity/queue-pg-boss": patch
"@comity/router": patch
"@comity/router-path-to-regexp": patch
"@comity/search": patch
"@comity/seo": patch
"@comity/sql": patch
"@comity/sql-drizzle": patch
"@comity/sql-kysely": patch
"@comity/storage": patch
"@comity/storefront": patch
"@comity/taxonomy": patch
"@comity/validation": patch
"@comity/validation-zod": patch
---

ADR-034 (Amendment 1): ESM-only distribution with one flat `dist/` directory. Runtime JavaScript and TypeScript declarations are emitted side by side (`dist/index.js`, `dist/index.d.ts`); there is no `dist/esm`, `dist/types` or `dist/cjs`. Package metadata is `type: module`, `main`/`types` at `./dist/…`, and exports use `types` + `default` (no separate `import`/`require` branches, no `module` field). Node 24+ `require(ESM)` resolves to the same ESM file as `import` (compatibility, not CommonJS support; a graph with top-level `await` fails with `ERR_REQUIRE_ASYNC_MODULE`). No public subpath is added or removed. `@comity/queue-pg-boss` now follows the same shape and gains a working `main`. Type-only relative imports in `auth-tokens`, `cache-kv`, `http` and `router` gained `.js` extensions so emitted declarations resolve under `NodeNext`.

Patch (ADR-034 proposal, roadmap WP-B): it makes `require()` work and removes no working behaviour; a non-patch release of a peered Core Module would trigger the ADR-033 peer-dependent major cascade.
