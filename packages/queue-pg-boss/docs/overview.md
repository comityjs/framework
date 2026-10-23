# @comity/queue-pg-boss — Overview

`@comity/queue-pg-boss` binds the `@comity/queue` contracts to **pg-boss**, a job
queue built on PostgreSQL.

It is a Technology Adapter. It translates between the portable queue contracts and
one queue technology; it defines no queue semantics of its own. Application code
depends on `QueueProducer`, `QueueWorker`, and `QueueError` from `@comity/queue`.

## Problem

The queue contract deliberately exposes no backend configuration: no connection,
schema, retry policy, scheduling, or throughput settings. An Application that wants
PostgreSQL-backed jobs needs a concrete implementation of the contract and a place
to put that configuration.

This package is that implementation. pg-boss clients, types, and errors stay inside
the adapter.

## Architecture

```text
Application
    ↓
@comity/queue-pg-boss          (Technology Adapter)
    ↓
@comity/queue                  (Core Module)
    ↓
@comity/primitives

@comity/queue-pg-boss ──► pg-boss ──► PostgreSQL
```

## Flow

1. The Application calls `createPgBossQueueClient`. The factory validates the
   configuration, starts pg-boss (which runs its migrations), provisions the
   configured queues, and verifies that each one exists.
2. The Application publishes through `client.producer.enqueue(queue, data)`.
3. The Application creates workers with `client.createWorker({ queue, handler })`
   and calls `start()` when consumption should begin.
4. As part of its own shutdown sequence, the Application calls `stop()` on each
   worker and then `client.close()`.

Nothing in this package starts a worker, installs a signal handler, or polls
without an explicit `start()`.

## Example

```ts
import { createPgBossQueueClient } from "@comity/queue-pg-boss";

const created = await createPgBossQueueClient({
  connection: process.env["DATABASE_URL"] ?? "postgres://localhost/comity",
  queues: [{ name: "emails", retryLimit: 3, expireInSeconds: 60 }],
});

if (!created.success) {
  throw created.error;
}

const client = created.value;

const worker = client.createWorker({
  queue: "emails",
  handler: async (job) => {
    // job.data is the payload that was published.
  },
});

await client.producer.enqueue("emails", { to: "user@example.com" });
await worker.start();

// Application-owned shutdown
await worker.stop();
await client.close();
```

## Queue identity and provisioning

The `queues` array is the adapter's definition of which queues exist. A name outside
it is rejected with `unknown_queue` without any database access.

At startup, each configured queue is created when `provisionQueues` is not `false`.
pg-boss's `createQueue` inserts only when the queue is absent; it never updates an
existing queue's policy, retry, or expiration settings. Changing a definition
therefore does not rewrite the database. The adapter verifies existence, not
configuration equality.

A queue deleted after startup is reported as `unknown_queue` on the next
publication, and its worker's polling errors are delivered to `onBackendError`
when configured. The adapter always installs a pg-boss `error` listener, even
without an observer: Node throws when an `error` event has no listener, so an
operator callback must not be the thing that decides whether a backend failure
can crash the process. Without the callback those errors are consumed; there is
no portable reporting channel.

## Queue policies

`standard`, `short`, `singleton`, `stately`, and `exclusive` are accepted.
`key_strict_fifo` is rejected during configuration validation: pg-boss requires
a per-job `singletonKey` for that policy, and the portable producer has no way to
supply one. Rejecting it at startup keeps a configuration that could never
publish from passing validation and failing later at enqueue time.

## Shutdown and `expireInSeconds`

pg-boss treats a job as failed when its handler runs longer than
`expireInSeconds` (default 900 seconds). The handler itself is **not** stopped; it
keeps running while pg-boss may retry the job elsewhere. `offWork({ wait: true })`
also stops waiting for a handler that outlived its timeout.

`QueueWorker.stop()` therefore keeps its own record of every handler it accepted
and waits for those handlers after pg-boss stops polling. A successful `stop()`
never resolves while an adapter-accepted handler is still running. A handler that
never settles makes `stop()` never settle, which the core contract permits.

`close()` stops every worker the client created before touching pg-boss. Worker
creation and shutdown are mutually exclusive: once `close()` has started,
`createWorker()` throws, so a worker cannot be registered after the drain and run
outside the close barrier.

Setting `expireInSeconds` below the real execution time increases duplicate
execution. Handlers must be idempotent.

## Module format

The package is **ESM-only**. Import it from an ES module or a bundler; `require()`
reports `ERR_PACKAGE_PATH_NOT_EXPORTED`.

The repository's shared build emits a CommonJS tree, but that tree carries no
CommonJS scope marker, so Node treats it as ESM and its internal `require()` calls
fail — a repository-wide packaging defect that also affects `@comity/primitives`
and `@comity/queue`. Adapter-local markers fix this package but not its
dependencies, so advertising a `require` condition would publish an entry point
that fails at runtime. CommonJS support should return once the shared build emits
scope markers or the package is bundled; that is a packaging decision for review.

## Development

The package builds, type-checks, and runs unit tests with the repository scripts.
Integration tests require a PostgreSQL database and are skipped unless
`TEST_DATABASE_URL` is set:

```sh
TEST_DATABASE_URL=postgres://user:password@localhost:5432/comity_test pnpm test
```

The suite creates uniquely named queues and removes them afterwards. The database
user must be able to run pg-boss migrations.
