# Architecture

This document outlines the architectural implementation of Comity: its layered execution model, dependency constraints, composition engine, and continuous validation machinery.

---

## Architecture Overview

Comity's runtime is structured as a concentric set of layers where dependencies flow strictly inward toward the core primitives:

```text
┌────────────────────────┐
│      Application       │
└───────────┬────────────┘
            │
┌───────────┴────────────┐
│  Integration Adapters  │
└───────────┬────────────┘
            │
┌───────────┴────────────┐
│   Technology Adapters  │
└───────────┬────────────┘
            │
┌───────────┴────────────┐
│      Core Modules      │
└───────────┬────────────┘
            │
┌───────────┴────────────┐
│      Composition       │
└───────────┬────────────┘
            │
┌───────────┴────────────┐
│         Kernel         │
└───────────┬────────────┘
            │
┌───────────┴────────────┐
│       Primitives       │
└────────────────────────┘
```

The runtime ecosystem is strictly isolated from development, governance, and build machinery:

| Ecosystem       | Scope & Namespace | Primary Purpose                                                                   | Application Runtime Footprint |
| --------------- | ----------------- | --------------------------------------------------------------------------------- | ----------------------------- |
| **Runtime**     | `@comity/*`       | Core primitives, kernel, capability contracts, and concrete adapters.             | **Required**                  |
| **Development** | `@comity-dev/*`   | Governance, static analysis, build pipelines, and architecture enforcement tools. | **Excluded**                  |

---

## Dependency Direction & Constraints

Inward dependency flow is the foundational constraint of the Comity runtime:

- **Primitives:** Self-contained foundation (`Result`, `BaseError`, DI container, hooks/events, time primitives). Zero external runtime dependencies.
- **Kernel:** Depends exclusively on Primitives. Provides execution state, service lookup, and event mechanics.
- **Composition:** Depends on Kernel and Primitives. Handles module dependency graphs, topological sorting, and configuration loading.
- **Core Modules:** Depend on Primitives, Kernel, and Composition infrastructure. Define capability contracts (HTTP, Auth, SQL, HTML). **Strictly forbidden from importing Adapters.**
- **Technology Adapters:** Implement a single Core Module contract using a concrete library. Depend on their respective Core Module and Kernel packages.
- **Integration Adapters:** Platform-level orchestrators. May import multiple Core Modules to bind full external platform capabilities (e.g., Shopify storefronts).

```text
Domain Boundary Enforcement
─────────────────────────────────────────────────────────────────────────────
❌ HTTP / Web transport models MUST NOT bleed into Domain or Rendering contracts.
❌ Rendering engines MUST NOT depend on HTTP headers or transport protocols.
❌ Database / ORM primitives MUST NOT dictate Domain models or Business Entities.
❌ External Frameworks MUST NOT act as the Core Architecture.

```

By default, inter-module dependencies within the **Core Modules** layer are prohibited. Any core-to-core connection must be explicitly declared and verified in package metadata to prevent subtle, cyclic coupling.

---

## Core Modules & Technology Adapters

Technology adapters satisfy core contracts through an explicit boundary:

```text
┌─────────────────────────┐
│  Core Module Contract   │ (e.g., @comity/html)
└────────────▲────────────┘
             │ Implemented by
┌────────────┴────────────┐
│   Technology Adapter    │ (e.g., @comity/html-react)
└─────────────────────────┘
```

Each technology adapter explicitly declares its targeted Core Module inside its package manifest. This contract declaration is verified by governance analysis to ensure:

1. Adapters cannot introduce alternative interface contracts.
2. Core Contracts cannot absorb concrete framework abstractions.
3. Adapters may consume composition infrastructure from adjacent core packages without violating contract boundaries.

### Production Implementations

- **HTTP Contract:** Implemented via Hono (`@comity/http-hono`) and Fetch API (`@comity/http-fetch`).
- **HTML Rendering Contract:** Implemented via React (`@comity/html-react`) and Preact (`@comity/html-preact`).
- **SQL Execution Contract:** Implemented via Kysely (`@comity/sql-kysely`).
- **Validation Contract:** Implemented via Zod (`@comity/validation-zod`).

---

## Integration Adapters

An Integration Adapter coordinates cross-cutting concerns across multiple core capabilities for a target platform.

```text
                          ┌────────────────────────┐
                          │  Integration Adapter   │ (e.g., Shopify Storefront)
                          └───────────┬────────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
│ Catalog Module  │          │   Auth Module   │          │   Cart Module   │
└─────────────────┘          └─────────────────┘          └─────────────────┘
```

Integration adapters bind external systems (e.g., Shopify) to internal domain capabilities as a single, fully replaceable unit. Orchestration logic belongs exclusively inside Integration Adapters or Application Edge handlers—never inside isolated Core Modules.

---

## Composition Engine

Applications are assembled via four explicit components: **Kernel Buses**, **Module Metadata**, **Loading Sequence**, and **Dependency Resolution**.

### 1. Kernel Mechanics

The Kernel acts as the central execution broker, offering four fundamental mechanisms guarded by an explicit state machine:

- **Service Container:** Explicit service registration and resolution.
- **Event Bus:** Asynchronous pub/sub messaging.
- **Hook Bus:** Synchronous / pipeline interception hooks.
- **State Lifecycle:** Transition states (`open` ──► `sealed` ──► `running` ──► `stopped`).

```text
Service Definition ──► [ SEAL ] ──► Service Resolution
 (Allowed in OPEN)                  (Blocked until SEALED)

```

### 2. Declarative Module Metadata

Modules describe their identity and operational boundaries via declarative manifests. The public contract is `ModuleMeta` from `@comity/composition/setup`:

```ts
import type { ModuleSetupContext, ModuleSetupFn } from "@comity/composition/setup";
import type { BaseError } from "@comity/primitives/errors";
import type { Result } from "@comity/primitives/result";

interface ModuleMeta<
  Options extends Record<string, unknown> = Record<string, unknown>,
  Context extends ModuleSetupContext = ModuleSetupContext,
> {
  readonly name: string;
  readonly version: string;
  readonly priority?: number;
  readonly dependsOn?: Readonly<
    Record<string, { version?: string; optional?: boolean }>
  >;
  readonly incompatibleWith?: readonly string[];
  readonly setup: (ctx: Context, options?: Options) => Promise<Result<ModuleSetupFn, BaseError>>;
}
```

`setup` returns a `ModuleSetupFn` — a deferred initialization function that runs after the kernel is sealed. This separates service registration (during setup) from stateful initialization (after seal).

### 3. Execution Lifecycle Sequence

Application composition follows a deterministic pipeline:

```text
Stage 1: Resolve Graph ──► Stage 2: Setup ──► Stage 3: Seal ──► Stage 4: Initialize

```

1. **Graph Resolution:** Evaluates module dependencies, validates semantic versions, checks for prohibited combinations, and calculates execution order.
2. **SETUP (Reverse Topological Order):** Calls `setup()` on modules from leaves to root. Modules register services, hook handlers, and event listeners into the open Kernel. `setup` returns a deferred `ModuleSetupFn`. Service resolution is forbidden.
3. **SEAL:** The Kernel transitions state. Service registration locks down; container resolution is enabled.
4. **INITIALIZE (Forward Topological Order):** Executes the deferred `ModuleSetupFn` returned by each module's setup, from root to leaves. Services are resolved, initial events fired, and stateful connections opened.

Failure at any point in this pipeline halts boot immediately, returning a strongly typed `Result` payload.

---

## Continuous Architecture Enforcement

Comity enforces package boundaries, dependency directions, and metadata compliance directly within CI/CD pipelines through automated tooling (`@comity-dev/*`):

```text
    Architectural Rule Declaration
                  ↓
      Package Manifest Metadata
                  ↓
Static Dependency & Graph Verification
                  ↓
   Continuous Integration (CI Gate)
```

- **Layer Classification:** Manifests declare layer identity (`primitives`, `kernel`, `core`, `adapter`).
- **Graph Verification:** Static analyzers build module import trees and fail builds if an inward layer imports an outward layer.
- **Contract Verification:** Automated checks ensure Technology Adapters implement valid, declared Core Module contracts.
- **API Boundary Integrity:** Export maps (`package.json#exports`) are inspected to prevent leaked internal modules.

---

## Automated Enforcement Boundaries

While automated governance prevents architectural drift, it operates within strict limits:

- **Static Analysis verifies conformance, not design quality:** Clean dependency graphs can still contain poor interface design or clumsy abstractions.
- **Boundary compliance is mechanical:** Passing CI verification confirms compliance with declared rules, but does not substitute for domain modeling discipline.
- **Rule Enforcement is non-retroactive:** Analysis tools enforce rules explicitly configured in `@comity-dev/*` manifests; unmapped edge cases require human architectural review.

Automated governance makes architectural intent durable across teams—it does not replace architectural judgment.
