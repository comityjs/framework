# @comity/acl-casl

## 0.10.2

### Patch Changes

- Publish caret sibling ranges instead of exact pins (WP-A1, released by WP-A2).

  Every internal `@comity/*` reference in `dependencies` and `peerDependencies` now uses
  `workspace:^`, so published manifests carry `^<sibling version>` instead of the exact pin
  that `pnpm` produced from `workspace:*`. Under 0.x this means a patch bump of a sibling is
  compatible and a sibling minor is a range break. Sibling `devDependencies` are unchanged.

  This coordinated patch release publishes every package that carries a sibling edge; it
  contains no behaviour change.

- Updated dependencies
  - @comity/acl@0.9.4

## 0.10.1

### Patch Changes

- 5df89a5: ADR-034 (Amendment 1): ESM-only distribution with one flat `dist/` directory. Runtime JavaScript and TypeScript declarations are emitted side by side (`dist/index.js`, `dist/index.d.ts`); there is no `dist/esm`, `dist/types` or `dist/cjs`. Package metadata is `type: module`, `main`/`types` at `./dist/…`, and exports use `types` + `default` (no separate `import`/`require` branches, no `module` field). Node 24+ `require(ESM)` resolves to the same ESM file as `import` (compatibility, not CommonJS support; a graph with top-level `await` fails with `ERR_REQUIRE_ASYNC_MODULE`). No public subpath is added or removed. `@comity/queue-pg-boss` now follows the same shape and gains a working `main`. Type-only relative imports in `auth-tokens`, `cache-kv`, `http` and `router` gained `.js` extensions so emitted declarations resolve under `NodeNext`.

  Packaging: the `files` field of every package changed from `["./dist", "!./dist/**/*.map"]` to `["dist", "!dist/**/*.map"]`. pnpm 12 and npm ignore the `./`-prefixed negation, which would have put source maps into the published tarballs; the unprefixed form preserves the intended exclusion of `.map` files (published packages contain none).

  Patch (ADR-034 proposal, roadmap WP-B): it makes `require()` work and removes no working behaviour; a non-patch release of a peered Core Module would trigger the ADR-033 peer-dependent major cascade.

- Updated dependencies [5df89a5]
  - @comity/acl@0.9.3
  - @comity/primitives@0.9.2

## 0.10.0

### Minor Changes

- 0e2bb15: `CaslAuthorizer` supports field-level CASL rules: when `context` carries the
  adapter's `acl:field` directive, the check becomes
  `ability.can(action, subject, field)`, so rules such as
  `can('update', 'Task', ['title'], { tenant })` can be queried precisely instead
  of being encoded as separate fake actions. Without the directive the
  two-argument call runs unchanged, so "field omitted" keeps the previous CASL
  semantics, where a rule restricted to some fields still matches the resource-wide
  question.

  The directive is adapter-local, not part of `@comity/acl`: the Core contract keeps
  `subject`, `action`, `resource`, and the optional opaque `context`, and gains no
  authorization dimension. The directive is reserved (removed from a copy before
  the CASL subject is built, so conditions cannot match on it and the caller's
  context is not mutated) and validated — a value that is not a non-blank string is
  reported as `internal_error` rather than ignored, because silently dropping a
  restriction would answer a wider question than the caller asked. `authorize()`
  resolves the directive, builds the subject, and evaluates the ability inside one
  error boundary, so an unexpected runtime failure is reported as `internal_error`
  instead of escaping.

  Docs for both packages describe `context` as the only extension point, the
  `acl:field` convention, the CASL no-directive caveat, and a multi-tenant ticket
  example.

### Patch Changes

- Updated dependencies [0e2bb15]
  - @comity/acl@0.9.2

## 0.9.1

### Patch Changes

- Updated dependencies [713871e]
  - @comity/primitives@0.9.1
  - @comity/acl@0.9.1
