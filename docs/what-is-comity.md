## Result and error semantics

Comity models failures through typed `Result` semantics and structured domain errors rather than through ad-hoc thrown strings or generic error objects.

At a high level:

- **`Result`** is a discriminated type for fallible operations, with explicit success and failure branches.
- **`BaseError`** is the foundation for Comity errors, providing stable machine-readable codes, structured metadata, and optional transport hints such as HTTP status.
- Domain errors are meant to be semantic, stable, and transport-agnostic, even when they carry transport hints.

Comity also provides a transport-safe error serialization capability. That capability is real, but transport safety is not automatically true of every error path.

Detailed API examples belong in later documentation.

## Runtime packages vs development tooling

Comity deliberately separates two things that are often collapsed together:

- **`@comity/*`** — the runtime and architectural packages that applications use as building blocks.
- **`@comity-dev/*`** — the development tooling used to build, validate, and maintain Comity itself.

The separation is deliberate. The tools that enforce the architecture should not accidentally become part of the application architecture they enforce.

Application developers consume `@comity/*`. They do not install `@comity-dev/*` into their applications.

## What Comity is not

- It is not a single all-in-one application framework.
- It is not a frontend framework.
- It is not an ORM, a database, or a migration system.
- It is not a deployment platform.
- It is not a complete business-domain model for any specific application.

Comity provides contracts, runtime primitives, and replaceable adapters. The application still owns its business rules, policies, and integration choices.

## Pre-1.0 status

All current Comity runtime packages are pre-1.0.

That does not mean the architecture is accidental or immature. The architecture is intentional and enforced. It does mean the public APIs are still evolving and may change as the project moves toward 1.0.

The correct expectation is:

> The architecture is intentional and mature; the public APIs are still pre-1.0 and may evolve.
# What is Comity?

Comity is an architecture-first TypeScript runtime for building modular applications. It is not primarily a framework that tells you how to structure an entire application. It is a set of packages, contracts, and runtime primitives that make architectural boundaries explicit and replaceable.

When you adopt Comity, you are adopting an approach to software structure in which the domain, the contracts, the composition, and the technology adapters are separate concerns with deliberate dependency direction.

## The central distinction

A conventional framework often provides a single way to build an application. The framework owns the runtime, the request model, the rendering model, and often the composition model. That can be productive, but it also means the framework tends to become the architecture.

Comity takes a different shape:

```text
Application architecture
    ↓
Explicit contracts
    ↓
Explicit composition
    ↓
Replaceable technology adapters
```

In this model, the application decides how to assemble capabilities. The contracts define what those capabilities are. The technology adapters translate external frameworks into Comity concepts.

## Layers and dependency direction

Comity packages are intended to form layers. Dependencies are meant to point inward:

- **Application** — the code that assembles and configures the system.
- **Technology adapters** — the packages that bind Comity contracts to concrete technologies such as Hono, React, Preact, Kysely, Jose, Zod, Commander, CASL, path-to-regexp, and others.
- **Core contracts** — the packages that define HTTP, HTML, routing, authentication, caching, search, SQL, GraphQL, CLI, ACL, i18n, and similar capabilities.
- **Kernel and composition** — the runtime engine, module lifecycle, service registration, event dispatching, hook execution, and module loading.
- **Primitives** — the foundational types and utilities, including `Result`, `BaseError`, the dependency container, event and hook buses, and lifecycle primitives.

The exact set of packages can grow over time. The dependency direction is the architectural commitment.

## Contracts vs implementations

Comity separates **what a capability is** from **how a capability is implemented**.

A core module defines a contract. For example, the HTTP package defines request and response types, handler semantics, middleware semantics, and context. The HTML package defines a renderer contract and document model. The router package defines route and URL rewriting contracts.

A technology adapter implements one of those contracts in terms of a concrete technology. The adapter translates external concepts into Comity concepts and translates the resulting output back into the technology's representation.

That means the domain and the application do not have to adopt the vocabulary of every framework they integrate with. Technology is an implementation detail.

## Technology adapters

A technology adapter binds a Comity core contract to one interchangeable technology. In the current Comity ecosystem, adapters exist for HTTP servers, HTML rendering, hydration, SQL execution, token handling, validation, routing, GraphQL transports, caching, CLI execution, and authorization.

Each technology adapter declares which core module it implements. That declaration is part of how Comity keeps the adapter model honest.

## Integration adapters

Some integrations are broader than a single technology adapter. An integration adapter represents a platform or ecosystem integration and may depend on multiple Comity core modules.

One example in the current repository is the Magento storefront integration adapter. It is an example of a broader platform integration, not a single-technology adapter.

## Composition

Comity deliberately separates **what an application is** from **how an application is assembled**.

The application owns configuration, routing, middleware, and orchestration. The kernel provides lifecycle, service registration, events, hooks, and module loading. The modules declare what they need and what they provide.

This avoids a common trap:

> **The dependency injection container is a mechanism—not the architecture.**

Composition in Comity happens through explicit module metadata, not through hidden conventions or magical auto-discovery.

## Kernel and runtime lifecycle

The kernel has explicit lifecycle states: open, sealed, running, and stopped. Services can be registered before the kernel is sealed. After sealing, the system is closed to further registration and moves into the running state.

This makes the runtime model visible. A module does not silently assume it can register services at any time. The lifecycle is part of the contract.
