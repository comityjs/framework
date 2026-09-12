## What Comity does not claim

Comity does not claim to eliminate architectural problems automatically. It does not guarantee perfect architecture without developer discipline. It does not make unwanted imports impossible by magic.

What it does provide is a set of explicit structures, contracts, and validation mechanisms that make architectural direction visible and enforceable.

## Where this leads

If this framing makes sense to you, the next questions are usually:

- What does the mental model actually look like?
- What are the contracts, adapters, and runtime pieces?
- How do you start using it?

Those are covered in the next pages.

# Why Comity?

TypeScript already has many frameworks, libraries, and runtimes. Comity exists because the hard part is rarely choosing a piece. It is what happens between the pieces.

## The problem Comity addresses

Consider a common path that many applications follow:

1. An application starts small and usable.
2. Boundaries exist, but only as conventions.
3. A framework starts as an implementation detail.
4. A request object, a database abstraction, or a rendering concept reaches further into the system than intended.
5. Infrastructure starts making architectural decisions.
6. Replacing a piece becomes harder than it should be, because the pieces are no longer separable.

None of this is exotic. It is the ordinary accumulation of architectural drift.

The issue is not that frameworks are bad. The issue is that conventional frameworks do not usually make the boundaries between their own concerns and the application's concerns explicit enough to keep them separable over time.

## Architectural drift

Architectural drift happens when the architecture described in diagrams and the architecture actually enforced by code slowly diverge.

A boundary that was intended to exist may still exist in documentation, but not in the dependency graph. A concept that was meant to stay in the domain may start appearing in HTTP handlers, persistence layers, or rendering code. The system still works. It just becomes harder to explain where a decision belongs.

Comity is built around the idea that if a boundary matters, it should be visible in the code and not only in a diagram.

## Hidden dependencies

A domain module may gradually acquire dependencies on things it should not know about: HTTP, framework APIs, persistence, rendering, or infrastructure.

Once that happens, the domain is no longer independent. It becomes tied to a particular runtime, a particular transport, or a particular framework. That coupling is often discovered too late, when someone tries to reuse a domain concept in a different context and finds that it cannot be separated from the infrastructure around it.

Comity addresses this by making the dependency direction a structural concern, not a convention.

## Framework coupling

Framework coupling is what happens when technology choices become embedded in application logic instead of being isolated behind explicit boundaries.

If the domain knows about HTTP, the domain is tied to HTTP. If the domain knows about a particular database abstraction, the domain is tied to that abstraction. If the rendering model leaks into the domain, then changing the rendering model becomes a domain change.

Comity's response is to keep frameworks at the boundary. Technology adapters translate between external frameworks and Comity contracts. The domain and the core contracts do not adopt the vocabulary of every framework they integrate with.

## Implicit composition

In many systems, modules and dependencies exist because framework conventions make them exist. Auto-discovery, hidden lifecycles, and framework-managed wiring can all make composition feel automatic.

That can be convenient, but it also means the composition is implicit. When composition is implicit, it is harder to reason about what the system is actually assembling, when it is assembling it, and what it depends on.

Comity prefers explicit composition. The application decides how capabilities are assembled. Modules declare what they need and what they provide. The runtime executes that assembly through an explicit lifecycle.

This avoids a common trap:

> **The dependency injection container is a mechanism—not the architecture.**

## Technology choices become difficult to replace

A well-chosen framework can be a good decision. A framework that has become the architecture can be a difficult one to undo.

Comity is designed for systems where technology choices should be replaceable without rewriting the application's core reasoning. That is not because every application will change frameworks often. It is because the cost of being locked into a framework is usually paid later, when the framework is no longer the best fit and the architecture has no clean place to cut it out.

When contracts are explicit and adapters are replaceable, the technology becomes an implementation detail.
