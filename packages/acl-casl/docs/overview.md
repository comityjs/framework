# @comity/acl-casl — Overview

`@comity/acl-casl` implements the `@comity/acl` `Authorizer` contract on top of a
CASL `MongoAbility`.

## How a context becomes a CASL check

1. `context.resource` becomes the CASL subject type: the adapter creates a class
   named after the resource and caches it per resource.
2. `context.context` becomes the subject's fields, so CASL conditions
   (`{ tenant: "T1" }`, `{ ownerId: "user:123" }`) are evaluated against them.
3. `context.context["acl:field"]`, when present, narrows the check to that
   attribute; when absent, the resource-wide check runs.

`@comity/acl` prescribes no field-level dimension. The `acl:field` key is this
adapter's own convention, documented here and nowhere else: the core only says
that `context` is opaque and interpreted by the implementation.

## Field-scoped questions

```ts
// ability: can('update', 'Task', ['title'], { tenant: 'T1' })
await authorizer.authorize({
  subject: actor.uid,
  action: "update",
  resource: "Task",
  context: { tenant: "Project:123", "acl:field": "sprintUid" },
});
// → { allowed: false }
```

The directive is reserved: it is removed before the CASL subject is built, so a
policy condition can never match on it, and the caller's own object is left
untouched. It is also validated — a directive that is not a non-blank string is
reported as `internal_error`, never ignored, because dropping a restriction would
answer a wider question than the caller asked.

## The "no directive" caveat

CASL without a field answers "may this subject do this to the resource at all?",
and a rule restricted to some fields still counts as a match:

```ts
can("update", "Task", ["title"], { tenant: "T1" });

ability.can("update", task, "title"); // true
ability.can("update", task, "sprintUid"); // false
ability.can("update", task); // true — any matching rule counts
```

That is what "the question covers the resource as a whole" means, and it is also
why omitting `acl:field` widens a request. Ask with the directive whenever the
decision protects a specific attribute.

Conditions and fields compose: a permitted field is still denied when the subject
condition does not hold, and a `cannot` rule with fields
(`cannot('update', 'Task', ['sprintUid'])`) removes one field from a broader
`can`.

## Example (multi-tenant ticketing)

```ts
import { AbilityBuilder, createMongoAbility } from "@casl/ability";
import { CaslAuthorizer } from "@comity/acl-casl";

const { can, cannot, build } = new AbilityBuilder(createMongoAbility);

// Customers may edit their own tickets, but never assign sprints.
can("update", "Task", ["title", "description"], { tenant: "Project:123" });
cannot("update", "Task", ["sprintUid"]);

// Staff may edit everything in the same tenant.
can("update", "Task", { tenant: "Project:123", role: "staff" });

const authorizer = new CaslAuthorizer(build());
```

## Errors

- A denial is `success({ allowed: false })` with the stable reason
  `"Authorization denied by policy"`. The reason does not mention the field, so it
  stays stable and greppable.
- An exception thrown by CASL becomes `failure(AuthorizationError)` with
  `reason: "internal_error"`, `details.wrappedReason`, and the original error as
  `cause`. A malformed directive is reported the same way. `authorize()` never
  throws.

## Follow-up

A batch form — several target attributes answered in one call — is not part of
this adapter. If a consumer needs it, the data would travel in `context` like the
single directive does, and nothing in `@comity/acl` would have to change.
