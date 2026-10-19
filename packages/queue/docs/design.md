# @comity/queue — Design Document

> **Status:** Accepted — design specification accompanying ADR-028.
> This document does not exist as an implemented API. No package, manifest,
> source file, or test described here has been created.
> **Owner:** comity-community (runtime implementation). The decision it
> implements is owned by comity-development (ADR-028).

## Purpose and authority

This document specifies how the architecture decided in **ADR-028** is intended
to work, in enough detail for an implementation phase to proceed.

- **ADR-028 records the decision.** Where the two differ, ADR-028 governs, and
  this document MUST be corrected.
- **This document specifies behaviour.** It fixes the proposed public concepts,
  semantics, guarantees, non-guarantees, and testing expectations.
- **It authorizes nothing by itself.** Package creation, contracts, and adapters
  remain subject to the repository's normal change classification: a new contract
  and a new package are Architectural changes requiring an accepted ADR, this
  design document, and explicit review.

## Module responsibility

`@comity/queue` answers four questions, and nothing else:

- how a queue is identified;
- how a job is published, and what "published" means;
- how a handler is defined and given to a worker;
- how a worker is started and stopped.

The module defines the boundary a Technology Adapter must implement. It does not
define retry policy, scheduling policy, delivery policy, or any execution
semantics beyond "a handler is invoked with a job".

### What the module must not do

- Start, schedule, or poll anything. No background processing exists in the
  package.
- Provide a module descriptor, a `./setup` subpath, or a DI token.
- Import a queue library, a database driver, or a Redis client.
- Import `node:*` runtime APIs.
- Import another Core Module.
- Re-export any technology-native type.
- Accept a payload it does not simply carry.

## Layer classification and dependency direction

`@comity/queue` is a **Core Module**.

```text
Application
    ↓
@comity/queue-<technology>   (Technology Adapter)
    ↓
@comity/queue                (Core Module)
    ↓
@comity/primitives
```

`@comity/primitives` is the only dependency, and it is required only for
`Result`, `success`/`failure`, `BaseError`, and `isSuccess`/`isFailure`.

### Why this module is a Core Module but not a Composition Module

A **Core capability contract** is a set of interfaces and a module-owned error
class that Technology Adapters and Applications implement. A **Composition
Module** is additionally an object satisfying `ModuleMeta` (`name`, `version`,
`dependsOn`, `setup`) that `load()` resolves, orders, seals, and initializes.

`@comity/queue` is the first kind. It ships no descriptor, so it needs no
`@comity/composition` dependency, no DI token, and no hook.

A Composition Module is inappropriate here for a concrete reason: a queue worker
is a long-running consumer. Module initialization is required to be pure and MUST
NOT start servers, and Modules MUST NOT control application startup or shutdown.
Starting a worker from `setup` would therefore violate a ratified standard, and
declaring a descriptor while refusing to start a worker would produce a module
whose only purpose is an unstarted placeholder.

## Package layout

Proposed structure, following the repository's standard package layout and the
Core-Module convention that `package.json` subpath exports mirror physical `src/`
folders.

```text
packages/queue/
├── src/
│   ├── contracts/            # interfaces and value aliases
│   ├── errors/               # QueueError
│   │   └── __tests__/
│   ├── __tests__/
│   └── index.ts
├── docs/
│   ├── overview.md           # API-facing description
│   ├── conventions.md        # package-specific conventions
│   └── design.md             # this document
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
└── LICENSE
```

`src/internal/`, if it ever exists, is never exported. Forbidden subpath names
(`utils`, `helpers`, `shared`, `internal`, `lazy`) MUST NOT be used.

Proposed manifest, recorded here because it is the subject of ADR-028 D2:

```json
{
  "comity": { "layer": "core" },
  "license": "MIT",
  "type": "module",
  "engines": { "node": ">=24.0.0" },
  "dependencies": { "@comity/primitives": "workspace:*" }
}
```

`peerDependencies` MUST be absent. Subpath exports are `.` and `./errors`, as
fixed by ADR-028 D7: contracts as types from the root barrel, `QueueError` with
its reason union and metadata type from `./errors`.

## Public contract concepts

> **Illustrative signatures.** Every TypeScript block below is a **proposal**.
> It is not an existing API, it is not implemented, and it must not be imported
> from any published package. Symbols named here do not exist in the repository.
> The blocks are illustrative rather than executable: they show shapes, not
> compilable units, and they omit imports deliberately.

### Export surface

`@comity/queue` declares two subpaths (ADR-028 D7):

| Subpath | Contents |
| --- | --- |
| `@comity/queue` (root barrel) | The nine contract exports, as types: `QueueName`, `QueueJobId`, `QueueJobData`, `QueueAcceptedJob`, `QueueJob`, `QueueJobHandler`, `QueueProducer`, `QueueWorker`, `QueueWorkerConfig` |
| `@comity/queue/errors` | `QueueError` (value), `QueueErrorReason` (type), `QueueErrorMeta` (type) |

The root barrel exports no runtime value in the first version: the package
contains no class, factory, or implementation. Contracts are exported with
`export type`, per `public-api.md` §8.2. The error symbols live on `./errors`
rather than the root barrel because `public-api.md` §3.1 designates `/errors` for
"Custom error types … when the package defines domain errors"; 20 of the 31 Core
Modules declare an `./errors` subpath and export their error class from it, and
only 1 (`@comity/cli`) exports an error class as a value from the root barrel. The
remaining Core Modules define no module error class at all.

### Identifiers

```ts
// PROPOSED — illustrative.

/** Identifies a queue within one configured queue technology. Opaque. */
export type QueueName = string;

/** Identifies a job within its queue. Opaque; assigned by the technology. */
export type QueueJobId = string;
```

Semantic aliases, not value objects (ADR-028 D4). No format is required or
implied: not UUID, not numeric, not any particular serialization. Neither
identifier implies global uniqueness. Applications MUST NOT parse them.

### Payload

```ts
// PROPOSED — illustrative.

/** Opaque job payload. The Core carries it; it does not interpret or validate it. */
export type QueueJobData = Record<string, unknown>;
```

The payload type is opaque at the boundary, on the pattern of
`CliCommandArgs = Record<string, unknown>`, which the CLI Core explicitly does
not interpret.

### Accepted job

```ts
// PROPOSED — illustrative.

/** A publication the queue technology accepted. */
export interface QueueAcceptedJob {
  /** Identifier assigned by the technology. */
  readonly id: QueueJobId;
}
```

The accepted-job representation exists so that a successful publication returns a
named concept rather than a bare string, and so that adapter-supplied fields can
be added later without changing the operation's shape. The queue name is not
carried: the caller supplied it, so repeating it would be data with no
demonstrated consumer.

### Delivered job and handler

```ts
// PROPOSED — illustrative.

/** A job as delivered to a handler. */
export interface QueueJob<TData extends QueueJobData = QueueJobData> {
  /** Identifier assigned by the technology. */
  readonly id: QueueJobId;

  /** The queue the job was delivered from. */
  readonly name: QueueName;

  /** The payload, round-tripped through the technology's serializer. */
  readonly data: TData;
}

/**
 * A job handler.
 *
 * Returning normally settles the job. Returning a failure `Result` or throwing
 * reports a failed attempt. The adapter normalizes thrown values into
 * `QueueError("handler_failed")` and reports the attempt to the technology.
 */
export type QueueJobHandler<TData extends QueueJobData = QueueJobData> = (
  job: QueueJob<TData>
) => void | Promise<void> | Result<void, QueueError> | Promise<Result<void, QueueError>>;
```

The handler's return union follows `CliCommand.action`, which returns
`void | Promise<void> | Result<void, BaseError>` and whose Core "normalizes thrown
errors into `Result` failures". The queue contract adopts the same allowance so a
handler can signal failure either way, while the adapter remains responsible for
normalization and for reporting the attempt to the technology.

### Producer

```ts
// PROPOSED — illustrative.

/** Publishes jobs. Not started, stopped, or owned by this contract. */
export interface QueueProducer {
  /**
   * Publishes a job.
   *
   * A `success` result means the technology accepted the job, subject to the
   * adapter's documented persistence semantics. It does not mean the job was
   * delivered, that a handler ran, or that execution completed.
   */
  enqueue<TData extends QueueJobData>(
    name: QueueName,
    data: TData
  ): Promise<Result<QueueAcceptedJob, QueueError>>;
}
```

There is no options parameter, and therefore no cancellation signal, retry
configuration, delay, priority, or deduplication key in the portable contract
(ADR-028 D8). An options object added to reserve space would be an abstraction
without a consumer, and every member would need a documented non-guarantee that
no two technologies share.

**Where technology-specific configuration goes.** An adapter's own factory
accepts the technology's configuration, including publication defaults and
capability-specific settings, without making any of it part of this contract —
mirroring `createKyselySqlClient(options)` in `@comity/sql-kysely`. An adapter MAY
also extend its own producer with additional, non-portable capability, provided
it remains assignable to `QueueProducer` and documents the addition as
non-portable. Application code that relies on such an extension is, by
definition, not portable, and that is the honest and visible outcome rather than
a guarantee the Core Module cannot keep.

Because no caller can request a portable option, no core operation can report an
unsupported option, which is why `unsupported_option` is not part of the reason
union below.

### Worker

```ts
// PROPOSED — illustrative.

/** Registration of a handler for one queue. */
export interface QueueWorkerConfig<TData extends QueueJobData = QueueJobData> {
  /** The queue this worker consumes. */
  readonly queue: QueueName;

  /** The handler invoked for each delivered job. */
  readonly handler: QueueJobHandler<TData>;
}

/** Owns consumption of one queue. Created by an adapter, owned by the Application. */
export interface QueueWorker {
  /**
   * Enables job consumption.
   *
   * Never rejects. Resolves with `lifecycle_failed` when consumption could not
   * begin, or with `invalid_lifecycle_state` when the worker is already running
   * or has already stopped.
   */
  start(): Promise<Result<void, QueueError>>;

  /**
   * Prevents accepting additional work, allows in-flight handler invocations to
   * settle, and resolves after they settle. Idempotent. Never rejects. On
   * failure, neither half of that guarantee is confirmed; see the shutdown
   * failure semantics.
   */
  stop(): Promise<Result<void, QueueError>>;
}
```

### Construction

The Core Module defines no factory and no aggregate of "the technology". An
adapter exposes its own factory, accepting its own configuration type, and
returns values typed by `QueueProducer` and `QueueWorker` (ADR-028 D8, A8). This
mirrors `@comity/sql-kysely`, which exports `createKyselySqlClient` while
`@comity/sql` defines no client-factory contract.

The Core Module therefore contributes the shapes the Application programs
against; the adapter contributes construction. Swapping queue technologies
changes the composition root, not the code holding a `QueueProducer` or a
`QueueWorker`.

A factory MAY be infallible or return a `Result`; its signature is the adapter's
decision, and it is not part of this contract. Configuration errors that reach a
`QueueWorker` or a `QueueProducer` are reported through `invalid_configuration`.

## Error semantics

```ts
// PROPOSED — illustrative.

/** Finite set of machine-readable failure reasons. */
export type QueueErrorReason =
  | "invalid_configuration"
  | "invalid_request"
  | "unknown_queue"
  | "enqueue_rejected"
  | "enqueue_outcome_unknown"
  | "handler_failed"
  | "lifecycle_failed"
  | "invalid_lifecycle_state";
```

`QueueError` is the module's single public error class, extending `BaseError`
from `@comity/primitives/errors`, with `code` of the form
`` `queue:${QueueErrorReason}` ``. A single class with a finite reason union is
required by `errors.md` §9, which forbids error-class explosion. Adding a reason
later is a **MINOR** version change; renaming or removing one is a **MAJOR**
change.

`QueueErrorMeta` follows the `SqlErrorMeta` shape:

```ts
// PROPOSED — illustrative.

export interface QueueErrorMeta extends ErrorMeta {
  /** Canonical failure reason. */
  readonly reason: QueueErrorReason;

  /** Additional, non-canonical details for diagnostics. */
  readonly details?: Readonly<{
    /** The operation that failed. */
    operation?: "enqueue" | "execute" | "start" | "stop";

    /** Adapter name for diagnostics. */
    adapter?: string;

    /** Non-canonical retriability hint. Never use for application logic. */
    retriable?: boolean;
  }>;
}
```

As in `SqlErrorMeta`, `details` is non-canonical: application logic branches on
`meta.reason`, never on `details`.

### Reason semantics

| Reason | Raised when | Caller action |
| --- | --- | --- |
| `invalid_configuration` | The adapter cannot operate with the configuration it was given | Correct configuration; do not retry unchanged |
| `invalid_request` | The request is malformed — for example an empty queue name, or a payload the technology cannot serialize | Correct the request; do not retry unchanged |
| `unknown_queue` | The adapter does not know the requested queue | Register or correct the queue name |
| `enqueue_rejected` | The technology refused the publication; the job is not queued | Safe to treat as not queued; retry at the caller's discretion |
| `enqueue_outcome_unknown` | Acceptance cannot be determined — for example a timeout or a lost connection during publication | Treat as **possibly queued**; do not assume non-publication |
| `handler_failed` | A handler threw or returned a failure `Result` | Reported to the technology as a failed attempt |
| `lifecycle_failed` | `start()` or `stop()` was valid for the current state but could not complete | Inspect `details.operation`; investigate or retry as appropriate |
| `invalid_lifecycle_state` | The requested operation is not valid in the worker's current state — `start()` on a running or on a stopped worker | Do not call `start()` twice, and create a new worker after `stop()` |

Every reason above has a defined producer in the first version: it is either
returned by a core operation, or constructed by an adapter when it normalizes a
technology condition or a handler failure. None is retained as a placeholder for a
future capability. There is no reason for an unsupported option (D8 exposes no
portable option surface), and no separate reason for "not running" (`stop()` is
idempotent) or for "already running" (`invalid_lifecycle_state` covers both
lifecycle-misuse cases, mirroring the single `KernelError("invalid_lifecycle_state")`
reason).

`handler_failed` is not returned by any core operation: it occurs after
publication, inside a worker. It is the canonical reason adapters use when
normalizing a handler failure, and the reason any execution-failure signal an
adapter exposes must carry — never a technology-native error.

### Publication outcomes are not interchangeable

| Situation | Result |
| --- | --- |
| The technology accepted the job | `success` with a `QueueAcceptedJob` |
| The technology refused the job | failure with `enqueue_rejected` |
| Acceptance is indeterminate | failure with `enqueue_outcome_unknown` |
| The job was accepted and later failed | reported during execution as `handler_failed`; never a publication failure |

A timeout or a lost connection during publication MUST NOT be reported as
`enqueue_rejected`, even though the caller cannot distinguish those conditions
from a refusal locally. They are indeterminate outcomes. Treating one as a
confirmed non-publication risks duplicate work or lost work, and is the specific
defect `enqueue_outcome_unknown` exists to prevent. Note that removing a portable
cancellation option (D8) does not remove this case: indeterminate outcomes arise
from transport and infrastructure behaviour, not only from caller-initiated
cancellation.

### Error boundary rules

1. Adapter-native errors are translated into `QueueError` **inside** the adapter.
   Technology-native error types MUST NOT escape an adapter's public API.
2. Every core operation reports failure through `Result`: `enqueue`, `start()`, and
   `stop()` resolve with a `QueueError` failure and never reject. No core
   operation in the first version throws.
3. This includes lifecycle misuse. `invalid_lifecycle_state` is *returned*, not
   thrown, because `start()` and `stop()` are asynchronous operations whose single
   failure channel is their `Result`. The Kernel's reason is reused; its surfacing
   is not. The Kernel throws from synchronous accessors, while
   `Kernel.start()`/`Kernel.stop()` report through `Result`.
4. The first version defines no guard or registration API, so no throw path
   exists. If a later version adds one, `errors.md` §"Guard/assert errors" applies:
   a documented guard MAY throw a `QueueError`. In every case a thrown value MUST
   extend `BaseError`; raw `Error`, native runtime error subclasses, and thrown
   literals are forbidden.
5. No parallel error mechanism exists. `Result`, `success`/`failure`,
   `isSuccess`/`isFailure`, `BaseError`, and `toSafePayload` remain the only
   vocabulary. Adapters use `toSafePayload` at any transport or logging edge.
6. Core and domain code MUST NOT throw for business logic.

## Worker lifecycle

### States

```text
created ──start()──► running ──stop()──► stopped   (terminal)
   │
   └── stop() ──► stopped                          (terminal, idempotent)
```

| From | Operation | Outcome |
| --- | --- | --- |
| `created` | `start()` | Attempts to begin consumption; `success` moves to `running`, otherwise failure `lifecycle_failed` (`operation: "start"`) |
| `created` | `stop()` | Idempotent; `success`, moves to `stopped`; nothing was consumed |
| `running` | `start()` | failure `invalid_lifecycle_state` |
| `running` | `stop()` | Stops accepting new work, drains in-flight handlers, `success` once they settle, moves to `stopped` |
| `stopped` | `stop()` | Idempotent; `success` |
| `stopped` | `start()` | failure `invalid_lifecycle_state` |

### Restart

`stopped` is terminal for that worker instance. The first version neither
guarantees nor defines restart of a stopped worker: `start()` on a `stopped`
worker fails with `invalid_lifecycle_state`, and the Application creates a new
worker through the adapter's factory to consume again.

This is a deliberate limit of the first version, not a prohibition on the
capability. The state model does not prevent an adapter from supporting restart;
it prevents *this contract* from promising it, and it prevents an adapter from
silently re-opening a stopped worker through `start()`, which would contradict
the table above. An adapter that can restart exposes it as documented,
non-portable behaviour. Promoting restart to a portable guarantee requires a
later ADR.

### What `start()` enables

`start()` enables consumption of the configured queue by that worker. It does not
create the queue, declare the technology's schema or tables, or make the queue
technology otherwise ready. Any such provisioning is the Application's
responsibility and belongs to the adapter's initialization API, which is
technology-specific.

### What `stop()` guarantees

A successful `stop()` guarantees exactly two things:

1. The worker stopped accepting additional work.
2. The returned `Promise` resolved after in-flight handler invocations settled.

Both halves are conditional on the `Result` being a success. A `stop()` that
resolves with a failure confirms neither, which is why the failure case is stated
separately below.

`stop()` is idempotent. Calling it on a worker that is not running resolves as a
success.

### What `stop()` does not guarantee

- **Forcible termination.** A handler that ignores cancellation is not
  interrupted. The first version has no cancellation mechanism for a running
  handler.
- **A universal timeout.** No portable shutdown deadline exists. A bounded or
  forced variant is a technology-specific capability.
- **Bounded time.** "Resolves after in-flight work settles" may take arbitrarily
  long.
- **No redelivery.** A job interrupted by shutdown MAY be delivered again,
  possibly to another worker. This is a consequence of at-least-once delivery,
  not a defect.

Because `stop()` cannot promise that an interrupted job will not run again,
handlers MUST be idempotent.

### Shutdown failure

`stop()` never rejects. When the adapter cannot confirm that in-flight work
settled, it resolves with a failure carrying `lifecycle_failed` and
`details.operation: "stop"`. Neither half of the two-phase guarantee is confirmed
by such a failure: the adapter could not confirm that acceptance stopped, and
could not confirm that in-flight invocations settled.

After a failed `stop()` the contract makes no promise about the worker's state.
The caller MUST NOT rely on that worker for further consumption and SHOULD create
a new one. Further `stop()` calls remain safe to make, but they make no additional
promise.

The contract defines no shutdown deadline, so a `stop()` that never resolves is a
technology or handler defect rather than a contract violation, and the contract
offers no way to force it.

### Ownership

The Application creates workers, calls `start()`, and calls `stop()` as part of
its own shutdown sequence — for example by wiring `SIGINT` and `SIGTERM` to
`stop()`. Nothing in `@comity/queue` starts a worker, installs a process signal
handler, or polls. No Composition descriptor exists that could.

### Resource ownership

The first version defines no portable disposal, close, or teardown operation
(ADR-028 D9). Connection lifetime, connection pooling, teardown of an underlying
client, and any provisioning the technology requires are **adapter-owned**: an
adapter that needs explicit teardown exposes it as documented, non-portable
behaviour on its own factory result, and the Application decides whether to call
it.

`stop()` and resource disposal are separate concerns and must not be conflated.
`stop()` governs *consumption*: it stops the worker accepting new work and waits
for in-flight handlers. It does not govern *resources*: stopping every worker does
not necessarily release the technology's connections, and releasing connections
does not necessarily stop workers. An adapter documents both, and neither implies
the other.

## Portability boundaries

The contract is deliberately smaller than any single queue technology. What
follows separates what the contract *promises* from what an adapter may
*document*.

### Portable — promised by `@comity/queue`

- Publishing a job and learning whether the technology accepted it.
- Distinguishing acceptance, refusal, and an indeterminate outcome.
- Job and queue identity as opaque strings.
- A handler receiving the payload that was published.
- Handler failure being reported to the technology as a failed attempt.
- A worker that can be started and stopped, with the two-phase `stop()`
  semantics, and an explicit state model in which `stop()` is idempotent and the
  terminal state is well defined.
- A single failure channel: `enqueue`, `start()` and `stop()` report through
  `Result` and never reject.
- Operational failures as `Result` plus `QueueError`.

### Adapter-documented — not promised by the contract

| Concern | Depends on the technology |
| --- | --- |
| Retry count, retry delay, and backoff shape | Yes |
| Delayed execution | Yes |
| Deduplication or singleton behaviour | Yes |
| Priority | Yes |
| Batching | Yes |
| Dead-letter routing | Yes |
| Scheduling and recurrence | Yes |
| Claim, lease, heartbeat, and visibility semantics | Yes |
| Concurrency within a worker | Yes |
| Shutdown bound and forced shutdown | Yes |
| Persistence and durability of an accepted job | Yes |
| Payload size limits and serializer restrictions | Yes |
| Native identifier format | Yes |

### Technology snapshot

Recorded for planning. This is external evidence from vendor documentation;
it is **not** repository evidence, **not** execution-tested, and **not** a
contract guarantee. `~` marks a partial or indirect capability.

| Concern | pg-boss | BullMQ | Bee-Queue | imqueue |
| --- | --- | --- | --- | --- |
| Model | Job queue on PostgreSQL | Job queue on Redis | Job queue on Redis | Message-queue RPC |
| Publish | `send(name, data, options)`; may resolve a null id under some policies | `queue.add(name, data, opts)` | `queue.createJob(data).save()` | `send(toQueue, message, delay, errorHandler)` |
| Handler registration | `work(name, options, handler)` | `new Worker(name, processor, opts)` | `queue.process(concurrency?, handler)` | service methods; queue name is the service class name |
| Job identity | uuid by default; caller may supply one | auto-increment counter or custom `jobId` | auto id; `job.setId(id)` | message id |
| Delayed execution | `startAfter` | `delay` | `job.delayUntil()` | `send(..., delay, ...)` |
| Retries | `retryLimit`, `retryDelay`, `retryBackoff` | `attempts`, `backoff` | `job.retries()`, `job.backoff()` | none documented |
| Deduplication | queue policies plus `singletonKey` | custom `jobId`; ids of removed jobs are reusable | `setId()` | none documented |
| Priority | yes | yes | documented non-feature | no |
| Batching | yes (`batchSize`, `perJobResults`) | ~ | no | no |
| Dead letter | `deadLetter` per queue | ~ | no | no |
| Scheduling / recurrence | yes | yes | documented non-feature | no |
| Graceful shutdown | `stop()` waits by default; `offWork(..., { wait })` | `worker.close()`; no self-timeout | `close(timeout?)` | `stop()`; `destroy()` for teardown |
| Documented delivery | at-least-once | retries and stalled-job recovery; no exactly-once claim found | at-least-once | at-least-once |
| Runtime requirement | PostgreSQL | Redis | Redis 3.2+ | Redis; Node.js ≥ 22.12 |
| Licence | MIT | MIT | MIT | GPL-3.0-only or commercial |

Additional verified constraints an adapter must handle:

- BullMQ rejects custom job identifiers containing `:` and identifiers that are
  only digits.
- pg-boss may resolve a null identifier rather than a job id when unique-job,
  throttling, or non-standard queue policies are used. A null identifier is not
  necessarily a refused publication, and the adapter must classify it explicitly
  rather than mis-reporting it as `enqueue_rejected`.
- Bee-Queue requires the Application to schedule stalled-job checks; without them
  its at-least-once behaviour is weakened.

To be established by the first adapter's integration tests: whether an in-flight
handler that outlives the drain window is reported as failed or silently
abandoned; exact payload size and serializer limits; and whether restarting a
stopped worker is supportable.

## Adapter responsibilities

An adapter for `@comity/queue` MUST:

1. **Declare what it implements.** `"layer": "technology-adapter"` and
   `"implements": "@comity/queue"`.
2. **Declare dependencies correctly.** `@comity/queue` in both `dependencies`
   and `peerDependencies`; the queue technology library in `peerDependencies`.
3. **Expose their own factory.** A factory accepting the technology's own
   configuration, returning values typed by this Core Module's `QueueProducer`
   and `QueueWorker` contracts. No Composition descriptor, no `./setup` subpath,
   and no core-defined options type, unless a later ADR decides otherwise.
4. **Translate errors internally.** A single internal mapping module converting
   technology errors, aborts, and driver codes into `QueueError` reasons, on the
   pattern of the internal `mapSqlError` in `@comity/sql-kysely`. The mapping MUST
   NOT be exported.
5. **Not leak technology types.** No technology-native type may appear in the
   public API — including clients, connections, job handles, or identifier types.
6. **Keep non-portable capability on the adapter.** Technology-specific
   configuration and capability belong on the adapter's own factory and are
   documented as non-portable (ADR-028 D8). An adapter whose producer carries a
   non-portable extension MUST remain assignable to `QueueProducer`. Silent
   acceptance of an option an adapter cannot honour is forbidden: it turns a
   capability difference into a silent behaviour change.
7. **Classify publication outcomes honestly.** A refusal and an indeterminate
   outcome MUST be distinguished, using `enqueue_rejected` and
   `enqueue_outcome_unknown` respectively.
8. **Report handler failures.** A thrown value or a failure `Result` from a
   handler MUST be normalized into `handler_failed` and reported to the
   technology as a failed attempt, so the technology's own retry behaviour
   applies.
9. **Document its limits.** Persistence semantics for an accepted job, shutdown
   behaviour and bounds, payload and identifier restrictions, and which
   non-portable capabilities it offers.
10. **Adapt, not decide.** No business logic, no domain logic, no module logic.
    The adapter translates between the contract and the technology.
11. **Be integration-tested against the real technology**, not against mocks.
12. **Expose technology-specific capabilities as clearly non-portable.** Extra
    facilities may exist, but they MUST be documented as beyond the contract, and
    application code depending on them is by definition not portable.

Adapters MUST NOT:

- Start workers automatically or install process signal handlers.
- Re-export contracts owned by `@comity/queue`; consumers import contracts from
  the Core Module.
- Introduce a second public error class for queue failures.
- Depend on another adapter.

### A sketch of Application wiring

Illustrative only, and across technologies — the Application, not the Core
Module, owns this sequence:

```ts
// PROPOSED — illustrative. Not executable, not an existing API.

// 1. Construct producer and worker through the adapter's own factories.
//    `createQueueProducer` and `createQueueWorker` stand in for adapter-owned
//    factories (a pg-boss, BullMQ, or Bee-Queue one); their names and their
//    options belong to the adapter, not to @comity/queue.
const producer: QueueProducer = createQueueProducer(myTechnologyConfig);

// 2. Publish from the request path.
const accepted = await producer.enqueue("email-send", { to: "ada@example.com" });

// 3. Create and start a worker when the Application is ready to consume.
const worker: QueueWorker = createQueueWorker(myTechnologyConfig, {
  queue: "email-send",
  handler: async (job) => {
    await sendEmail(job.data);
  },
});

await worker.start();

// 4. Stop as part of the Application's own shutdown sequence.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void worker.stop();
  });
}
```

The variables are typed by the Core Module; only the two factory calls are
adapter-specific. The Core Module contributes the types and the semantics; the
Application contributes the process lifecycle. Nothing in this sequence is
implemented by `@comity/queue`.

## Guarantees and non-guarantees

This section is normative. The guarantees below are intended to appear as JSDoc
on the corresponding contracts, in the style `@comity/sql` uses to state its
guarantees and limitations directly in its contract documentation.

### Publication

**Guaranteed**

- A `success` result means the queue technology accepted the job, according to
  the adapter's documented persistence semantics.
- A failure result distinguishes a refused publication (`enqueue_rejected`) from
  an indeterminate outcome (`enqueue_outcome_unknown`).
- Publication does not wait for execution.

**Not guaranteed**

- That a successful publication means the job has executed, will execute, or has
  been delivered to any worker.
- That a job will execute at all. A job MAY never execute.
- That a refused publication is definitely not queued elsewhere in the
  technology.
- That the technology's persistence of an accepted job survives a technology
  failure. Durability is adapter-documented.
- Any ordering between publications.

### Payloads

**Guaranteed**

- The payload a handler receives is the payload that was published, as
  round-tripped through the technology's serializer.
- The Core does not interpret, transform, or validate the payload.

**Not guaranteed**

- That generic TypeScript types reflect runtime reality. Generics provide
  compile-time convenience only. The Core performs no runtime payload validation.
- That any payload is serializable by a given technology. Serialization and
  deserialization are adapter responsibilities, and restrictions are
  adapter-documented.
- Payload size limits.
- That a payload survives a technology's default serializer unchanged in type —
  for example, `Date` producing a string, or absent versus `null` fields.

Runtime validation, where required, belongs to the application — for example
through `@comity/validation`'s `Validator<T>` at the handler boundary. It is not
part of this contract.

### Delivery

**Guaranteed**

- At-least-once delivery is the strongest characterization the contract offers,
  and only where the technology documents it.
- Handler invocation failure is reported to the technology as a failed attempt,
  so the technology's own retry behaviour — if any — applies.

**Not guaranteed**

- Exactly-once execution. It is never promised.
- That a handler is invoked only once for a given job. Handler execution MAY be
  repeated; applications MUST design handlers so that repeated invocation is
  harmless.
- Ordering.
- Deduplication.
- Any specific retry count, retry delay, backoff shape, or maximum attempt count.
- Any specific acknowledgment, claim, lease, or visibility model.
- That a job in flight during shutdown is not redelivered.

### Capabilities

**Guaranteed**

- The portable contract exposes no optional capability surface. There is no option
  a caller can request, so there is no option an adapter can silently ignore, and
  nothing in the contract implies a capability is universally available.
- Technology-specific capability lives on the adapter's own factory and is
  documented as non-portable; it is never presented as portable.

**Not guaranteed**

- That any specific capability exists in any given adapter.
- That two adapters express the same technology-specific idea in the same way.
- That a capability available in one technology has any equivalent in another.

### Lifecycle

**Guaranteed**

- Starting and stopping a worker are explicit operations performed by the
  Application. Nothing starts automatically.
- `start()` enables consumption; a successful `stop()` prevents accepting
  additional work and resolves after in-flight handler invocations settle.
- `stop()` is idempotent, including on a worker that was never started.
- `start()` and `stop()` never reject. All failure is reported through `Result`.
- The state model is explicit: `created → running → stopped`, with `stopped`
  terminal for that worker instance, and `invalid_lifecycle_state` for a
  transition the model does not allow.

**Not guaranteed**

- Forcible termination of a running handler.
- A universal shutdown timeout, or that `stop()` completes in bounded time.
- That a job interrupted by shutdown will not run again.
- Restart of a stopped worker. `start()` on a `stopped` worker fails with
  `invalid_lifecycle_state`; consume again by creating a new worker.
- That a failed `stop()` confirmed either half of the two-phase guarantee.
- That a worker is usable after a failed `stop()`.
- Any portable disposal operation for the technology's own resources.

## Testing strategy

Follows `testing.md` (layer-aware mock policy) and the repository's existing test
layout: `src/**/__tests__/*.test.ts`, Vitest, `describe`/`it`, with error tests
asserting type, `code`, and `reason` rather than messages.

### Core Module — `@comity/queue` (no mocks)

The Core Module has one declared dependency (`@comity/primitives`) and almost no
runtime behaviour, so its tests are pure:

- **`QueueError`** — one case per reason: instantiation, `code` equals
  `` `queue:${reason}` ``, `name`, frozen `meta`, `cause` propagation,
  `details.operation` and `details.adapter` pass-through, and that the reason
  union is exhaustive. Mirrors the shape of the existing
  `packages/sql/src/errors/__tests__/error.test.ts`.
- **`Result` usage** — `success`/`failure` narrowing via `isSuccess`/`isFailure`
  for the failure-bearing operations.
- **Identifier opacity** — nothing in the Core parses, validates the format of,
  or derives meaning from a `QueueName` or `QueueJobId`.
- **Publication outcome vocabulary** — a test asserting that the four
  publication/execution outcomes remain four distinct outcomes, so the
  distinction cannot silently collapse.

Coverage thresholds follow the owning package's `vitest.config.ts`. No new testing
dependency is introduced; Vitest is already the repository convention.

### Adapter conformance suite

A reusable conformance suite is recommended. It MUST NOT become a public subpath
of `@comity/queue`: `public-api.md` forbids non-contract helper exports and
`src/internal/` is never exported. It belongs in development tooling, or in each
adapter's own test tree.

**Mandatory conformance behaviours** — every adapter, against the real queue
technology:

1. Publishing a job yields `success` with a non-empty, opaque `QueueJobId` for
   that queue.
2. A published job reaches a registered handler, and the handler receives exactly
   the payload that was published.
3. A handler that returns normally settles the job.
4. A handler that **throws** produces no unhandled rejection, and the attempt is
   reported to the technology as failed (normalized to `handler_failed`).
5. A handler that returns a failure `Result` behaves identically to throwing.
6. `start()` is required before consumption; `stop()` stops acceptance and
   resolves after in-flight handlers settle.
7. `stop()` is idempotent.
8. Publishing to an unknown queue yields `unknown_queue`, not a technology error.
9. A forced connectivity failure yields a `QueueError` and never a
   technology-native error; assert `error instanceof QueueError`. No core
   operation rejects: assert that a rejected promise is never observed.
10. `start()` on a running worker and `start()` on a stopped worker each yield
    `invalid_lifecycle_state` — not a technology error, and not a rejection.
11. `stop()` before `start()` resolves with `success`.
12. A publication interrupted under conditions the adapter cannot resolve
    deterministically yields either `success` or `enqueue_outcome_unknown`, and
    **never** `enqueue_rejected` when acceptance may have happened.
13. Configuration the adapter cannot use yields `invalid_configuration` where it
    reaches a `QueueProducer` or `QueueWorker`.

**Optional, adapter-specific tests** — not part of conformance: retries within the
adapter's documented policy, delayed execution, deduplication windows, priority
ordering, batching, dead-letter routing, and post-`stop()` redelivery behaviour.
These assert adapter-documented behaviour and MUST be labelled as such.

Adapters need a running queue technology. This repository contains no container or
test-harness dependency, and this design introduces none.

### What must not be tested

- Technology-specific behaviour asserted as if it were contract behaviour.
- Exact error messages (`testing.md` §11).
- Internal implementation details of the Core Module, which has none to lock.

## Initial exclusions

Deferred, and recorded so they are not silently re-introduced:

- Retry configuration, delayed execution, deduplication / idempotency keys,
  priority, batching, dead-letter handling, scheduling and recurrence, concurrency
  configuration, progress reporting, and job output capture.
- A portable options surface of any kind, including caller-supplied cancellation,
  retry, delay, priority, or deduplication (ADR-028 D8).
- A portable disposal, close, or teardown operation (ADR-028 D9).
- Worker restart after `stop()` (ADR-028 D6).
- A portable administrative API, and any dashboard-facing surface.
- An observer or event API for queue activity.
- A canonical in-memory queue implementation.
- Handler cancellation of a running job.
- Selection, creation, or implementation of any adapter.

The first three are decisions of this contract freeze rather than open questions;
reversing them requires a new ADR. The remainder requires either a new ADR for a
Core extension or a documented, non-portable adapter API.

## Open review items

Settled by this contract freeze, and no longer open: the export surface
(`./errors`, D7); the absence of a portable option surface (D8); the absence of a
portable disposal operation (D9); and restart of a stopped worker producing
`invalid_lifecycle_state` (D6). Changing any of these requires a new ADR.

Still open, and not blocking implementation:

| Item | Status |
| --- | --- |
| Naming review of the `Queue*` type prefix and of the `enqueue` verb | Open; `publish` was rejected as conflated with event publication (ADR-016) |
| Whether a delivered job should expose attempt metadata | Deferred; not portable across all candidate technologies |
| Whether a worker should expose observable lifecycle state | Deferred; the `Result` from `start()`/`stop()` is the first version's signal |
| The dependency-rule discrepancy for Core Modules depending on `@comity/composition` | Recorded in ADR-028 D2; owned by comity-development; does not affect this design, which uses no such dependency |

## References

- ADR-028 — Job Queue Core Module and Technology Adapters (the decision this document implements)
- ADR-007 — Multi-Context Adapter Architecture
- ADR-008 — Explicit Core Module Composition Exceptions
- ADR-016 — Event Publication Reliability Policy
- ADR-022 — CLI Core Module and Technology Adapter
- ADR-025 — Execution Context Composition via Application-Owned Wiring
- ADR-026 — Architecture Validator Authoritative Classification
- `@comity/sql` — contract guarantees stated in JSDoc, and the `SqlError` reason set
- `@comity/sql-kysely` — application-wired factory, internal error mapping, no exported technology types
- `@comity/cli` — handler return union and error-boundary statement
- `@comity/storage`, `@comity/graphql-client` — optional capability plus explicit unsupported-capability error
- `@comity/composition` — `ModuleMeta`, `ModuleSetupContext`, `load`
- Comity standards (comity-development): `layering-policy.md`, `adapters.md`, `errors.md`, `modules.md`, `public-api.md`, `testing.md`, `architecture-principles.md`
