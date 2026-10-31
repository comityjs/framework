---
"@comity/acl": patch
"@comity/acl-casl": minor
---

`CaslAuthorizer` supports field-level CASL rules: when `context` carries the
adapter's `acl:field` directive, the check becomes
`ability.can(action, subject, field)`, so rules such as
`can('update', 'Task', ['title'], { tenant })` can be queried precisely instead
of being encoded as separate fake actions. Without the directive the
two-argument call runs unchanged, so "field omitted" keeps the previous CASL
semantics, where a rule restricted to some fields still matches the resource-wide
question.

The directive is adapter-local, not part of `@comity/acl`: the Core contract keeps
`subject`, `action`, `resource`, and the optional opaque `context`, and gains no
authorization dimension. The directive is reserved (removed from a copy before
the CASL subject is built, so conditions cannot match on it and the caller's
context is not mutated) and validated — a value that is not a non-blank string is
reported as `internal_error` rather than ignored, because silently dropping a
restriction would answer a wider question than the caller asked. `authorize()`
resolves the directive, builds the subject, and evaluates the ability inside one
error boundary, so an unexpected runtime failure is reported as `internal_error`
instead of escaping.

Docs for both packages describe `context` as the only extension point, the
`acl:field` convention, the CASL no-directive caveat, and a multi-tenant ticket
example.
