# Comity

> **Complex software should be composed from explicit boundaries, not hidden behind frameworks.**

Comity is an architecture-first TypeScript runtime for building modular applications whose boundaries, dependencies, contracts, and composition are explicit and enforceable.

Most application frameworks help you build software quickly. Comity helps you build software whose architecture remains understandable and replaceable as the system grows.

## The problem

Applications rarely fail because a framework is bad. They fail because of what happens **between** the pieces: a framework becomes the architecture, an HTTP request object reaches the domain, a database abstraction leaks into business logic, and a boundary that was once deliberate becomes accidental.

Comity takes the opposite approach. It makes **boundaries first-class** so that the domain does not know about HTTP, infrastructure does not define business concepts, and composition happens deliberately rather than by convention.

## The idea

Comity is built around a simple thesis:

- **The core does not know about frameworks.**
- **Infrastructure does not define business concepts.**
- **Composition happens at the edge.**
- **Dependency direction is intentional and visible.**

The result is not architecture for architecture's sake. It is software that is easier to understand, test, replace, extend, validate, and keep healthy over time.

## Architecture at a glance

Comity is organized as an ecosystem of focused packages rather than one monolithic framework. Dependencies are intended to flow toward the center:

```text
     application
          ↓
 technology adapters
          ↓
    core contracts
          ↓
 kernel / composition
          ↓
      primitives
```

The exact shape of an application can change. The dependency direction is the point.

## What Comity gives you

- **Explicit contracts** for HTTP, HTML, routing, authentication, caching, search, SQL, and more.
- **Replaceable technology adapters** that translate between external frameworks and Comity contracts.
- **An explicit runtime model** with a kernel, module lifecycle, and declarative composition.
- **Typed failure semantics** through `Result` and structured domain errors.
- **Architecture that is validated automatically** as part of the development and CI workflow.
- **A deliberate split** between runtime packages (`@comity/*`) and development tooling (`@comity-dev/*`).

## Documentation

The documentation is structured around four paths, depending on whether you are evaluating the architecture, designing a system, or implementing code.

### 1. Fundamentals

Understand the mental model, philosophy, and the problems Comity is designed to solve.

- [What is Comity?](./what-is-comity.md) — The core thesis and mental model.
- [Why Comity?](./why-comity.md) — The architectural debt Comity prevents.

### 2. Architectural Guides

Learn how boundaries, contracts, and dependency flow are structured in practice.

### 3. Packages & Ecosystem

Explore the focused packages that form the Comity ecosystem.

#### Runtime (`@comity/*`)

- `@comity/primitives` — Core types, domain errors, and `Result` structures.
- `@comity/kernel` — Application lifecycles, module registration, and composition.

#### Development Tooling (`@comity-dev/*`)

### 4. Hands-on

Build your first system or contribute to the ecosystem.
