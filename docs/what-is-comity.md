# What is Comity?

Comity is an architecture-first TypeScript runtime for building modular applications. It is not an all-in-one framework that dictates how to structure your entire codebase; instead, it provides a set of core packages, explicit contracts, and runtime primitives designed to make architectural boundaries visible, predictable, and replaceable.

Adopting Comity means committing to an application architecture where the business domain, contract definitions, composition mechanisms, and technology adapters remain separate concerns with a strict, intentional direction of dependency.

---

## The central distinction

Conventional frameworks often attempt to solve every problem within a single model. The framework owns the runtime, the request parsing, the rendering pipeline, and the dependency wiring. While this yields fast initial progress, the framework eventually becomes the architecture, coupling business logic to external technology decisions.

Comity flips this relationship:

```text
     Application Architecture
                 ↓
        Explicit Contracts
                 ↓
       Explicit Composition
                 ↓
 Technology Adapters (Replaceable)
```

In Comity, the application owns how capabilities are composed, explicit contracts define what those capabilities are, and technology adapters bridge external libraries into Comity concepts.

---

## Layers and dependency direction

Comity packages are organized into distinct layers. Dependencies flow strictly inward toward core abstractions:

- **Application:** The outer entry point that configures, wires, and launches the system.
- **Technology Adapters:** Concrete implementations binding Comity contracts to specific technologies (e.g., Hono, React, Kysely, Zod, CASL, Jose).
- **Core Contracts:** Framework-agnostic interfaces defining capabilities such as HTTP, HTML, routing, authentication, SQL, caching, and search.
- **Kernel & Composition:** The runtime orchestration layer handling module lifecycles, service registration, event dispatching, and hook execution.
- **Primitives:** Foundational building blocks including `Result<T, E>`, `BaseError`, dependency containers, and low-level lifecycle primitives.

The ecosystem of packages may expand, but the inward dependency direction remains an absolute architectural constraint.

---

## Contracts vs. implementations

Comity strictly isolates **what a capability is** from **how a capability is executed**.

Core packages define pure contracts. For example, the HTTP package establishes request/response contracts and middleware semantics; the HTML package defines document rendering contracts; the SQL package defines query execution interfaces.

```text
                  ┌───────────────────────────┐
                  │                           │
                  │       Core Contract       │ (defines interface)
                  │                           │
                  └───────────────────────────┘
                                │
                                │
              ┌─────────────────┴─────────────────┐
              │                                   │
              ▼                                   ▼
┌───────────────────────────┐       ┌───────────────────────────┐
│                           │       │                           │
│      Express Adapter      │       │       Hono Adapter        │ (implements technology)
│                           │       │                           │
└───────────────────────────┘       └───────────────────────────┘
```

A technology adapter implements a contract using a concrete library. It translates external payloads into Comity concepts and maps domain outputs back into technology-specific formats. This keeps your core application completely free of framework-specific vocabulary. Technology becomes what it should be: an implementation detail.

---

## Technology vs. integration adapters

Comity distinguishes between single-technology bindings and broader ecosystem integrations:

- **Technology Adapters:** Focused single-purpose packages that fulfill one core contract (e.g., a SQL adapter wrapping Kysely, or a validation adapter wrapping Zod).
- **Integration Adapters:** Platform-level integrations that coordinate multiple core contracts and services (e.g., a Magento storefront adapter orchestrating routing, HTTP, and catalog domain concepts).

---

## Composition without container coupling

Comity separates **what an application is** from **how an application is assembled**.

The application orchestrates configuration, routing, and business flow. The kernel provides lifecycle hooks, event buses, and service registries. Modules explicitly declare what capabilities they require and what contracts they fulfill.

This avoids a pervasive architectural antipattern:

> **The dependency injection container is a mechanism—not the architecture.**

Composition in Comity relies on explicit module metadata rather than hidden auto-discovery or magic conventions.

---

## Kernel and runtime lifecycle

The kernel executes through an explicit, deterministic state machine:

```text
[ Open ] ──► (Register Services) ──► [ Sealed ] ──► [ Running ] ──► [ Stopped ]

```

1. **Open:** Modules declare dependencies and register services into the container.
2. **Sealed:** The container is locked against further modification; runtime resolution paths are frozen.
3. **Running:** Application lifecycles start and event/hook buses begin processing.
4. **Stopped:** Graceful shutdown routines complete and resources are disposed.

Enforcing explicit state transitions prevents accidental runtime registrations and keeps initialization predictable across all environments.

---

## Result and error semantics

Rather than relying on untyped runtime exceptions, Comity enforces explicit failure semantics across all architectural boundaries:

- **`Result<T, E>`:** A discriminated union representing explicit success or failure branches for fallible operations.
- **`BaseError`:** The foundation for structured domain errors, providing stable error codes, machine-readable metadata, and optional transport hints (such as HTTP status codes).
- **Transport-Safe Serialization:** Domain errors are transport-agnostic, allowing them to be safely serialized, logged, or transmitted across process boundaries without leaking internal implementation details.

For detailed API usage and code examples, see [errors-and-results.md](./errors-and-results.md).

---

## Runtime ecosystem vs. development tooling

Comity maintains a strict physical boundary between application dependencies and build-time governance:

- **`@comity/*`:** The runtime packages installed directly into production applications.
- **`@comity-dev/*`:** Repository tooling used exclusively to build, test, and enforce architectural rules within Comity workspaces.

Governance and architectural verification tooling (`@comity-dev/*`) never leak into production runtimes.

---

## What Comity is not

To keep boundaries clear, Comity intentionally does not attempt to be:

- An all-in-one web framework (like NestJS or Next.js).
- A frontend view library or rendering engine.
- An ORM, query builder, or database migration tool.
- A deployment platform or infrastructure runner.
- A pre-packaged business domain for a specific industry.

Comity supplies the contracts, runtime primitives, and adapter boundaries. Your application retains full ownership of its domain logic, business policies, and technology choices.

---

## Pre-1.0 status

All current Comity packages are active pre-1.0 implementations. While the architectural principles, boundary constraints, and enforcement patterns are stable and intentional, public package APIs are subject to refinement as the ecosystem matures toward 1.0.
