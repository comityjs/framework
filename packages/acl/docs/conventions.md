# @comity/acl — Conventions

`@comity/acl` is a Core Module: it defines contracts and owns no policy engine.

## Rules

- Keep the contracts engine-agnostic. No CASL, RBAC, ABAC, or SQL concepts in
  this package — not in types, not in JSDoc examples.
- Keep the question minimal: `subject`, `action`, `resource`, optional `context`.
  A new dimension must be expressed in `context` first and must earn its place in
  the contract only if every implementation can honour it.
- `context` is opaque. Do not validate it, do not read it, do not impose a schema,
  and do not reserve keys in it. Its shape belongs to the implementation and the
  Application Layer.
- Do not promote an implementation capability into the contract. Field-level
  permissions, ownership, tenant isolation, and role models are capabilities of
  adapters; the core neither requires nor guarantees them.
- An implementation that ignores part of `context` MUST keep answering the
  question it already answered and SHOULD document what it ignores, because
  ignoring a restriction answers a wider question than the caller asked.
- A denial stays a successful `Result` with `allowed: false`; an
  `AuthorizationError` is reserved for infrastructure and provider failures.
- Do not change the shape of `AuthorizationDecision` or `AuthorizationError` to
  carry policy detail. `reason` is a human-readable string, not a channel for
  machine-readable information.

## Adding a capability

Contract growth is additive: new properties are optional, new capabilities are
new interfaces. A capability that only some engines can express stays with those
engines — document it in the adapter, pass the needed data through `context`, and
leave the core contract alone.
