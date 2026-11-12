# Primitives Overview

`@comity/primitives` defines the semantic foundation of the Comity ecosystem.

It is not a shared utilities package.
It is a collection of stable concepts that multiple modules depend on.

---

## Intent

The goal of this package is to:

- Avoid duplication of core concepts
- Ensure consistent semantics across packages
- Provide stable contracts that rarely change

Primitives should feel boring, predictable, and obvious.

---

## When to add something here

A concept MAY be added to `@comity/primitives` only if all of the following
are true:

- It is required by multiple packages
- It has a clear, stable definition
- It is framework-agnostic
- It does not depend on runtime or environment
- It can be explained without examples

If a concept is still evolving, it is not a primitive.

---

## When NOT to add something

Do NOT add a concept if:

- It solves a local or temporary problem
- It introduces behavior, policy, or orchestration
- It depends on lifecycle management or side effects
- It primarily exists for convenience

In those cases, the concept belongs in a higher-level package.

---

## Design principle

If an API needs explanation beyond its concept,
it is not a primitive.

## Repository conformance kit (`@comity/primitives/testing`)

The `./testing` subpath exports `runVersionedRepositoryTests`, `ConformanceError` and the adapter interfaces of the
shared ADR-029 conformance suite. It is framework-agnostic and depends on no SQL or Order code; the consumer supplies a
test-framework adapter. Every adapter claiming support for versioned repository concurrency runs it (mandatory cases
TC-1, TC-1c, TC-2a, TC-2b, TC-2c, TC-3, TC-4, TC-5; TC-6 only when multi-record atomicity is declared; an undeclared TC-6
is reported `unsupported` in the returned `ConformanceReport`, registered through the optional `skip` of the framework
adapter when it has one, and never as an empty passing test). The cases,
fixture lifecycle and evidence reporting are defined in `docs/standards/repository-conformance.md` of the development
repository; the signatures in `src/testing/types.ts` are authoritative.
