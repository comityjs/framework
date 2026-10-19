# @comity/queue — Conventions

This document is normative. It restates the constraints ratified by ADR-028 and
`docs/design.md`; those documents remain authoritative where wording differs.

## Core boundary

- Keep the package free of queue libraries, database drivers, Redis clients, and
  `node:*` runtime imports.
- Keep technology-native types out of the public surface.
- Do not add a module descriptor, a `./setup` subpath, a DI token, or a hook.
- Do not add a worker factory, registry, scheduler, or lifecycle manager.
- Do not add a runtime queue implementation.

## Public surface

- Export the nine contract types from the root barrel as types only.
- Export `QueueError`, `QueueErrorReason`, and `QueueErrorMeta` from `./errors`.
- Declare only the `.`, `./errors`, and `./package.json` subpaths.
- Do not export helpers, mocks, conformance utilities, or `src/internal/`.

## Error model

- Define exactly one public error class, `QueueError`, with a finite reason union.
- Report failures through `Result`; `enqueue`, `start()`, and `stop()` never
  reject.
- Branch on `meta.reason`. `details` is non-canonical diagnostic metadata.
- Do not add a reason without a documented contract distinction; adding a reason
  is a MINOR change, renaming or removing one is MAJOR.

## Lifecycle

- Model one sequence per worker instance: `created → running → stopped`.
- Treat `stopped` as terminal.
- Return `invalid_lifecycle_state` for `start()` on `running` or `stopped`.
- Make `stop()` idempotent from `created` and `stopped`, and never reject.
- After a successful `stop()`, claim only that new work stopped and in-flight
  handlers settled.
- On `stop()` failure, report `lifecycle_failed` with `details.operation: "stop"`
  and claim neither guarantee.

## Guarantees

- Do not promise exactly-once execution, ordering, deduplication, priority,
  scheduling, or a universal shutdown timeout.
- Do not expose a portable option surface in the first version.
- Keep technology-specific configuration on the adapter's own factory and
  document it as non-portable.
