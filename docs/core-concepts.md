# Core concepts

Comity is built from a small set of ideas that repeat across the runtime, the packages, and the application development experience.

If you understand these concepts, the architecture becomes much easier to reason about.

- [Foundation](#foundation)
  - [Architecture as explicit boundaries](#architecture-as-explicit-boundaries)
  - [Layers and dependency direction](#layers-and-dependency-direction)
  - [Contracts vs implementations](#contracts-vs-implementations)
  - [Technology adapters](#technology-adapters)
  - [Integration adapters](#integration-adapters)
  - [Composition at the edge](#composition-at-the-edge)
- [Runtime](#runtime)
  - [Kernel lifecycle](#kernel-lifecycle)
  - [Module metadata](#module-metadata)
- [Application semantics](#application-semantics)
  - [Result](#result)
  - [Errors as domain objects](#errors-as-domain-objects)
  - [HTML rendering boundary](#html-rendering-boundary)
  - [Replaceable hydration](#replaceable-hydration)
- [Governance](#governance)
  - [Architecture enforcement](#architecture-enforcement)
  - [Runtime vs development tooling](#runtime-vs-development-tooling)

