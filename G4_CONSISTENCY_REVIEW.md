# G-4 Final Decision Consistency Review

**Date:** 2026-11-19  
**Scope:** Review only — no implementation, no ADR amendments, no document modifications  
**Baselines verified:**
- Commerce: `/Users/filippo/Projects/comity/commerce` — branch `main`, HEAD `6af3ecb`, clean
- Development: `/Users/filippo/Projects/comity/development` — HEAD `13003c9`, clean; ADR-030, ADR-031, ADR-037 **Accepted**
- G-4 assessment: `/Users/filippo/Projects/comity/commerce/examples/payment-attempts/docs/g4-revolut-evidence-assessment.md` (first pass + Independent Forensic Reassessment 2026-11-18)
- Published `@comity/payment` contract: `@comity/payment` 0.10.0 (local source matches npm)

---

## A. Consistency Verdict

**FAIL**

The G-4 owner decision brief contains critical contradictions that invalidate its core recommendations. The brief cannot be used as a basis for OD-1 through OD-8 until the contradictions are resolved.

---

## B. Critical Contradictions

### B1. OD-4 × C-8 × ADR-030: Cancel Idempotency Requirement

| **Conflicting Statements** | **Governing Source Clauses** |
|----------------------------|------------------------------|
| Brief: "OD-4 recommends `incompleteResolution.kind: "cancel"`" and "this decision does not require an ADR amendment and blocks production only" | G-4 assessment §R17 (OD-4), §4.C |
| Brief: "Cancel key: there is no idempotency key on cancel [A]. ADR-030 §1 requires one per cancel invocation; this is covered by IB-1, because C-8 applies to the whole binding" | G-4 assessment §R8.3, line 756 |
| ADR-030 §1: "Every payment command carries a **required** `idempotencyKey: string`: `PaymentRequest` (initiation), the capture request and the cancel request (ADR-037), and `RefundRequest` (ADR-031)" | ADR-030 lines 50–52 |
| ADR-037 C-8: "`idempotencyRetentionSeconds > 0` … a provider without native idempotency cannot implement `PaymentProvider`" | ADR-037 line 323 |
| ADR-037 C-1: `cancel ≠ false ⇔ cancel` port present | ADR-037 line 316 |
| ADR-037 C-11: `incompleteResolution.kind = "cancel"` ⇒ `cancel.incomplete` is true | ADR-037 line 326 |

**Technical Consequence:**  
Declaring `incompleteResolution.kind: "cancel"` **requires** the `cancel` port (C-1), which **requires** `cancel.incomplete: true`. The `cancel` port (`PaymentCancelProvider`) requires an `idempotencyKey` on every invocation (ADR-030 §1, `PaymentCancelRequest` interface). C-8 requires `idempotencyRetentionSeconds > 0` for the **binding as a whole** — it is not scoped to individual ports. Revolut documents **no idempotency key for cancel** (E-5, E-2 scan across 10 versions). Therefore:

1. A binding declaring `kind: "cancel"` **cannot be composed** under current ADRs — it violates C-8 at static validation time.
2. The statement "blocks production only" is **false** — it blocks **composition** (`validatePaymentProviderBinding` returns `invalid_configuration`).
3. OD-4 cannot be decided independently of OD-1; both require the same ADR amendment or Revolut evidence.

**Required Correction:**  
OD-4 must be reclassified as an **implementation blocker** (like IB-1), not a production blocker. The brief must state explicitly: choosing `kind: "cancel"` requires either (a) Revolut written confirmation of a native cancel idempotency key with retention, or (b) an owner-governed ADR amendment to C-8 and ADR-030 §7.

---

### B2. C-8 Binding-Level Scope vs. Partial Port Declaration

| **Conflicting Statements** | **Governing Source Clauses** |
|----------------------------|------------------------------|
| Brief implies C-8 might only apply to commands the binding declares | G-4 assessment §R13: "C-8 is a binding-level static rule" |
| Validator code: `if (!(c.idempotencyRetentionSeconds > 0)) violate("C-8", ...)` — **unconditional** | `packages/payment/src/validation/validate-binding.ts` lines 92–94 |
| ADR-030 §7: "A provider integration that has **no** native idempotency support cannot honestly implement `PaymentProvider`" | ADR-030 lines 147–148 |
| ADR-037 C-8 rationale: "ADR-030: a provider without native idempotency cannot implement `PaymentProvider`" | ADR-037 line 324 |

**Technical Consequence:**  
C-8 is checked **once per binding**, not per port. A binding with `asynchronousInitiation: true` but `cancel: false` and `refund: false` **still fails C-8** if `idempotencyRetentionSeconds` is not `> 0`. The retention value is a single number on the binding descriptor; it cannot be "per command." Revolut has no initiation idempotency → no retention to declare → **no Revolut binding can pass static validation**, regardless of which ports it declares.

**Required Correction:**  
The brief must stop suggesting that omitting ports avoids C-8. The only paths are: Revolut evidence (Q1) or ADR amendment (OD-1).

---

### B3. Application-Side Store Path Claim

| **Conflicting Statements** | **Governing Source Clauses** |
|----------------------------|------------------------------|
| First-pass assessment: "ADR-030 §7 names the two contract-consistent paths: native idempotency … or an application-side durable store" | G-4 assessment §4.A Analysis (first pass) |
| Reassessment: "An application-side store is **not** a contract-consistent path under the accepted ADRs" | G-4 assessment §R4.6 |
| ADR-030 §7: "An application may add its own durable store in front of such a provider; Comity does not supply one and this ADR does not make it a Core responsibility" | ADR-030 lines 147–148 |
| ADR-030 Alternatives: "Commerce wraps the port with its own idempotency table" — **rejected** | ADR-030 line 194 |
| ADR-037 C-8: retention value is "the adapter's **documented** claim, **verified against the PSP at selection**" | ADR-037 line 334 |

**Technical Consequence:**  
The first-pass statement was **incorrect** and has been corrected in the reassessment, but the brief's OD-1 framing still treats the application-side store as a viable "path" for the owner to choose. It is not — under accepted ADRs, only native provider idempotency satisfies C-8. An application-side store would require amending ADR-030 §7, ADR-037 C-8, and the rejected alternatives list.

**Required Correction:**  
OD-1 must frame the choice as: **wait for Q1 evidence** OR **amend ADR-030 and ADR-037** (with the amendment points from R4.7). The "application-side store" option must be removed from OD-1 options.

---

### B4. Q4 Does Not Establish Cancel Idempotency

| **Conflicting Statements** | **Governing Source Clauses** |
|----------------------------|------------------------------|
| Brief treats Q1, Q2, Q4 as sufficient for OD-1 option A | G-4 assessment §R17, OD-1 |
| Q4 asks: "After a `200` cancel of a `pending` order, can any payment still complete or move funds? What does a repeated cancel return?" | G-4 assessment §R15, Q4 |
| Q4 **does not ask** about: native cancel idempotency key, retention, mismatch behaviour, concurrency | ADR-030 §5 table; ADR-037 C-8 |

**Technical Consequence:**  
Q4 only covers **cancellation finality** (C-11 evidence requirement). It does **not** cover **cancel idempotency** (ADR-030 §5, C-8). The brief incorrectly treats Q4 as covering cancel idempotency guarantees.

**Required Correction:**  
Add a new question **Q3-Cancel-Idempotency** (or similar) to R15:
> **Cancel idempotency.** Does `POST /api/orders/{id}/cancel` support any idempotency or duplicate-suppression mechanism? If yes: its name, scope, retention period and start, response to same key with identical body, response to same key with different body, behaviour for concurrent requests.

---

### B5. OD-5: Refund `400` Mapping Contradicts ADR-031/ADR-037

| **Conflicting Statements** | **Governing Source Clauses** |
|----------------------------|------------------------------|
| Brief: "OD-5: un-defer lookup by reference for refunds, or accept manual reconciliation for that case" | G-4 assessment §R17, OD-5 |
| Gateway code: `rejected` = "the request was not accepted as sent … Nothing was created" | `adapters/payment-bindings/src/gateway.ts` lines 66–67 |
| Revolut: declined **card** refund returns `400` **and creates the refund order** | G-4 assessment E-3, R8.1; `refundOrder` spec |
| ADR-037 §8b: a confirmed failure (`400` with created refund order) is **Case C**, not `internal_error` | ADR-037 lines 575–580, 669–675 |
| ADR-031: refund failure never creates a reversal; only `succeeded` does | ADR-031; ADR-037 line 674 |

**Technical Consequence:**  
Mapping Revolut's `400` (declined card refund) to `internal_error` (unknown outcome) is **wrong** — it misclassifies a **confirmed failure with a created resource** as an unknown outcome. This would:
- Trigger same-key replay within retention (ADR-030 §6), which is incorrect for a confirmed failure
- Prevent the application from recording the `failed` refund fact (requires authoritative failure + `refundId`)
- Break refund reversal deduplication (the refund order exists and has a `refundId`)

**Required Correction:**  
OD-5 must distinguish:
1. **Validation `400`** (malformed request) → `rejected` / `internal_error` (nothing created)
2. **Declined card refund `400`** (refund order created, payment `declined`) → **Case C**: authoritative failure, record `failed` refund fact with `refundId` from lookup, no reversal
3. **`insufficient_funds` `400`** (unknown if refund order created) → needs Q3 answer

The gateway's `refundFailure` function (lines 260–276) already handles `unrepresentable_success` for refunds but does **not** handle the `400` decline case. This is an adapter bug, not an owner decision.

---

### B6. OD-2: Delivery Identity vs. Provider Event Identity

| **Conflicting Statements** | **Governing Source Clauses** |
|----------------------------|------------------------------|
| ADR-037 §4: `ProviderEventId` (`eventId`) is "Generated by: Provider" | ADR-037 line 237 |
| ADR-037 §7: inbox uniqueness on `(binding, eventId)` | ADR-037 line 481 |
| Revolut: **no provider-assigned event identifier** in any webhook payload or header | G-4 assessment E-9, R5.1 |
| Brief: OD-2 must choose an alternative for inbox deduplication key | G-4 assessment §R17, OD-2 |

**Technical Consequence:**  
Every alternative in R5.3 (hash of body, `order_id`+`event`, `order_id`+`event`+`timestamp`, per-delivery application ID) **requires an owner decision to amend ADR-037 §4 and §7**, because:
- They are **application-generated**, not provider-generated
- They violate the `ProviderEventId` provenance rule
- They violate inbox uniqueness semantics `(binding, eventId)`

The "per-delivery application ID + reconciliation-signal processing" (R5.3 row 4) is the only technically robust option, but it **requires ADR amendment** to decouple delivery identity from provider event identity.

**Required Correction:**  
OD-2 must be split into two decisions:
1. **OD-2a (contract):** Amend ADR-037 to allow application-assigned delivery IDs for inbox deduplication, separate from `ProviderEventId`.
2. **OD-2b (implementation):** Choose the specific deduplication scheme (per-delivery ID + reconciliation signals).

---

### B7. OD-3: Unverified Delivery Lookup Safety

| **Conflicting Statements** | **Governing Source Clauses** |
|----------------------------|------------------------------|
| ADR-037 §7 rule 4: "Unverified input … never changes state. It **may only trigger a lookup**." | ADR-037 line 99 |
| ADR-037 §7 direct processing: "Any processing failure returns non-2xx" | ADR-037 line 492 |
| Brief does not define rate-limiting or abuse controls for unverified deliveries triggering lookups | G-4 assessment §9 |

**Technical Consequence:**  
An attacker can send unlimited unverified deliveries, each triggering a `GET /api/orders/{id}` lookup (rate-limited by Revolut, undocumented). This is a **denial-of-service vector** on the application's outbound API quota and Revolut's rate limits. The ADRs do not specify abuse controls; this is an implementation gap that must be addressed before production.

**Required Correction:**  
OD-3 must include: per-binding inbound rate limits on the webhook ingress, a maximum lookup trigger rate, and a circuit breaker for repeated unverified deliveries from the same source IP.

---

## C. Corrected Decision Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         REVOLUT EVIDENCE (EXTERNAL)                         │
│  Q1 (initiation idempotency) ──┬── Q2 (refund idempotency)                  │
│  Q3 (cancel idempotency) ──────┤                                            │
│  Q4 (cancel finality) ─────────┤                                            │
│  Q5 (expire_pending_after) ────┤                                            │
│  Q6 (event identity) ──────────┤                                            │
│  Q7 (signature) ───────────────┤                                            │
│  Q8 (lookup consistency) ──────┤                                            │
│  Q10 (amount semantics) ───────┤                                            │
│  Q15 (eligibility) ────────────┤                                            │
└────────────────────────────────┼─────────────────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
         ┌──────────────────┐       ┌──────────────────┐
         │ OD-1 (ADR amend  │       │ OD-4 (C-11       │
         │ or wait for Q1)  │       │ mechanism)       │
         └────────┬─────────┘       └────────┬─────────┘
                  │                          │
                  │        ┌─────────────────┘
                  │        ▼
                  │ ┌──────────────┐
                  │ │ OD-2a (ADR   │
                  │ │ amend eventId)│
                  │ └──────┬───────┘
                  │        │
                  ▼        ▼
         ┌────────────────────────┐
         │ OD-2b (dedup scheme)   │
         └───────────┬────────────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
┌──────────────────┐    ┌──────────────────┐
│ OD-3 (inbox +    │    │ OD-5 (refund 400 │
│ abuse controls)  │    │ classification)  │
└────────┬─────────┘    └────────┬─────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
         ┌────────────────────────┐
         │ OD-6 (business inputs) │
         └───────────┬────────────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
┌──────────────────┐    ┌──────────────────┐
│ OD-7 (version    │    │ OD-8 (governance │
│ policy)          │    │ records)         │
└──────────────────┘    └──────────────────┘
```

**Key dependencies:**
- **OD-1** and **OD-4** both require **Q1** (initiation idempotency) or ADR amendment. They are **co-dependent** — choosing `kind: "cancel"` for C-11 requires cancel idempotency (Q3), which Revolut also lacks.
- **OD-2a** (ADR amendment for eventId) is a **prerequisite** for OD-2b and OD-3 (inbox implementation).
- **OD-5** is an **adapter implementation fix**, not an owner decision — it requires correcting the gateway mapping, not choosing a policy.
- **OD-6** (business inputs) is a **prerequisite** for Q15 (eligibility) and for sending questions to Revolut.
- **OD-7**, **OD-8** are documentation/governance and can proceed in parallel once OD-1 is resolved.

---

## D. Valid Initial Binding Scope

**No valid initial binding scope exists under the current accepted contracts.**

### Capability Matrix

| Scope | Required Commands | Required Idempotency | Required Retention | C-8 Satisfied? | C-11 Satisfied? | Composable? | Production Safe? |
|-------|-------------------|---------------------|-------------------|----------------|-----------------|-------------|------------------|
| Initiation only | `initiate`, `retrieve` | Initiation key | `R_init > 0` | **NO** (Revolut: no key) | N/A (sync) or needs mechanism | **NO** | **NO** |
| Initiation + notifications | + `verify` | Initiation key | `R_init > 0` | **NO** | N/A or needs mechanism | **NO** | **NO** |
| Initiation + refund | + `refund`, `retrieveRefund` | Initiation + refund keys | `R_init > 0`, `R_refund > 0` | **NO** (initiation) | N/A or needs mechanism | **NO** | **NO** |
| Initiation + cancel | + `cancel`, `retrieveOperation` | Initiation + cancel keys | `R_init > 0`, `R_cancel > 0` | **NO** (both) | `kind: "cancel"` needs `cancel.incomplete` | **NO** | **NO** |
| Initiation + refund + cancel | All ports | All three keys | All three `R > 0` | **NO** (initiation, cancel) | `kind: "cancel"` or `"expiry"` | **NO** | **NO** |
| Initiation + reconciliation (no notifications) | `initiate`, `retrieve` | Initiation key | `R_init > 0` | **NO** | N/A or needs mechanism | **NO** | **NO** |

### Why None Are Valid

1. **C-8 is binding-level and unconditional** (`idempotencyRetentionSeconds > 0`). The validator checks this **before** checking port presence (C-1). A binding fails at static validation if it cannot declare a positive retention verified against the PSP.

2. **Revolut has no initiation idempotency key** (E-1, E-2, R4.1). Therefore `R_init = 0`. No retention value can be honestly declared.

3. **Revolut has no cancel idempotency key** (E-5, R8.3). If `kind: "cancel"` is chosen, `R_cancel = 0` also.

4. **Expiry mechanism** (`kind: "expiry"`) requires a **provider-documented terminal-expiry deadline** (C-11: "never an application-selected timeout or an estimate"). Revolut's `expire_pending_after` is **merchant-selected per order** (R9.1), with **no default** when omitted. This fails the C-11 evidence requirement.

5. **The reassessment confirms** (R13): "IB-1 (D1). C-8 is a **binding-level** static rule, so IB-1 prevents composing any Revolut binding, not only `initiate`. Adapter code may be written, but not composed or used."

### The Only Paths Forward

| Path | What It Requires | Effect on Binding Scope |
|------|------------------|-------------------------|
| **Wait for Q1** | Revolut written confirmation of native initiation idempotency key with retention | If confirmed: full async binding becomes valid |
| **OD-1: Amend ADR-030/ADR-037** | Owner-governed amendment per R4.7 points (C-8 exception, no replay, reference immutability, surplus order disposal, cancel key) | Enables binding composition without native initiation idempotency; cancel key still needed for `kind: "cancel"` |
| **Select different PSP** | Choose a provider with documented native idempotency for initiation | Avoids Revolut-specific blockers |

---

## E. Corrected OD Recommendations

| OD | Current Brief | Correction Required |
|----|---------------|---------------------|
| **OD-1** | "Wait for Q1, or amend ADR-030/ADR-037" — treats application-side store as a path | **Remove application-side store option.** Frame as: (a) wait for Q1 written evidence, OR (b) owner-governed ADR amendment per R4.7. Explicitly state: amendment must also cover cancel idempotency key (ADR-030 §1) if `kind: "cancel"` is desired. |
| **OD-2** | Single decision on eventId provenance | **Split into OD-2a (contract amendment)** and **OD-2b (dedup scheme choice).** OD-2a must amend ADR-037 §4 (ProviderEventId provenance) and §7 (inbox uniqueness) to allow application-assigned delivery IDs. OD-2b selects the scheme (R5.3 row 4 recommended). |
| **OD-3** | Confirm reconciliation-signal model | **Add abuse controls:** per-binding inbound rate limit, max lookup trigger rate, circuit breaker for unverified deliveries. Specify that unverified deliveries are **persisted to inbox first**, then verified; only verified events trigger lookups. |
| **OD-4** | "Rule on C-11 interpretation, choose `cancel` or `expiry`" — blocks production only | **Reclassify as implementation blocker.** Choosing `cancel` requires cancel port (C-1) → cancel idempotency (Q3) → C-8. Choosing `expiry` requires provider-documented deadline (Q5) → Revolut has none. OD-4 **cannot be decided** until Q1/Q3/Q5 resolved or ADRs amended. |
| **OD-5** | "Un-defer lookup by reference for refunds, or accept manual reconciliation" | **Not an owner decision.** This is an **adapter bug fix**: the gateway must distinguish (a) validation `400` → `rejected`, (b) declined card refund `400` → Case C (authoritative failure, record `failed` with `refundId`), (c) `insufficient_funds` `400` → unknown (needs Q3). Update `refundFailure` in `gateway.ts`. |
| **OD-6** | Business inputs for Revolut | **No change** — prerequisite for Q15 and sending questions. |
| **OD-7** | Version pinning policy | **No change** — can proceed in parallel. |
| **OD-8** | Governance records | **No change** — but must record the Revolut selection and W-1 acceptance in governed documents (not just working context). |

---

## F. Remaining Owner Decisions

### Decisions That **Can** Be Made Now (No External Dependency)

| Decision | Description | Prerequisite |
|----------|-------------|--------------|
| **OD-6** | Supply business inputs: legal entity/country per region, business model, settlement/presentment currencies, customer regions, payment methods | None — internal |
| **OD-7** | Accept version pinning policy (R11) and unknown-enum policy | None — internal |
| **OD-8** | Record Revolut selection and W-1 acceptance in governed documents; resolve design §16 documentary lag | OD-6 inputs |
| **OD-2b** | Choose deduplication scheme (R5.3 row 4 recommended: per-delivery ID + reconciliation signals) | **Requires OD-2a (ADR amendment) first** |

### Decisions That **Must Wait** for Revolut Evidence or ADR Amendment

| Decision | Blocking Dependency | Required Evidence |
|----------|---------------------|-------------------|
| **OD-1** | Q1 (initiation idempotency) **or** ADR-030/ADR-037 amendment | Written Revolut confirmation of native initiation idempotency key, retention, mismatch, concurrency — **OR** owner-governed amendment per R4.7 |
| **OD-2a** | ADR-037 amendment to decouple delivery ID from ProviderEventId | Owner governance process; no external evidence needed but **must be done before OD-2b/OD-3** |
| **OD-3** | OD-2a (inbox deduplication key), inbox implementation, abuse control design | Inbox implemented and verified (G-5); OD-2a resolved |
| **OD-4** | Q3 (cancel idempotency), Q4 (cancel finality), Q5 (expire_pending_after semantics), OD-1 (if amendment needed for cancel key) | Written Revolut confirmation for chosen mechanism; if `expiry`: provider-documented terminal deadline (not merchant-selected) |
| **OD-5** | Q3 (refund `400` discrimination) | **Not an owner decision** — adapter fix once Q3 answered; but Q3 must be answered to know correct mapping |

### Sandbox Tests Required Before Any Production Decision

| Test | Answers | Prerequisite |
|------|---------|--------------|
| ST-1 to ST-3 | Q8 (lookup consistency), Q9 (reference uniqueness/mutability) | Sandbox access (Q14) |
| ST-4, ST-5 | Q5 (expire_pending_after behaviour) | Sandbox access |
| ST-6 | Q4 (cancel finality, repeat, processing state) | Sandbox access |
| ST-7 | Q2, Q3 (refund idempotency, 400 behaviour) | Sandbox access |
| ST-8, ST-9 | Q6, Q7 (webhook delivery, signatures, rotation) | Sandbox access |
| ST-11 | Q8 (lookup staleness) | Sandbox access |
| ST-13 | Q10 (amount field semantics) | Sandbox access |

**No sandbox access has been obtained** (Q14 unanswered). No sandbox test has been run.

---

## Summary

The G-4 brief **fails** its consistency review because:

1. **OD-4 is misclassified** as a production blocker; it is an **implementation blocker** (composition fails under C-8).
2. **OD-1's "application-side store" option is invalid** under accepted ADRs (corrected in reassessment but not in OD framing).
3. **Q4 does not cover cancel idempotency** — a new question (Q3-Cancel-Idempotency) is required.
4. **OD-5 is an adapter bug fix**, not an owner decision; the current gateway mapping misclassifies Revolut's `400` decline.
5. **OD-2 requires an ADR amendment** (OD-2a) before any deduplication scheme can be chosen (OD-2b).
6. **No valid initial binding scope exists** — C-8 blocks all Revolut bindings until Q1 evidence or ADR amendment.
7. **Abuse controls for unverified deliveries** are missing from OD-3.

**Recommendation:** Do not proceed with OD-1 through OD-8 until:
- OD-1 is reframed with only two paths (Q1 evidence or ADR amendment per R4.7)
- OD-2 is split into OD-2a (ADR amendment) and OD-2b (scheme choice)
- OD-3 includes abuse controls
- OD-4 is reclassified as implementation blocker co-dependent with OD-1
- OD-5 is removed from owner decisions and assigned as adapter implementation work
- Q3-Cancel-Idempotency is added to the Revolut question set
- OD-2a is prioritized as it unblocks OD-2b, OD-3, and inbox implementation