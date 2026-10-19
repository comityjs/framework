# @comity/queue

Defines backend-independent job queue contracts for Comity.

---

## Purpose

Defines the contracts used to publish jobs and consume them through a worker
without binding Comity to a queue technology. Technology Adapters implement these
contracts; the core package carries no queue implementation and performs no
background processing.

---

## Scope

This package:

- ✅ defines queue and job identifier contracts
- ✅ encodes publication, payload, and accepted-job semantics
- ✅ exposes handler and worker lifecycle contracts
- ✅ offers module-level error types via the `errors` subpath

This package does NOT:

- ❌ implements a queue technology or worker runtime
- ❌ manages connections, provisioning, or backend resources
- ❌ specifies retries, scheduling, ordering, or deduplication
- ❌ promises exactly-once execution
- ❌ starts or polls background work

---

## Public API

- Queue and job identifiers — opaque aliases with no format requirement
- Publication contracts — producer, payload, and accepted job
- Worker contracts — handler, configuration, and lifecycle
- Error types (`@comity/queue/errors`) — one error class with a finite reason union

No exhaustive reference; see docs for constraints.

---

## Documentation

- docs/overview.md
- docs/conventions.md
- docs/design.md

---

## Related Packages

- @comity/primitives — Error and result primitives

---

## Status

Stable
