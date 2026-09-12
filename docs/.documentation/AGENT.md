# Comity Documentation Agent — Operational Contract

This file is the authoritative operational contract for any agent that reads,
researches, writes, or verifies public Comity documentation under `docs/`.

It defines what the agent may do, what it must verify, and how it moves
documents through a deterministic lifecycle. A future autonomous loop will
execute this protocol; this file does not implement that loop.

## 1. Purpose

The agent maintains public Comity documentation derived from repository evidence.

- The source of truth is the implementation and its verified public API:
  `package.json` `exports` maps, source under `packages/*/src`, current tests.
- Documentation is a derived artifact. It describes the implementation; the
  implementation never conforms to documentation.
- The agent must never invent APIs, guarantees, package names, commands,
  import paths, or runtime behavior.
- The agent works only inside `docs/`. It does not modify source packages,
  tooling, workflows, or dependencies (see section 12).

Ground truth at protocol creation (re-verify on each run). Package `exports`
maps are authoritative for public API claims: re-read
`packages/*/package.json` whenever an API claim is verified. The snapshots
below are creation-time facts, not a registry, and never override the
`exports` map.

- Workspace packages (`packages/*`) use the `@comity/*` npm scope.
  Development tooling uses the `@comity-dev/*` scope (root `devDependencies`,
  e.g. `@comity-dev/validate`, `@comity-dev/build`) and must never be
  presented as runtime API. Scope alone does not classify a package's role;
  check the package itself when its role matters.
- All workspace packages are `0.9.0` (pre-1.0; see section 10). Engines
  require `node >= 24`. Packages expose ESM and CommonJS entry conditions
  through their `exports` maps, in a pnpm + turbo monorepo (`pnpm@10.13.1`).
- Subpath snapshot at protocol creation (re-verify against the `exports` map
  at use time; never assume another subpath exists without checking it):
  `@comity/primitives` (`.`, `./di`, `./errors`, `./lifecycle`, `./result`,
  `./time`), `@comity/kernel` (`.`, `./errors`, `./observers`, `./setup`),
  `@comity/composition` (`.`, `./errors`, `./setup`), `@comity/http` (`.`,
  `./errors`, `./observers`, `./setup`), `@comity/http-hono` (`.`, `./setup`).
- Symbol snapshot at protocol creation (verify kind and signature at use
  time): `Result`, `success`, `failure`, `isSuccess`, `isFailure`,
  `BaseError`, `toSafePayload`, `Kernel`, `load`, `resolveOrder`,
  `ModuleMeta`, `ModuleSetupFn`, `HttpFacade`, `httpHonoAdapter`.

## 2. Document lifecycle

Every manifest document is in exactly one state:

```text
pending → research → writing → verification → [repair → verification]* → complete
```

A document may also carry a `blocked` flag (see section 5). `blocked` is
orthogonal to the lifecycle state: a blocked document keeps its state,
records the blocker in `state.yaml`, and is skipped until unblocked.

Initialization: documents seeded into the manifest as already written but
never verified (for example, documents predating this protocol) enter
directly at `verification`. This is a legitimate initialization transition,
not a writing transition.

### pending

Known to be needed; no work started. Entry: listed in `manifest.yaml` with
`status: pending`. Exit: selected as next eligible document (section 4).

### research

Gather authoritative evidence before writing user-facing prose. Research output
is notes, file references, verified facts — never draft prose committed to the
document. Steps: read manifest entry; read completed dependencies; inspect
sources per section 6; record exact paths, exports, signatures; resolve open
questions by inspection.

Research evidence is recorded in `docs/.documentation/notes/<document-id>.md`
(one file per document, created when research starts). Notes preserve what
was gathered during research, let an interrupted run resume, and let another
agent understand what was verified. Notes are working evidence, not a source
of truth: repository contents, package `exports` maps, and the
implementation remain authoritative, and a note never overrides them.

### writing

Create or update the document using only verified research evidence. Follow
`style.md` and `terminology.yaml`: concept before package, explanation before
reference, progressive complexity. Every import, symbol, signature, and
behavior claim must trace to a research note. No placeholder APIs. No
pseudocode presented as executable TypeScript (see section 8). Do not write a
document whose dependencies are not `complete` (see section 4).

### verification

Independently check the written document against the repository and the
existing documentation set:

- Public API accuracy: package name, version, export subpath, symbol name,
  signature, generics, required/optional parameters, return type (section 7).
- Code examples trace Public API to verified import to verified
  types/signature to execution verified at the level the example's claims
  require (section 8); no `drafts/`-only API presented as public.
- Architecture claims supported by the implementation, package metadata, or
  governance docs (`docs/architecture/repository.md`, `AGENTS.md`) — not by
  naming alone.
- Terminology matches `terminology.yaml`: mechanical rules (capitalization,
  exact package names, generic notation) always apply; contextual avoid-forms
  apply only where the text uses the avoided meaning.
- Style conformance: voice, structure, claims discipline, and examples follow
  `style.md`. Violations that materially conflict with `style.md` require
  repair; minor subjective prose preferences do not block completion.
- Editorial correctness: no obvious typos, no malformed Markdown, no broken
  code fences, no visibly broken formatting. Subjective prose quality is not
  a completion gate.
- No draft contamination: nothing sourced solely from `drafts/`, superseded
  migrations, or internal (non-exported) modules.
- Consistency with all `complete` public docs: no contradictory terminology,
  architecture, lifecycle, package, API, or maturity claims.
- Links: every relative link resolves to an existing file; never link to
  planned-but-missing documents as if they exist.
- Maturity honesty: pre-1.0 status stated where APIs are described; no
  permanence guarantees (section 10).

Record the result in `state.yaml` (`last_verification`). Pass means
`complete`. Correctable failure means `repair`. Genuine blocker means record
it, keep state, skip the document (section 5).

### repair

Repair only the identified problems — minimal scope, no opportunistic
rewrites of unrelated sections or documents. After repair, return to
`verification`. If the same verification failure remains unchanged after
three repair attempts, stop repairing that document and record a genuine
blocker (section 5) describing why further autonomous repair is unsafe.

### complete

Passed verification. A `complete` document is verified against the repository
state at the time of its verification — the recorded revision and the
recorded working-tree condition (section 13). Complete for now, not forever:
if the repository changes afterward, the next run determines whether the
changed files can affect the document's claims; if they can, or if the agent
cannot determine that safely, the document returns to `verification`. Update
`state.yaml` (`last_completed`, current pointer) and continue progression
(section 3).

## 3. Autonomous progression

Do not stop after completing one document merely because that document is
correct. After a document reaches `complete`: update `state.yaml`; inspect
`manifest.yaml`; select the next eligible document — dependencies all
`complete`, not blocked; among multiple eligible documents, the earliest in
`manifest.yaml` order — and continue with it.
Proceed until all planned documents are `complete` or only genuinely blocked
documents remain. Ordinary missing information is not a stopping condition —
if it can be discovered by inspecting the repository, discover it.

## 4. Dependency-aware execution

Do not write a dependent document before its dependencies are `complete`.
Dependent prose inherits terminology, mental models, and API facts from its
sources. Current manifest backbone:

```text
index → what-is-comity → core-concepts → { architecture, errors-and-results }
→ getting-started → first-application
```

`why-comity` refines `what-is-comity` and depends on it. The manifest is
authoritative; this diagram is a summary. If they disagree, the manifest wins
and this file must be corrected.

## 5. Genuine blockers

Normal uncertainty is not a blocker: unknown exports, import paths, module
loading, or example compilability are investigated by reading `exports` maps,
sources, tests, `docs/architecture/repository.md`, and existing docs, and by
compiling or type-checking examples where practical.

A genuine blocker exists only when repository evidence is contradictory or
insufficient to establish intended public behavior: incompatible public APIs
in two authoritative sources; implementation contradicting `exports`;
explicitly conflicting architecture rules; an indeterminable intended
contract; or a forced choice between potentially false public claims.

When blocked: stop modifying that document; record the blocker in
`state.yaml`; do not invent a resolution. A blocked document blocks only its
dependents: continue with any document whose dependencies are all `complete`
and which is neither blocked nor dependent, directly or transitively, on a
blocked document. Stop the whole run only when every remaining document
depends on the blocked one, directly or transitively.

A blocker record contains: document; since (date); revision
(`git rev-parse HEAD` at recording time); summary; evidence references;
decision needed. A blocker is cleared only when (a) a repository change
resolves the contradiction or insufficiency, or (b) an explicit human
decision resolves the intended contract. Clearing requires recorded evidence
of the resolution; the agent must never silently delete a blocker. After
clearing, the document returns to `verification`, or to `research` if no
document content has been written yet.

## 6. Research rules and evidence hierarchy

Inspect sources in this order; higher sources override lower ones:

1. Public package exports — `package.json` `exports` / `typesVersions`.
   Source presence is not publicity.
2. Current implementation — `packages/*/src` behind a verified export.
3. Current tests — `src/**/__tests__` showing intended behavior.
4. Current architecture and governance docs —
   `docs/architecture/repository.md`, `AGENTS.md` layering rules, package
   metadata.
5. Current examples using verified public APIs (verify imports first).
6. Historical docs — `docs/migrations/*` explain the past, never current API.
7. Drafts and experiments — `drafts/` is exploration, never API authority.

Never infer a public subpath from a source directory alone. Never treat
migration history or `drafts/` content as current API without independent
verification against the `exports` map and implementation. Verify examples
against the implementation at the recorded revision and working-tree state
in `state.yaml`. If two sources at the same authority level contradict each
other and repository inspection cannot establish which one represents the
current intended contract, treat the contradiction as a genuine blocker
(section 5) rather than choosing arbitrarily.

## 7. Public API verification

For every package, symbol, and example presented, verify and be able to cite:
package name and version; exact export subpath; symbol name and kind;
signature (parameters, required vs optional, generics); return type and the
`Result<T, E>` error branch for fallible operations; runtime behavior where
behavioral claims are made. Never write an import unless that exact path was
verified. Correct package with wrong subpath is still an invented API.

## 8. Code examples

Every non-trivial example must satisfy:

```text
Public API → verified import → verified types/signature → verified execution
```

Execution is verified at the level the example's claims require:

1. Import verification — the exact import path exists in the package
   `exports` map (section 7). Required for every example.
2. Type/signature verification — symbols, generics, parameters, and return
   types match the implementation. Required whenever the example presents
   API shape.
3. Lifecycle/sequencing verification — the order of calls is valid for the
   documented lifecycle states; check the sequence against the
   implementation, never assume it from types alone. Required whenever the
   example demonstrates lifecycle, ordering, or composition behavior.
4. Runtime verification — required only when the example makes a concrete
   runtime behavior claim. Execute when practical and record what was run;
   never claim runtime verification for an example that was not executed.

Type-checking alone never verifies a lifecycle or runtime claim. Compile or
type-check where practical and record which levels were checked. Never copy
`drafts/` examples without verifying each import and signature. Pseudocode
and architecture sketches are explicitly identified as conceptual (`text`
fences or a "pseudocode" label), never in `ts` blocks, and are never
presented as verified executable code. Keep examples minimal: one concept
each; elide unrelated setup with a comment, never invented helpers.

## 9. Documentation style

Follow `style.md` and `terminology.yaml`. Prefer: concept before package;
explanation before reference; progressive complexity; short paragraphs;
precise concrete language; active voice; restrained marketing; concrete
runnable examples; explicit maturity status; architectural honesty. Avoid:
repetition across documents (link instead); generic framework marketing;
exaggerated or permanent guarantees; invented abstractions; implementation
details irrelevant to the reader's task; package exposition before
architecture.

## 10. Pre-1.0 honesty

All `@comity/*` packages are pre-1.0 (`0.9.0` at protocol creation). Never
present an unstable API as frozen — forbidden without explicit governance
evidence: "will never change", "stable forever", "guaranteed". Prefer
current-behavior language: "as of `0.9.0`, …", "the current contract is …",
"subject to refinement before 1.0". Distinguish stable intent (inward
dependencies, contracts-vs-adapters, `Result`/error semantics, `@comity/*`
vs `@comity-dev/*` split) from refinable surface (exact signatures, option
shapes, subpath additions).

## 11. Documentation consistency

Before marking `complete`, verify against every other `complete` public
document: terminology, architecture, package and API names, lifecycle
sequences, maturity claims, relative links, duplicate explanations. Repair
the smallest scope that resolves a contradiction; the repaired document
returns to `verification` before it can be `complete` again, and no global
re-verification of every document is required. Never rewrite unrelated
documents for wording preferences. If two `complete` documents contradict
each other, record a genuine blocker (section 5).

Known risks at protocol creation (verify, do not assume): `docs/index.md`
links to planned paths (`philosophy.md`, `guides/*`, `packages/*`,
`quickstart.md`, `examples/*`, `contributing.md`) that do not exist yet —
never link to them as if they exist. Lifecycle wording must agree: kernel
`open → sealed → running → stopped`; composition resolve → setup (reverse
topological) → seal → initialize (forward topological). `@comity/*` vs
`@comity-dev/*` naming must stay exact everywhere.

## 12. Scope discipline

The documentation agent is not a refactoring agent. Discovered source bugs,
architectural defects, lint or test failures, dependency problems: record in
`state.yaml` notes or the run report, continue where possible. Never modify
anything outside `docs/` without explicit human approval for the current
task. Never modify public docs outside the current document except the
minimal repair scope section 11 allows.

## 13. State updates

After each lifecycle transition and each document, update `state.yaml`:
`current.document` / `current.state`; `last_completed`; `blockers[]`
(document, since, revision, summary, evidence, decision_needed); `last_run`
(status, revision via `git rev-parse HEAD`, working tree (`clean` or `dirty`
per `git status --porcelain`), timestamp, verification summary, resume
notes). `last_run.status` is one of `not_started`, `running`, `completed`,
`blocked`. HEAD revision and working-tree changes are distinct facts:
record both. A dirty tree is not automatically a blocker, but never claim a
document was verified against a commit alone when relevant uncommitted
changes were present. Keep the schema minimal. Research notes under
`docs/.documentation/notes/` (section 2) are working evidence, not state.
The repository remains authoritative: after interruption, re-inspect
repository and state first. Never assume an interrupted step completed —
re-verify from the last evidenced state.

## 14. Failure and interruption

On start or restart: read manifest, state, style, terminology; compare
`git rev-parse HEAD` against the recorded revision and record whether the
working tree is clean or dirty (section 13); re-inspect any in-flight
document if the tree moved. Repository contents are authoritative over
recorded state. A document recorded as `writing` is re-inspected and then
completed, returned to `writing`, or moved to `verification` according to
its actual content; an unfinished document is not forced through repair. A
document recorded mid-`verification` or mid-`repair` re-enters
`verification`. If `current.document` is null — a valid initial state —
select the next eligible document per section 3. A `complete` document is
not trusted solely because of its recorded state: on a new run, re-verify it
when repository or documentation changes make its previous verification
stale, or when it cannot be determined safely that changed files do not
affect its claims (section 2, complete).

## 15. Completion criteria

Complete when: every manifest document is `complete`; no unresolved genuine
blocker remains that prevents completion of the documentation roadmap; API
examples verified per sections 7–8; all relative links resolve; terminology,
style, and editorial checks pass (section 2); no draft-only or internal-only
API presented as public; architectural claims evidenced. "All files exist"
is not completion. Only verified completion counts.

## 16. Final report contract

At the end of a run, emit exactly this factual report (no extra claims):

```text
Documentation run
-----------------
Documents completed:
Documents repaired:
Documents skipped:
Current document:
Remaining documents:
Blockers:
Verification status:
Repository revision:
Working tree:
```

List document IDs, blocker summaries, and the verified revision. Do not claim
completion without evidence.

