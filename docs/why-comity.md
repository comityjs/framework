# Why Comity?

TypeScript already boasts an extensive ecosystem of frameworks, libraries, and runtimes. Comity exists because the primary challenge in software engineering is rarely choosing an individual piece—it is managing what happens **between** the pieces over time.

---

## The problem Comity addresses

Most long-lived applications follow a familiar trajectory:

```text
[ Small Application ] ──► (Implicit Boundaries) ──► [ Framework Leakage ] ──► [ Architectural Lock-in ]
```

1. **Clean Start:** An application begins with a lean, understandable codebase.
2. **Implicit Rules:** Boundaries exist, but only as team conventions or documentation.
3. **Framework Expansion:** A framework starts as an implementation detail and slowly becomes the default architecture.
4. **Leakage:** Request objects, database ORM abstractions, or view-rendering models reach deep into domain logic.
5. **Coupling:** Infrastructure begins dictating business rules, making individual pieces impossible to isolate, test, or replace.

This path represents the natural accumulation of **architectural drift**. Conventional frameworks excel at getting projects off the ground, but they rarely enforce explicit boundaries between their own concerns and the application's core domain.

---

## Architectural drift & hidden coupling

Architectural drift occurs when the system architecture described in documentation slowly diverges from the reality in the codebase. A boundary meant to isolate business logic may still exist on a diagram, yet disappear from the dependency graph as developers import infrastructure utilities directly into domain services.

```text
❌ Unintended Coupling (Drift)
Domain Services ──► HTTP Request / ORM Models / Framework Utilities

✅ Explicit Direction (Comity)
Framework / Infrastructure ──► Technology Adapter ──► Domain Contract ──► Domain Core

```

When a domain module acquires hidden dependencies on HTTP contexts, database drivers, or rendering engines, it loses its independence. The coupling is often discovered too late: when attempting to reuse a domain concept in a background worker, a CLI command, or a new transport layer, only to find it cannot be extracted from its surrounding infrastructure.

---

## Explicit composition over framework magic

Many systems rely on framework conventions—such as global auto-discovery, magic decorators, or hidden lifecycles—to wire dependencies together. While convenient initially, implicit composition obscures what the system is assembling, when it is being initialized, and what dependencies are truly required.

Comity favors **explicit composition**. The application explicitly orchestrates its capabilities, modules explicitly declare what they require and export, and the runtime executes that assembly through a deterministic, step-by-step lifecycle.

> **The dependency injection container is a mechanism—not the architecture.**

---

## Replacing technology without rewriting architecture

A well-chosen framework is a valuable tool; a framework that has become the architecture is a long-term liability.

Comity is designed for systems where technology choices remain replaceable without rewriting core domain logic. While applications rarely swap frameworks on a whim, the cost of framework lock-in is paid continuously in subtle ways: difficult upgrades, restricted runtime choices, and complex testing setups.

When contracts are explicit and adapters are replaceable, frameworks return to their proper role: **implementation details at the edge**.

---

## Architecture as an executable constraint

Most architectures start as strong team decisions and eventually degrade into code-review guidelines. Comity takes the position that architecture must not rely on developer discipline alone.

If an architectural boundary matters, the toolchain should actively enforce it:

```text
Architecture Decision
         ↓
  Package Boundary
         ↓
  Dependency Rule
         ↓
Automated Validation
         ↓
   CI Pipeline
```

This transforms architectural intent from a passive memory exercise into an **executable build constraint**. The repository toolchain detects violations early, preventing architectural drift before code reaches production.

---

## What Comity is responding to

Comity is built specifically for systems where these operational realities matter:

- Long-term API evolution and framework migrations.
- Multi-runtime deployments (Node.js, Edge, Serverless, Bun).
- Strict integration boundaries and dependency isolation.
- Architectural governance across large engineering teams.

For small, short-lived applications, Comity may introduce more structure than necessary. However, for software expected to operate for years, evolve continuously, and survive technological shifts, explicit boundaries are invaluable.

---

## The central question

Comity does not ask:

> _"Which framework should I use?"_

It is built to answer a harder, more fundamental question:

> **"How do I build a system where changing the framework does not require changing the architecture?"**

---

## What Comity does not claim

Comity does not guarantee perfect code or eliminate architectural mistakes by magic. It cannot replace thoughtful domain design or engineering discipline.

What Comity provides is a deterministic set of contracts, runtime primitives, and enforcement mechanisms that make architectural direction explicit, visible, and structurally enforceable.

---

## Next steps

To see how these principles are realized in the runtime model and package structure, continue to [What is Comity?](./what-is-comity.md).
