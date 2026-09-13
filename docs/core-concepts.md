# Core Concepts

Comity is built around a small set of recurring principles that govern its runtime model, package boundaries, and application architecture. Mastering these core concepts makes the entire ecosystem predictable and easy to reason about.

---

## Foundation

### Architecture as explicit boundaries

Comity treats architecture as an executable reality within the codebase, rather than a passive diagram or a set of review conventions.

```text
Architectural Intent ──► Package Boundaries ──► Contracts ──► Implementations ──► Composition ──► Validation

```

When a boundary matters, Comity provides the structural mechanisms to make it real and enforce it over time. Packages form strict boundaries, dependencies are explicitly declared, contracts define capabilities, and automated validation confirms that the codebase honors the intended design.

---

## Layers and dependency direction

Comity runtime packages are organized into distinct layers with an absolute architectural constraint: **dependencies must point strictly inward**.

```text
                  ┌───────────────────────────┐
                  │                           │
                  │         Primitives        │ (Base types, Result, Errors)
                  │                           │
                  └───────────────────────────┘
                                │
                                │
                                │
                  ┌───────────────────────────┐
                  │                           │
                  │           Kernel          │ (Lifecycle, Service Registry)
                  │                           │
                  └───────────────────────────┘
                                │
                                │
                                │
                  ┌───────────────────────────┐
                  │                           │
                  │        Composition        │ (Module Loading & Resolution)
                  │                           │
                  └───────────────────────────┘
                                │
                                │
                                │
                  ┌───────────────────────────┐
                  │                           │
                  │        Core Modules       │ (HTTP, Routing, Auth, SQL Contracts)
                  │                           │
                  └───────────────────────────┘
                                │
                                │
              ┌─────────────────┴─────────────────┐
              │                                   │
              │                                   │
┌───────────────────────────┐       ┌───────────────────────────┐
│                           │       │                           │
│    Technology Adapter     │       │    Integration Adapter    │ (Concrete Bindings)
│                           │       │                           │
└───────────────────────────┘       └───────────────────────────┘
```

- **Primitives:** The foundational base types, error primitives, and utility contracts.
- **Kernel:** The core execution engine managing lifecycles, service registration, events, and hooks.
- **Composition:** The resolution machinery handling module resolution and dependency graphs.
- **Core Modules:** Pure, framework-agnostic contracts defining capabilities like HTTP, SQL, routing, and auth.
- **Technology Adapters:** Concrete implementations binding a single core contract to a specific library (e.g., Kysely, Hono, Zod).
- **Integration Adapters:** Broad platform bindings coordinating multiple core modules (e.g., a Magento storefront adapter).

Keeping dependencies pointing inward ensures that domain concepts and core contracts remain entirely isolated from infrastructure details. Applications sit above this runtime layer, explicitly composing capabilities at the edge.

---

## Contracts vs. implementations

Comity strictly separates **what a capability is** from **how a capability is executed**.

A contract defines an interface shape and execution rules; an implementation satisfies that contract using a specific technology. This separation delivers five key guarantees:

1. **Replaceability:** Implementations can change without breaking dependent logic.
2. **Testability:** Core contracts can be mocked or executed in isolation without full infrastructure stacks.
3. **Framework Independence:** Business logic remains free from framework-specific vocabulary.
4. **Isolation:** Technical details (e.g., driver specifics, serialization quirks) stay strictly at the boundary.
5. **Stability:** Upgrading or swapping external technologies does not require architectural refactoring.

```text
A technology choice should never become a domain dependency.

```

---

## Composition at the edge

Comity separates **what an application is** from **how an application is assembled**.

The application owns composition—it chooses which modules to load, which adapters to bind, and how to wire services together. The runtime provides the orchestration mechanisms: declarative module metadata, container service registration, event/hook buses, and a deterministic kernel lifecycle.

> **The dependency injection container is a mechanism—not the architecture.**

Composition belongs at the application boundary so the core runtime remains uncoupled from any single assembly pattern or framework convention.

---

## Runtime

### Kernel lifecycle

The kernel governs execution through an explicit, four-state state machine:

```text
[ Open ] ──► (Configure & Register) ──► [ Sealed ] ──► [ Running ] ──► [ Stopped ]

```

- **Open:** Modules register services and declare capabilities within the container.
- **Sealed:** The container is locked against further service registration; dependency resolution paths are frozen.
- **Running:** The application is fully active, executing lifecycles, processing events, and handling workloads.
- **Stopped:** The system gracefully releases resources and shuts down.

Blurring configuration and runtime execution is strictly forbidden: registering a service after sealing, or resolving a service before sealing, triggers an immediate lifecycle violation.

---

### Module metadata

Modules describe their identity, capabilities, and requirements using explicit, declarative metadata. Module metadata answers operational questions at boot time:

- What is the module's name and version?
- Which module dependencies are required, and which are optional?
- Are there explicit module incompatibilities?
- What is the required resolution and load order?

Declarative metadata eliminates hidden auto-discovery and magic conventions, allowing the composition engine to resolve dependency graphs, detect cycles, and flag missing prerequisites before the kernel seals.

---

## Application semantics

### Result type

Comity models fallible operations using explicit `Result` semantics rather than ad-hoc thrown exceptions. The verified public API lives in `@comity/primitives/result`:

```ts
import type { Result } from "@comity/primitives/result";
import { success, failure, isSuccess } from "@comity/primitives/result";
import { BaseError } from "@comity/primitives/errors";

class UserNotFoundError extends BaseError {
  readonly code = "user:not_found";

  constructor() {
    super("User not found", {});
  }
}

function findUser(id: string): Result<{ name: string }, UserNotFoundError> {
  if (id === "missing") {
    return failure(new UserNotFoundError());
  }
  return success({ name: "Ada" });
}

const result = findUser("missing");

if (isSuccess(result)) {
  console.log(result.value.name);
} else {
  console.error(result.error.code, result.error.message);
}
```

The `Result<T, E>` pattern ensures that:

- Success and failure branches are explicit in the type signature.
- Failure values are strongly typed subclasses of `BaseError`.
- Control flow remains deterministic across application and boundary ports.

---

### Errors as domain objects

Errors in Comity are structured, transport-agnostic objects. The foundational error primitives live in `@comity/primitives/errors`:

```ts
import type { ErrorCode, ErrorMeta, SafeErrorPayload } from "@comity/primitives/errors";
import { BaseError } from "@comity/primitives/errors";
```

`BaseError` provides:

- **Stable Error Codes:** Machine-readable strings (e.g., `user:not_found`) for programmatic handling.
- **Structured Metadata:** Frozen context payloads for diagnostic inspection.
- **Transport Hints:** Optional metadata (e.g., HTTP status codes) carried cleanly without coupling the error to HTTP.

For boundary crossings, Comity provides `toSafePayload`, converting errors into sanitized representations stripped of stack traces and internal causes:

> `toSafePayload` provides a transport-safe representation of an error. Transport safety is an explicit capability of the error model, not an automatic property of every error path.

For complete usage guides and API signatures, see [errors-and-results.md](./errors-and-results.md).

---

### HTML rendering & hydration boundaries

Comity treats HTML rendering and client-side hydration as renderer-independent contracts defined in `@comity/html` and `@comity/hydration`.

```text
                Application / Domain
                          ↓
        HtmlRenderer Contract (@comity/html)
                          ↓
┌─────────────────────────┬─────────────────────────┐
│ React Renderer Adapter  │ Preact Renderer Adapter │
└─────────────────────────┴─────────────────────────┘
```

The core contract (`HtmlRenderer`, `HtmlRenderResult`, `HtmlOutput`) defines document streaming and content types without binding the application to a specific rendering engine. Similarly, `@comity/hydration` establishes island contracts, scheduling, and serialization strategies, while concrete packages (`@comity/hydration-react`, `@comity/hydration-preact`) plug in the underlying view framework at the edge.

---

## Governance

### Architecture enforcement

Comity treats architecture as something that can be continuously validated throughout the development lifecycle:

```text
Architectural Rules ──► Package Rules ──► Automated Validation ──► CI Pipeline
```

Rules are declared in package metadata and workspace dependency configurations. Validation tools check the dependency graph during local builds and CI runs, detecting unwanted imports or boundary violations automatically.

Validation enforces defined rules mechanically; it does not replace thoughtful architectural design.

---

### Runtime vs. development tooling

The ecosystem is strictly bifurcated to keep build concerns out of production runtimes:

- **`@comity/*`:** Runtime and application packages consumed directly by production applications.
- **`@comity-dev/*`:** Governance, validation, and build tooling used strictly to maintain and enforce rules within Comity monorepos.

Application developers consume `@comity/*` packages. `@comity-dev/*` tooling is never installed as a production application dependency.
