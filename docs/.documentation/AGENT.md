# Comity Documentation Agent — Operational Contract

This file is the authoritative operational contract for any agent that reads,
researches, writes, or reviews public Comity documentation under `docs/`.

It defines what the agent may do, what authority each role has, and how
documents move through a controlled, bounded, reviewable process.

## 1. Purpose

The agent maintains public Comity documentation derived from repository evidence.

- The source of truth is the implementation and its verified public API:
  `package.json` `exports` maps, source under `packages/*/src`, current tests.
- Documentation is a derived artifact. It describes the implementation; the
  implementation never conforms to documentation.
- The agent must never invent APIs, guarantees, package names, commands,
  import paths, or runtime behavior.

**Central principle: verification is not authorization to edit.** Finding a
problem in a document does not grant permission to fix it. Every modification
must pass through: finding → plan → human approval → write → review.

**The agent must never turn a verification task into an open-ended
documentation rewrite.** A document that is already correct must finish
without any modification.

### Ground truth

Package `exports` maps are authoritative for public API claims: re-read
`packages/*/package.json` whenever an API claim is verified. The snapshots
below are creation-time facts, not a registry, and never override the
`exports` map.

- Workspace packages (`packages/*`) use the `@comity/*` npm scope.
  Development tooling uses the `@comity-dev/*` scope (root `devDependencies`,
  e.g. `@comity-dev/validate`, `@comity-dev/build`) and must never be
  presented as runtime API. Scope alone does not classify a package's role;
  check the package itself when its role matters.
- All workspace packages are `0.9.0` (pre-1.0; see section 16). Engines
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

## 2. Roles and authority

The workflow uses four logical roles with strictly different authority.
In practice these may be executed by the same agent, but each role's
authority is bounded by what that role may do.

### Researcher — read-only

- **May:** inspect public documentation, source code, package exports, tests,
  repository configuration, protocol files. Verify links, API claims,
  terminology, style. Identify contradictions and incorrect examples.
- **Must not:** modify the target document. Improve prose. Restructure
  documentation. Fix findings.
- **Output:** research notes under `docs/.documentation/notes/` and a
  findings list (section 4).

### Planner — proposes, cannot execute

- **May:** convert findings into an explicit change plan with authorized and
  forbidden changes. Propose minimal edits.
- **Must not:** make any modification. The Planner's output is a plan, not
  a change.

### Human — authorization gate

- **Must:** approve or reject the plan before any writing begins. The
  approval authorizes the plan's specific changes, not the document as a
  whole. May modify the plan before approving.

### Writer — executes only authorized changes

- **May:** make only changes explicitly authorized by the approved plan, at
  the explicitly authorized locations, in the explicitly authorized documents.
- **Must not:** rewrite correct prose. Reorganize sections. Add optional
  improvements. Modernize language. Expand scope. Fix unrelated defects.
  Modify source code, dependencies, lockfiles, or CI. Create temporary
  packages or workspaces.
- If the Writer discovers another problem: record `FOUND — OUT OF SCOPE`
  in state.yaml and stop. Do not fix it.

### Reviewer — independent check

- **May:** review the Writer's output against the approved plan and research
  findings. Return `PASS`, `REJECT`, or `BLOCKED` (section 9).
- **Must not:** make changes. The Reviewer approves or rejects the output;
  it does not fix it.
- The Reviewer must not be the same logical pass as the Writer. Even when
  executed by the same agent, the review must re-read the output against the
  plan independently — not from memory of what the Writer intended.

## 3. Workflow

The process for any document runs in this order:

```text
RESEARCH → PLAN → [HUMAN APPROVAL] → WRITE → REVIEW → PASS/REJECT
```

For a document with no findings (no-op path, section 10):

```text
RESEARCH → NO FINDINGS → PASS — NO CHANGES REQUIRED
```

No Writer phase. No human approval (there is nothing to approve).

For every write operation, the plan must be human-approved before writing.

## 4. Findings

Research must produce explicit findings. Each finding must contain:

```text
document:         <path>
location:         <section, line range, or code block identifier>
problem:          <what is wrong>
evidence:         <repository evidence proving the problem>
severity:         <defect | contradiction | inconsistency | improvement>
required_outcome: <what needs to change to resolve this>
```

A finding is not permission to edit. Findings are evidence that a change may
be worth planning; only an approved plan authorizes a change.

The agent must not manufacture findings to justify a write operation.
A document with no findings is a successful result.

## 5. Planning

The Planner converts findings into an explicit change plan. Every proposed
modification must have an authorization record:

```text
plan_id:          <unique plan identity, e.g. PLAN-<scope>-NNN>
document:         <path>
finding:          <which finding this change resolves>
exact_location:   <line range or code block identifier>
proposed_change:  <the exact change, including before/after where useful>
reason:           <why this specific change resolves the finding>
scope:            <files and locations authorized for this change>
```

`plan_id` is mandatory and is the identity of the remediation plan. It is
the single binding that connects the plan, its execution, and its review
(section 6). A document name is never a substitute for `plan_id`.

The plan must explicitly separate:

### Authorized changes

What the Writer may change. Each authorized change maps to exactly one
finding and one proposed modification.

### Forbidden changes

What the Writer must not change even if it believes those changes would
improve the document. This includes restructuring, prose rewrites, new
sections, package name changes, heading renames, and any change not
explicitly authorized above.

## 6. Plan identity and the human gate

`plan_id` is the single mandatory identity field that connects a plan, its
execution, and its review. It must appear in the plan, the approval record,
and the review record. A plan or approval without an identifiable `plan_id`
is invalid and authorizes nothing.

The human gate sits between PLAN and WRITE. The Writer has **zero write
authority** until the plan is approved.

The approval must authorize the plan's specific changes, not merely the
document. An approval record contains:

```text
plan_id:          <must exactly equal the approved plan's plan_id>
document:         <path>
finding:          <which findings are being addressed>
authorized:       <the specific changes approved>
not_authorized:   <what remains forbidden>
approver:         <human>
timestamp:        <when approved>
```

`plan_id` is mandatory in every approval record. An approval record without
`plan_id` is invalid. The binding is exact:

```text
approval.plan_id == execution.plan_id == review.plan_id
```

The document name is not a substitute for plan identity: an approval
authorizes the specific plan identified by `plan_id`, never a generic class
of future work on the same document.

This gate is mandatory for existing/consolidated documents and for new
documents. It may not be skipped, automated, or self-approved.

## 7. Writing

The Writer operates under a strict change contract:

1. Only documents explicitly authorized by the approved plan may be modified.
2. Only locations explicitly authorized may be changed.
3. Only changes explicitly authorized may be made.
4. All other content must be preserved byte-for-byte.
5. The change must be the smallest practical change satisfying the plan.

The Writer must not:

- rewrite correct prose;
- reorganize sections;
- add optional improvements;
- modernize language;
- expand scope;
- fix unrelated defects;
- modify source code;
- modify dependencies;
- modify lockfiles;
- create temporary packages or workspaces;
- create temporary projects to prove an example works.

If the Writer discovers another problem during writing:

```text
FOUND — OUT OF SCOPE
```

Record it in state.yaml. Do not fix it. Continue with only the authorized
changes.

## 8. Review

The Reviewer is a separate logical phase. The Reviewer receives:

- original document state (pre-write)
- resulting document (post-write)
- actual diff
- research findings
- approved plan

The Reviewer independently checks:

### Scope

Did the Writer modify only authorized files and locations?

### Necessity

Does every substantive change correspond to an approved finding?

### Minimality

Could the same finding have been resolved with less change?

### Correctness

Does the change actually resolve the finding?

### Regression

Did the change introduce: broken links; incorrect API claims; invalid
examples; unused imports; missing imports; terminology violations;
formatting problems; architectural inaccuracies?

### Preservation

Was correct existing content unnecessarily rewritten?

## 9. Reviewer outcomes

The Reviewer must return exactly one of:

```text
PASS
REJECT
BLOCKED
```

### PASS

All authorized changes are correct and no unauthorized changes exist.
The document may be marked `complete`.

### REJECT

The Writer made an unnecessary, excessive, incorrect, or unauthorized change.
The document transitions to `rejected` (section 18.3) and returns to
`planned` — NOT automatically to writing. The rejected changes are
described in the review record. The Reviewer must not silently repair the
document; repair requires a new plan and new human approval. The Reviewer
cannot become the Writer (section 8).

### BLOCKED

The Reviewer cannot determine correctness because evidence is insufficient
or contradictory. The document must not be marked complete. Record a
blocker (section 20).

## 10. No-op verification

A document that is already correct must be allowed to finish without
modification. The normal path supports:

```text
RESEARCH → NO FINDINGS → PASS — NO CHANGES REQUIRED
```

This is a successful terminal outcome. When this path is taken:

- the Planner is NOT invoked;
- a change plan is NOT created;
- Human Approval is NOT required;
- the Writer is NOT invoked;
- the Reviewer is NOT required;
- the document is marked `complete` directly from `research`.

The agent must not manufacture findings to justify a write operation.
The Researcher must record the verification evidence (what was checked and
what was found) and mark the document complete.

## 11. Document protection

### Existing/consolidated document

Default authority: `READ + VERIFY`.

Writing requires:

```text
FINDING + PLAN + HUMAN APPROVAL
```

A document that has passed review is `complete` and protected from
unnecessary rewrites. Re-verification is allowed; rewriting without a
finding is not, and no approval-free path leads from `complete` back to
`writing`.

### Protected-document re-entry

A protected document in `complete` may enter deterministic read-only
re-verification (`research`), exactly as follows:

```text
complete → research (re-verification) → complete      (no findings)
complete → research (re-verification) → findings → planned → pending_approval → approved → writing → review
```

- Re-verification is read-only: no re-verification state authorizes writing.
- If re-verification finds nothing, the document returns to `complete`
  directly (no-op path, section 10).
- If re-verification finds genuine defects, the document enters `findings`
  and follows the normal plan → human approval → write → review path.
- Historical completion remains historical: re-entering `research` does
  not erase the prior review evidence (section 13, section 18.6).

### New document

Writing authority is broader but still constrained by:

- manifest purpose;
- document scope;
- style and terminology;
- verified public APIs;
- approved plan.

A new document is not permission to invent APIs or architecture.

## 12. Scope guard

Before work begins, and after every write phase, the agent must run:

```bash
git status --short
git diff --name-only
```

Any file outside the authorized scope is a violation. The authorized scope
is declared in the plan (section 5). For any documentation run, the allowed
paths must be declared before writing begins.

If a forbidden path has changed:

```text
BLOCKED — SCOPE VIOLATION
```

The agent must not continue normal completion. The violation must be
recorded in state.yaml. The agent must not revert or repair the forbidden
change.

The agent must never create arbitrary temporary projects (e.g.
`examples/first-application/`, `tmp/`, `test-app/`) to prove an example
works. If executable verification requires a temporary environment, that
must become an explicit future capability with its own scope and cleanup
policy. For now: prefer existing repository evidence and existing tooling.

## 13. Code examples

Every code example in documentation must be classified:

```text
executable     — valid TypeScript that could compile and run
illustrative   — TypeScript-like, demonstrates shape but is not meant to compile
pseudocode     — conceptual; must use a `text` fence or a "pseudocode" label
```

Never put pseudocode in a `ts` block.

An `executable` example must have a defined verification method. At minimum
verify:

- imports: every import path exists in the package `exports` map;
- exported symbols: every imported symbol is actually exported;
- public subpaths: correct package and correct subpath;
- local symbol definitions: every referenced symbol is either imported or
  defined within the example itself;
- unused imports where tooling can detect them;
- TypeScript validity when claimed;
- runtime behavior when claimed.

Never claim "verified with tsc" unless the command or reproducible
verification method was actually executed and its output recorded.

An `illustrative` example must be labeled (comment or fence language) and
must not be presented as verified executable code.

Keep examples minimal: one concept each; elide unrelated setup with a
comment, never invented helpers.

## 14. Research rules and evidence hierarchy

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
verification against the `exports` map and implementation.

## 15. Public API verification

For every package, symbol, and example presented, verify and be able to cite:
package name and version; exact export subpath; symbol name and kind;
signature (parameters, required vs optional, generics); return type and the
`Result<T, E>` error branch for fallible operations; runtime behavior where
behavioral claims are made. Never write an import unless that exact path was
verified. Correct package with wrong subpath is still an invented API.

## 16. Pre-1.0 honesty

All `@comity/*` packages are pre-1.0 (`0.9.0` at protocol creation). Never
present an unstable API as frozen — forbidden without explicit governance
evidence: "will never change", "stable forever", "guaranteed". Prefer
current-behavior language: "as of `0.9.0`, …", "the current contract is …",
"subject to refinement before 1.0". Distinguish stable intent (inward
dependencies, contracts-vs-adapters, `Result`/error semantics, `@comity/*`
vs `@comity-dev/*` split) from refinable surface (exact signatures, option
shapes, subpath additions).

## 17. State and manifest

`manifest.yaml` defines which documents exist, their lifecycle state, their
protection level, and their acceptance criteria. It is the authoritative
record of the documentation roadmap.

`state.yaml` represents operational execution state: which document is
currently in progress, which phase it is in, findings, plans, approvals,
and reviews. It must not replace the manifest's per-document lifecycle
state.

### Consistency requirement

The manifest is authoritative for document roadmap status (which documents
exist, their phase, protection, and lifecycle state). `state.yaml` is
authoritative for operational execution state (current phase, findings,
plans, approvals, reviews). Do not duplicate operational details in the
manifest.

### State ownership and role locks

`state.yaml` distinguishes two classes of entries:

- **Authorization evidence** — findings used for authorization, plans,
  approvals, `write_authorized`, `approved_at`, reviews, `last_review`,
  completion evidence, `last_completed`, and scope-violation outcomes.
- **Execution progress** — position fields such as `current.document`,
  `current.phase`, and `last_run` status that record where work stands.

The Writer may update only execution-progress information explicitly
permitted by the approved plan for that write. The Writer must never
create, alter, or overwrite authorization evidence. Updating a progress
field is never a form of authorization: only a human-approved plan
(section 6) grants write authority.

The Reviewer may not alter approval evidence and must not become the
Writer. The Human is the only role that records approvals. If a role
cannot distinguish whether a field is authorization evidence or
execution progress, it must treat the field as authorization evidence and
leave it unchanged.

After each phase transition, `state.yaml` must be updated. At the end of
each phase, the agent must verify that:

- the manifest's `status` for the current document is consistent with the
  phase recorded in `state.yaml`;
- a document marked `complete` in the manifest reached `complete` via a
  valid path (no-op or approved → written → reviewed → PASS);
- no document is marked `complete` in the manifest while `state.yaml`
  records an unresolved failed/blocked execution.

If manifest and state disagree, the manifest is authoritative for the
document's lifecycle position, but the discrepancy must be reported and
resolved before proceeding — do not silently normalize unrelated state.

### Research notes

Research notes under `docs/.documentation/notes/` are evidence records, not
authority. They may record evidence, findings, verification commands,
observations, rejected hypotheses, and proposed changes. They must not
silently become a second source of truth. The approved plan is the
authority for the Writer.

## 18. Operational lifecycle

Every manifest document is in exactly one lifecycle state. The canonical
lifecycle:

```text
pending → research → findings → planned → pending_approval → approved → writing → review → complete
```

A rejected review or rejected plan enters `rejected`, which returns to
`planned` (requiring new approval) — never directly to `writing` or
`review`. A `REJECT` outcome must not implicitly authorize another Writer
execution under the same approval; any further repair after rejection
requires a new/updated plan, new human approval, writing, and review:

```text
review → rejected → planned → pending_approval → approved → writing → review
```

A no-op path is explicitly valid (section 10):

```text
research → no findings → complete
```

A document may also carry a `blocked` flag. `blocked` is orthogonal to the
lifecycle state: a blocked document keeps its state, records the blocker in
`state.yaml`, and is skipped until unblocked.

### States

#### pending

Known to be needed; no work started.

#### research

Read-only evidence gathering and finding identification. Maps to the
Researcher role. Output is research notes and a findings list. A document
with no findings goes directly to `complete` (no-op path, section 10).

#### findings

Research identified one or more genuine defects. Findings are recorded in
`state.yaml`. The document awaits planning.

#### planned

Findings have been converted into an explicit change plan with authorized
and forbidden changes. The plan is recorded in `state.yaml`. The document
awaits human approval. A plan may be revised while in `planned`; once
approved, it becomes immutable (section 18.2).

#### pending_approval

A plan has been submitted for human approval. No writing may occur in this
state. The human may approve, reject, or request changes.

#### approved

Human approval has been granted for a specific plan. The approved plan is
immutable (section 18.2). The document awaits writing. Writing may execute
only the approved plan.

#### writing

Executing approved changes only. Maps to the Writer role. Entry requires an
approved plan (section 6). The Writer follows the minimal-diff contract
(section 7). Before writing, capture the baseline (section 18.4).

#### review

Independent review of Writer output against the approved plan. Maps to the
Reviewer role. Entry requires a completed write phase and the approved plan.
Review returns exactly one of `PASS`, `REJECT`, or `BLOCKED` (section 9).

#### rejected

The document failed review (REJECT outcome) or its plan was rejected. The
document returns to `planned` — never automatically to `writing`. There is
no autonomous post-REJECT write authorization. Any further writing requires
a (new or revised) plan that is human-approved again:

```text
rejected → planned → pending_approval → approved → writing → review
```

`repair` is not a lifecycle state. It may only describe work performed under
a newly approved reparative plan; it never itself authorizes a write. If a
review failure remains unchanged after repeated remediation under separately
approved plans, record a genuine blocker (section 20) instead of continuing.

#### complete

Review passed (`PASS` outcome) or research found no defects (no-op path).
Document is protected from unnecessary rewrites. A document reaches
`complete` only via one of these two paths (section 22).

### 18.1 Valid transitions

A phase may execute only if the current state authorizes it. Valid
transitions:

```text
pending          → research
research         → complete            (no-op: no findings)
research         → findings            (findings identified)
findings         → planned
planned          → pending_approval
pending_approval → approved            (human approves)
pending_approval → planned            (human rejects or requests changes)
approved         → writing
writing          → review
review           → complete            (PASS)
review           → rejected            (REJECT)
review           → blocked             (BLOCKED)
rejected         → planned             (return to planning; requires new approval)
```

Invalid transitions (never permitted without the required intermediate
state):

```text
findings         → writing             (must pass through planned → approved)
research         → writing             (must pass through findings → planned → approved)
planned          → writing             (must pass through pending_approval → approved)
writing          → complete            (must pass through review → PASS)
review           → writing            (rejected returns to planned, not writing)
review           → repair → writing   (repair is not a state; post-REJECT repair requires a newly approved plan)
rejected         → writing            (rejected returns to planned, not writing)
```

No approval-free write is permitted: writing requires an approved plan
bound to the plan under execution (sections 6, 18.2). No approval-free
completion after modification is permitted: a modified document reaches
`complete` only via review → PASS (section 22).

### 18.2 Plan immutability and authorization-binding content

Once a plan is approved, the following authorization-bearing content is
immutable and must match exactly between the approved plan and the plan
being executed:

```text
plan_id
document
findings
authorized_changes
forbidden_changes
scope / target paths
acceptance_criteria
```

If any authorization-bearing content changes after approval:

- the previous approval is invalid for the changed content;
- execution requires reauthorization (return to `planned` followed by a new
  `pending_approval` and new human approval).

If additional work is discovered during writing or review:

- do not modify the approved plan in place;
- do not extend Writer authorization beyond the approved plan;
- do not silently amend the plan.

Instead: create a new plan, obtain new human approval, then execute the
new plan.

A plan status update (e.g. `pending_approval` → `approved`) is not an
authorization-bearing content mutation and does not create a new
authorization revision.

### 18.3 Approval rejection

If human approval rejects a plan:

```text
pending_approval → rejected → planned
```

The Writer must never execute a rejected plan. If the human requests
changes: preserve the previous plan as historical evidence (do not erase
it); create or revise a plan according to the planning rules (section 5);
require approval again before writing. Historical approval/rejection
records are preserved in `state.yaml` (section 18.6).

### 18.4 Pre-existing changes

Before Writer execution, capture the baseline:

```bash
git rev-parse HEAD
git status --short
git diff --name-only
git diff -- <target>
md5 -q <target>
```

The Writer must distinguish pre-existing changes (present before the
Write phase) from changes caused by the current execution. The Writer
must never: reset pre-existing changes; overwrite them; stage/unstage
them; claim them as its own; use them as authorization for additional
changes. Review compares the Writer result against the pre-write baseline,
not against a clean tree.

### 18.5 Resume semantics

`state.yaml` records workflow position; it is evidence of position, not
proof that the underlying artifact is correct. On resume:

- **After research**: resume from the recorded research result. Do not
  repeat research unless evidence is stale or the protocol requires
  revalidation.
- **After planning**: resume at `pending_approval`. Do not write.
- **After approval**: resume at `approved`. Verify the approved plan still
  matches the stored plan before writing.
- **During/after writing**: do not assume success from
  `current.phase: writing`. Inspect the actual working-tree diff against
  the pre-write baseline before continuing.
- **During/after review**: resume from the recorded review result. Do not
  silently skip Review.

### 18.6 State history

Preserve historical evidence for findings, plans, approvals, and reviews
in `state.yaml`. Do not overwrite previous approval or review decisions.
Each historical record retains: what happened; to which document; under
which plan; with what result. A plan status update is not a plan-content
mutation.

## 19. Dependency-aware execution

Do not write a dependent document before its dependencies are `complete`.
Current manifest backbone:

```text
index → what-is-comity → core-concepts → { architecture, errors-and-results }
→ getting-started → first-application
```

`why-comity` refines `what-is-comity` and depends on it. The manifest is
authoritative; this diagram is a summary. If they disagree, the manifest
wins and this file must be corrected.

## 20. Genuine blockers

A genuine blocker exists only when repository evidence is contradictory or
insufficient to establish intended public behavior: incompatible public
APIs in two authoritative sources; implementation contradicting `exports`;
explicitly conflicting architecture rules; an indeterminable intended
contract; or a forced choice between potentially false public claims.

When blocked: stop modifying that document; record the blocker in
`state.yaml`; do not invent a resolution. A blocker record contains:
document; since (date); revision; summary; evidence references; decision
needed. A blocker is cleared only when (a) a repository change resolves the
contradiction, or (b) an explicit human decision resolves the intended
contract.

## 21. Documentation style

Follow `style.md` and `terminology.yaml`. Prefer: concept before package;
explanation before reference; progressive complexity; short paragraphs;
precise concrete language; active voice; restrained marketing. Avoid:
repetition across documents (link instead); generic framework marketing;
exaggerated or permanent guarantees; invented abstractions; implementation
details irrelevant to the reader's task; package exposition before
architecture.

Known risks at protocol creation (verify, do not assume): `docs/index.md`
links to planned paths (`philosophy.md`, `guides/*`, `packages/*`,
`quickstart.md`, `examples/*`, `contributing.md`) that do not exist yet —
never link to them as if they exist. Lifecycle wording must agree: kernel
`open → sealed → running → stopped`; composition resolve → setup (reverse
topological) → seal → initialize (forward topological). `@comity/*` vs
`@comity-dev/*` naming must stay exact everywhere.

## 22. Completion criteria

A document is complete when exactly one of these is true:

- **No-op completion**: research produced no findings (research → complete).
- **Successful approved-plan completion**: a plan was approved → written → reviewed
  → PASS. (Work performed after a review REJECT, under a newly approved
  reparative plan, reaches completion only through this same approved-plan
  path — there is no separate completion path.)

The following are NOT complete:

- `approved` — approval alone is not completion.
- `writing` — a document being written is not complete.
- `review` — a document under review is not complete.
- `review: rejected` — a rejected review is not complete.
- `planned` / `pending_approval` / `findings` / `research` — intermediate
  states are not completion.

A documentation run is complete when every manifest document is `complete`
or `blocked` with a genuine blocker. "All files exist" is not completion.
Only verified completion counts.

## 23. Final report

At the end of a phase or run, emit a factual report:

```text
Documentation phase
-------------------
Phase:              <research | plan | write | review>
Document:           <id>
Findings:           <count, or "none">
Plan status:        <not_applicable | pending_approval | approved>
Write status:       <not_applicable | executed | rejected>
Review outcome:     <PASS | REJECT | BLOCKED | NOT_APPLICABLE>
Repository revision:
Working tree:       <clean | dirty>
Scope violations:   <none | list>
```

Do not claim completion without evidence.

