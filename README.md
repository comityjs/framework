# Comity

> **Complex software should be composed from explicit boundaries, not hidden behind frameworks.**

Comity is an open-source architecture and runtime ecosystem built around a simple idea: modern applications are increasingly assembled from frameworks, adapters, libraries, runtimes, APIs, and third-party services. The problem is rarely that any one of these pieces is bad—the problem is what happens **between them**.

Comity makes those boundaries explicit. It provides a set of composable building blocks for creating applications where the domain remains independent, infrastructure stays replaceable, and composition happens deliberately rather than accidentally.

## Why Comity?

Most application architectures eventually accumulate the same technical debt.

A framework starts as an implementation detail and becomes the architecture. An HTTP request object reaches the domain, a database abstraction leaks into business logic, and an adapter starts making architectural decisions.

After enough iterations, the system still works—but nobody can clearly explain where a decision belongs.

Comity takes the opposite approach by making **boundaries first-class**:

- **The core does not know about frameworks**, and the domain does not know about HTTP.
- **Infrastructure does not define business concepts**—adapters translate between worlds instead of becoming those worlds.
- **Composition happens at the edge**, and dependencies point inward deliberately.

The result isn't architecture for architecture's sake. It is software that is easier to understand, test, replace, extend, validate, and keep healthy as the system grows.

## What makes Comity different?

### 1. Architecture is enforced, not documented and forgotten

Most architectural rules eventually become diagrams, conventions, and code-review guidelines.

Comity goes one step further.

Architectural decisions can be expressed as executable constraints and validated automatically during development and CI. Package boundaries, dependency direction, and other architectural rules are treated as part of the engineering toolchain rather than relying exclusively on developer discipline.

**Architecture becomes part of the build.**

### 2. The domain stays independent

At the heart of the system sit the concepts that should survive technological change.

Frameworks, HTTP servers, databases, and frontend technologies can change. The domain should not have to change with them.

Comity's architecture reflects that principle:

```text
   primitives
       ↓
     kernel
       ↓
   composition
       ↓
      core
       ↓
technology adapters
       ↓
integration adapters
```

The exact composition can evolve, but the dependency direction is intentional:

**Infrastructure is replaceable. The core is not infrastructure.**

### 3. Composition is explicit

Comity deliberately separates **what an application is** from **how an application is assembled**.

Services, event buses, hooks, dependency containers, and modules belong to explicit runtime and composition boundaries. They provide mechanisms for assembling an application without turning those mechanisms into the application's domain architecture.

This avoids a common trap:

> **The dependency injection container is a mechanism—not the architecture.**

### 4. Frameworks are adapters

Comity does not attempt to become another application framework dictating how your entire stack must work.

Instead, frameworks sit at the boundary.

A technology-specific adapter translates external concepts into Comity concepts and translates the resulting application output back into the technology's representation.

That means the application does not have to adopt the vocabulary of every framework it integrates with.

**Technology is an implementation detail.**

### 5. Errors are domain objects

Errors are not treated simply as exceptional control flow scattered throughout the application.

Comity models errors as explicit objects with structured information and defined boundaries. This makes them predictable, testable, serializable, and transportable across architectural layers without coupling the domain to a particular transport or runtime.

**Errors are domain objects, not accidental control flow.**

### 6. Runtime capabilities without polluting the core

Capabilities such as module loading, service registration, events, hooks, HTTP, and validation can evolve independently without forcing those concerns into the foundational core.

This keeps the core small, intentional, and focused.

When something does not belong in the core, Comity gives it somewhere else to go.

## Code in practice

The principle is simple: a domain contract should not need to know whether it is being invoked by HTTP, a message queue, a CLI, a test, or something that has not been invented yet.

For example:

```ts
// Domain — no framework, HTTP, or infrastructure dependency
export interface PlaceOrder {
  execute(command: PlaceOrderCommand): Promise<OrderResult>;
}

// Technology adapter — translates an external request into a domain command
export class HttpPlaceOrderHandler {
  constructor(private readonly placeOrder: PlaceOrder) {}

  async handle(request: HttpRequest): Promise<HttpResponse> {
    const command = toPlaceOrderCommand(request);
    const result = await this.placeOrder.execute(command);

    return toHttpResponse(result);
  }
}
```

The important part is not the syntax.

It is the dependency direction:

```text
 HTTP / Framework
         ↓
Technology Adapter
         ↓
   Domain Contract
         ↓
       Domain
```

The domain never needs to know that HTTP exists.

## Architecture as a constraint

Most architectures are diagrams.

Comity tries to make the diagram **executable**.

The intended progression is:

```text
Architecture decision
        ↓
  Package boundary
        ↓
  Dependency rule
        ↓
Automated validation
        ↓
       CI
```

This changes the role of architecture.

It is no longer only something developers are expected to remember. The repository can actively detect when the implementation starts moving away from the architecture.

That is one of Comity's central ideas:

> **If an architectural rule matters, the toolchain should help enforce it.**

## Designed for composition

Comity is an ecosystem of focused packages rather than one monolithic framework.

Applications compose the capabilities they actually need, giving package boundaries explicit architectural meaning.

A simplified view looks like this:

```text
             ┌─────────────────────┐
             │     Application     │
             └──────────┬──────────┘
                        │
              explicit composition
                        │
             ┌──────────▼──────────┐
             │       Runtime       │
             └──────────┬──────────┘
                        │
             ┌──────────▼──────────┐
             │     Comity Core     │
             └──────────┬──────────┘
                        │
             ┌──────────▼──────────┐
             │  Domain Primitives  │
             └─────────────────────┘
```

The exact application composition can change.

The boundaries remain.

## A TypeScript architecture, not a TypeScript convention

TypeScript provides types, but types alone do not create architectural boundaries.

Comity combines TypeScript with package boundaries, explicit dependency rules, and repository-level architectural validation.

The goal is to make architectural direction visible and enforceable:

```text
❌ Forbidden

domain
  ↓
framework


✅ Allowed

framework
  ↓
technology adapter
  ↓
Comity contract
```

This distinction becomes increasingly valuable as a codebase grows.

## One ecosystem, two responsibilities

Comity intentionally separates the runtime ecosystem from the tooling used to develop and govern it.

- **`@comity/*`** — the runtime and architectural packages that applications use as building blocks.
- **`@comity-dev/*`** — development tooling used to build, validate, and maintain Comity itself.

The separation is deliberate.

The tools that enforce the architecture should not accidentally become part of the application architecture they enforce.

## Built for real systems

Comity is designed around problems that appear in long-lived production systems:

- evolving APIs;
- replaceable infrastructure;
- multiple runtimes;
- framework migrations;
- integration boundaries;
- dependency management;
- architectural governance;
- testing and validation;
- and teams working across large codebases.

The goal isn't to produce the smallest possible architecture.

It is to produce an architecture that **keeps making sense after years of change**.

## Philosophy

- **Small cores:** If something does not belong in the core, it stays out.
- **Explicit boundaries:** A boundary should be visible in the code, not only in a diagram.
- **Dependency direction matters:** Not every package should be allowed to depend on every other package.
- **Composition belongs at the edge:** The application decides how capabilities are assembled.
- **Technology is replaceable:** Frameworks and infrastructure do not define the domain.
- **Rules should be enforceable:** Tooling should detect architectural violations before they become somebody else's problem.
- **Complexity should be paid once:** A well-designed boundary may require some initial ceremony, but that cost is far cheaper than rediscovering the same architectural decision throughout the lifetime of a system.

## Getting started

### Using Comity in your application

Install the Comity packages required by your application.

For example:

```bash
pnpm add @comity/primitives
```

Choose additional Comity packages according to the capabilities and integrations your application actually needs.

### Developing or contributing to the monorepo

Comity is managed with `pnpm`.

Clone the repository and run:

```bash
pnpm install
pnpm build
pnpm test
pnpm validate
```

`pnpm validate` runs the repository's architectural and development validation rules.

## Project status

Comity favors **architectural correctness over premature API stability**.

If a boundary is wrong, Comity would rather fix the boundary now than preserve an abstraction simply because it already has users.

The architecture is therefore expected to evolve—but it should evolve deliberately.

## Who is Comity for?

Comity is built for developers and architects working on:

- large TypeScript applications;
- modular backends;
- e-commerce platforms;
- long-lived enterprise systems;
- applications with multiple infrastructure integrations;
- systems expected to survive framework migrations;
- and codebases where architectural governance matters.

If your application is small and unlikely to grow in complexity, Comity may be more architecture than you need.

If it is expected to live for years, evolve continuously, and be maintained by multiple people, explicit boundaries become increasingly valuable.

## The core question

Comity is not trying to answer:

> _"Which framework should I use?"_

It is built to answer a harder question:

> **"How do I build a system where changing the framework doesn't require changing the architecture?"**

That is the problem Comity is built to solve.

## License

See the repository license for the terms under which Comity is distributed.
