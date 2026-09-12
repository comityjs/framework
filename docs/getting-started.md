# Getting Started

This guide helps you install Comity, understand its essential pieces, and prepare for building your first application.

Comity is an architecture-first TypeScript runtime for modular applications. It provides explicit contracts, a composable module system, and replaceable technology adapters—so your domain logic stays independent from frameworks and infrastructure.

By the end of this guide, you will have:

- Installed the core Comity packages
- Created a project with a Kernel
- Understood how modules and composition work
- Prepared for building your first HTTP application

When you are ready to build a runnable application, continue to the next guide: **Your First Comity Application**.

---

## Prerequisites

Before starting, ensure you have:

- **Node.js >= 24**
- **pnpm** package manager
- Basic TypeScript knowledge

Comity is distributed as ESM packages. Your project should use `"type": "module"` in its `package.json`.

---

## Installation

### Core packages

Install the architectural foundation:

```bash
pnpm add @comity/primitives @comity/kernel @comity/composition
```

These packages provide:

| Package | Purpose |
|---------|--------|
| `@comity/primitives` | Foundational types: `Result`, `BaseError`, DI container, event/hook buses |
| `@comity/kernel` | Application lifecycle, service registry, event and hook dispatching |
| `@comity/composition` | Module loading, dependency resolution, and composition engine |

### HTTP packages

To build an HTTP application, also install:

```bash
pnpm add @comity/http @comity/http-hono hono
```

These packages provide:

| Package | Purpose |
|---------|--------|
| `@comity/http` | HTTP contracts: `HttpRequest`, `HttpResponse`, `HttpHandler`, `HttpFacade` |
| `@comity/http-hono` | Hono technology adapter that bridges Comity HTTP to the Hono framework |
| `hono` | The HTTP framework itself (peer dependency) |

---

## The minimum Comity mental model

Comity applications are built from three essential pieces:

### 1. Primitives

Foundational types and utilities that everything else depends on:

- **`Result<T, E>`** — Represents success or failure explicitly
- **`BaseError`** — Foundation for structured domain errors
- **DI Container** — Service registration and resolution
- **Event Bus** — Typed event publishing and subscription
- **Hook Bus** — Typed hook definition and execution

### 2. Kernel

The runtime that owns your application:

- Manages lifecycle states: `open` → `sealed` → `running` → `stopped`
- Provides service registration and resolution
- Dispatches events and executes hooks
- Enforces that services can only be defined while `open`

### 3. Composition

The mechanism that assembles your application from modules:

- **`load(kernel, modules)`** — Resolves dependencies, configures modules, and starts the kernel
- **`ModuleMeta`** — Declarative module metadata (name, version, dependencies, setup)
- **`ModuleSetupFn`** — Deferred initialization function returned by setup

---

## Your first Kernel

Create a Kernel with the minimal required context:

```typescript
import { DefaultDiContainer } from "@comity/primitives/di";
import { DefaultEventBus } from "@comity/primitives/lifecycle";
import { DefaultHookBus } from "@comity/primitives/lifecycle";
import { Kernel } from "@comity/kernel";

// Create the infrastructure primitives
const services = new DefaultDiContainer();
const events = new DefaultEventBus();
const hooks = new DefaultHookBus();

// Create the kernel
const kernel = new Kernel({ services, events, hooks });

console.log("Kernel created in open state");
```

The Kernel starts in the `open` state. In this state you can:

- Define services with `kernel.services.define(token, factory)`
- Subscribe to events with `kernel.events.subscribe(event, handler)`
- Define hooks with `kernel.hooks.define(name, handler)`

Once sealed (`kernel.seal()`), service registration is locked and resolution becomes available. After starting (`kernel.start()`), the application is ready to handle requests.

---

## Modules and Composition

Comity applications are assembled from explicit modules. Each module declares its identity and setup logic through `ModuleMeta`:

```typescript
import type { ModuleMeta } from "@comity/composition/setup";
import { success } from "@comity/primitives/result";

const myModule: ModuleMeta = {
  name: "my-module",
  version: "0.1.0",

  setup: async (ctx, options) => {
    // Register services, subscribe to events, define hooks
    ctx.services.define(MY_TOKEN, () => new MyService());

    // Return a deferred initialization function
    return success(async () => {
      // Initialization logic runs after kernel is sealed
      const service = ctx.services.resolve(MY_TOKEN);
      await service.initialize();
    });
  },
};
```

The composition engine handles the full lifecycle:

```text
1. Resolve  → Validate and order modules by dependencies
2. Setup    → Call each module's setup (reverse topological order)
3. Seal     → Lock service registration, enable resolution
4. Init     → Run deferred initialization (forward topological order)
5. Start    → Application is ready
```

Load modules into the kernel:

```typescript
import { load } from "@comity/composition";

const result = await load(kernel, [myModule]);

if (result.success) {
  console.log("Application started");
} else {
  console.error("Failed to start:", result.error);
}
```

---

## HTTP applications

To build an HTTP application, Comity provides:

- **`@comity/http`** — Framework-agnostic HTTP contracts and the HTTP module
- **`@comity/http-hono`** — Adapter that connects Comity HTTP to the Hono framework

The architecture follows a clear boundary:

```text
Your Application Code
        ↓
HttpHandler (receives HttpRequest, returns HttpResponse)
        ↓
HttpFacade (manages request lifecycle and events)
        ↓
httpHonoAdapter (maps Comity HTTP to Hono)
        ↓
Hono (HTTP server)
```

Key concepts you will use:

| Concept | Description |
|---------|-------------|
| `HttpRequest` | Incoming request snapshot (method, url, headers, body) |
| `HttpResponse` | Outgoing response (status, headers, body) |
| `HttpHandler` | Your application logic: `(ctx) => Promise<HttpResponse>` |
| `HttpContext` | Full context: request, services, events, state |
| `HttpFacade` | Manages handler execution and emits lifecycle events |

The HTTP module (`@comity/http/setup`) is a pre-built Comity module that wires the HTTP infrastructure into your kernel. It requires you to provide an `HttpHandler` during configuration.

---

## Why Hono?

The verified Getting Started path uses [Hono](https://hono.dev/) as the HTTP technology adapter. Hono is a fast, lightweight web framework that runs across multiple JavaScript runtimes (Node.js, Deno, Bun, Cloudflare Workers).

Comity's HTTP contracts are framework-agnostic. The `@comity/http-hono` package is a technology adapter that bridges Comity's HTTP abstraction to Hono. This means:

- Your application code depends only on Comity HTTP contracts
- Hono is an implementation detail at the transport boundary
- A different adapter could connect to another HTTP framework

The adapter pattern ensures your domain and application logic remains independent from the HTTP server.

---

## Development commands

When building a Comity application, you typically need:

```bash
# Build your TypeScript project
pnpm build

# Run your application
pnpm dev

# Run tests
pnpm test
```

These commands depend on your project's build setup (tsx, tsc, or your preferred TypeScript runner).

---

## What comes next

You now have Comity installed and understand the essential pieces:

- **Primitives**: Foundational types and utilities
- **Kernel**: Application lifecycle and service container
- **Composition**: Module system for assembling applications
- **HTTP layer**: Framework-agnostic HTTP with Hono adapter

Continue to **Your First Comity Application** to build a runnable HTTP application that demonstrates these concepts in practice.

For deeper exploration of the architecture, see:

- [Core Concepts](./core-concepts.md) — Detailed principles and patterns
- [Architecture](./architecture.md) — Implementation details and enforcement
- [Errors and Results](./errors-and-results.md) — Complete Result and error semantics
