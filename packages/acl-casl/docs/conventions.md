# @comity/acl-casl — Conventions

`@comity/acl-casl` is a Technology Adapter: it translates, it does not decide.

## Rules

- Depend on `@comity/acl` for the contract and on `@casl/ability` for the engine.
  Nothing else.
- Keep CASL types out of the Core contract. `MongoAbility`, rules, conditions, and
  field lists must never appear in `@comity/acl` — not in its types, and not in
  the `Authorizer` signature this adapter implements. The adapter's own
  constructor necessarily accepts the CASL ability it wraps
  (`new CaslAuthorizer(ability: MongoAbility)`); that is the technology boundary,
  and the Application Layer owns the ability it passes in.
- Translate `AuthorizationContext` faithfully:
  - `resource` → subject type
  - `context` → subject fields used for condition evaluation, minus the
    adapter's own directives
  - `context["acl:field"]` → CASL field argument, only when present
- Call CASL with three arguments only when the directive is defined. The
  two-argument call is the resource-wide question, and it is what callers already
  get.
- Treat the directive as reserved metadata, not as a resource attribute. It is
  deleted before the subject is built so that a policy condition can never match
  on it.
- Reject a malformed directive — not a non-blank string — as `internal_error`.
  Never ignore it: silently dropping a restriction widens the authorization
  question, which is the one failure mode an adapter must not introduce.
- Keep decision text stable: a denial always reports
  `"Authorization denied by policy"`. Do not interpolate the field, the action, or
  condition values into it — that text is observable by application code and
  belongs to logs, not to policy.
- Wrap every CASL exception as `AuthorizationError("internal_error")` with
  `details.wrappedReason` and the original error as `cause`. `authorize()` must
  never throw.
- Do not introduce owner-, tenant-, or role-specific logic in the adapter. That is
  policy, and policy is composed by the Application Layer.

## Known gap

A request without the directive cannot express "no attribute matters"; CASL treats
it as the resource-wide question, where a rule restricted to some fields still
matches. Documented in `docs/overview.md`; consumers that must protect a single
attribute pass `"acl:field"`.
