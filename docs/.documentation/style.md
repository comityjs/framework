# Editorial contract for Comity public documentation

Derived from the existing public documents (`docs/index.md`,
`docs/what-is-comity.md`, `docs/why-comity.md`, `docs/core-concepts.md`,
`docs/architecture.md`, `docs/errors-and-results.md`, `docs/getting-started.md`).
This file constrains how documents are written; `AGENT.md` (section 2)
defines what verification checks. It does not retroactively rewrite existing
ones: when an existing document enters its verification cycle, the current
rules in this file and `terminology.yaml` are checked, but only necessary
corrections are made — existing documents are not rewritten merely because
this protocol was created.

## Voice

- Technical and precise. Name exact packages, symbols, and states; avoid
  hand-waving ("simply", "just", "magically").
- Confident but not exaggerated. State what the architecture enforces; admit
  what it does not (see Claims).
- Developer-oriented. Address the reader building or evaluating a system.
- Restrained marketing. Prefer verifiable statements over superlatives. Never
  claim Comity eliminates design effort, guarantees correctness, or outperforms
  alternatives without cited evidence.

## Structure

Observed conventions (follow them):

- `# Title` as H1, then a short thesis paragraph, then `---` separators
  between major sections.
- `##` sections in a deliberate order: mental model first, mechanism second,
  usage last.
- Concept before package. Explain the idea (boundaries, composition, typed
  failure) before naming the package that implements it.
- Explanation before reference. Prose first; signatures, tables, and links
  support the prose, never replace it.
- Progressive complexity. Fundamentals (`what-is`, `why`) assume nothing;
  guides assume the mental model; hands-on guides assume the guides.
- Practical examples after mental models. Every abstract claim (e.g. "adapters
  are replaceable") is followed by a concrete boundary or code sketch.
- ASCII `text` diagrams for architecture and lifecycles; tables for package
  inventories and concept definitions; `ts`/`bash` fenced blocks for code.
- End hands-on documents with explicit next steps linking to the following
  document in the manifest chain.

## Language

- Short paragraphs: one idea each, typically 1–4 sentences.
- Active voice: "the application composes modules", not "modules are composed".
- Concrete terminology from `terminology.yaml`. Use the canonical
  capitalization on every occurrence. Mechanical terminology rules always
  apply; contextual avoid-forms apply only where the text uses the avoided
  meaning (see `terminology.yaml`).
- Cross-document references use relative links (`./errors-and-results.md`).
- Avoid unnecessary repetition: if another public document owns an
  explanation, link to it in one sentence instead of restating it.
- Call out the reader's frame explicitly when contrasting: "Comity does not
  ask X. It answers Y." (established pattern in `why-comity.md`).

## Claims

Require repository evidence before writing:

- Architectural claims (layering, dependency direction, lifecycle order) —
  cite the implementation, package metadata, or governance docs
  (`docs/architecture/repository.md`, `AGENTS.md`).
- API claims (names, signatures, subpaths) — cite the `exports` map and source.
- Guarantees ("enforces", "prevents", "ensures") — allowed only for what
  validation tooling or the runtime mechanically does; qualify the limits
  (e.g. "validation enforces declared rules; it does not judge design quality").
- Performance, security, compatibility, multi-runtime claims — forbidden
  without measured or documented evidence.

Disallow unconditionally:

- Invented APIs, packages, commands, or guarantees.
- Permanence language for pre-1.0 surfaces ("will never change", "frozen").
- Presenting `drafts/`, migration history, or internal modules as current API.

## Examples

- Import only from verified public subpaths (see `AGENT.md` §7). The currently
  attested import families in public docs are `@comity/primitives/result`,
  `@comity/primitives/errors`, `@comity/primitives/di`,
  `@comity/primitives/lifecycle`, `@comity/composition`,
  `@comity/composition/setup`, `@comity/kernel`, `@comity/http/*`.
  `@comity/http-hono` is mentioned in prose and diagrams but not imported
  anywhere yet; treat imported API, mentioned package, and conceptual
  reference as distinct attestation levels.
- Prefer `ts` blocks with real imports and `Result`-based handling
  (`isSuccess`/`isFailure` narrowing) over bare `throw`/`try-catch` sketches.
- Mark non-executable sketches honestly: `text` fence or an explicit
  "pseudocode" label. Never put pseudocode in a `ts` block; `AGENT.md`
  section 8 defines the verification levels executable examples must pass.
- Pair each significant example with its failure branch where the API is
  fallible; Comity readers expect typed failure to be visible.

## Maturity

Comity is pre-1.0 (`0.9.0` for all runtime packages at protocol creation).

- Describe current behavior precisely ("as of `0.9.0` …").
- State explicitly that public API surfaces are subject to refinement before
  1.0, while architectural intent (inward dependencies, contracts-vs-adapters,
  `Result`/error semantics, `@comity/*` vs `@comity-dev/*` split) is stable.
- The `errors-and-results.md` pattern is canonical: close API-heavy documents
  with a `> **Pre-1.0 note**` blockquote stating what is stable intent vs.
  refinable surface.
