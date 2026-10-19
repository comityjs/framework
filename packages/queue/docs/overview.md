# @comity/queue — Overview

`@comity/queue` defines the minimal, stable boundary used by Comity applications
to publish jobs and consume them with a worker, without binding application code
to a queue library.

It is a **contract package**, not a queue implementation. It starts no process,
opens no connection, and performs no background processing.

## Problem

Without a contract, an application that needs deferred work must adopt a queue
library directly. Application code then depends on that technology's client,
identifier type, retry vocabulary, and error model, and replacing the technology
requires rewriting application code.

`@comity/queue` inverts that dependency: the application programs against queue
contracts, and a Technology Adapter supplies the technology integration.

## Responsibility

The contract answers four questions, and nothing else:

- how a queue is identified
- how a job is published, and what acceptance means
- how a handler is defined and given to a worker
- how a worker is started and stopped

It does not define retry policy, scheduling, ordering, deduplication, or any
execution semantics beyond "a handler is invoked with a job".

## Architecture

```text
Application
    ↓
@comity/queue-<technology>   (Technology Adapter)
    ↓
@comity/queue                (Core Module)
    ↓
@comity/primitives
```

The Application constructs producers and workers through an adapter's own
factory, then owns the worker lifecycle: it calls `start()` when consumption
should begin and `stop()` as part of its own shutdown sequence. Nothing in this
package starts a worker, installs a signal handler, or polls.

## Boundaries

- Defines contracts only; carries no runtime queue behaviour.
- Depends only on `@comity/primitives`.
- Ships no module descriptor, `./setup` subpath, or DI token.
- Re-exports no technology-native type.

## Portability

A successful publication means the queue technology accepted the job, subject to
the adapter's documented persistence semantics. It does not mean the job was
delivered, that a handler ran, or that it executed successfully.

At-least-once delivery is the strongest delivery characterization the contract
offers, and only where the technology documents it. Exactly-once execution,
ordering, deduplication, retry counts, and scheduling are not part of the
portable contract.

## Decision record

ADR-028 — Job Queue Core Module and Technology Adapters, in the
`comity-development` repository. Where `docs/design.md` and ADR-028 differ,
ADR-028 governs.
