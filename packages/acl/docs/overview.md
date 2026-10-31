# @comity/acl — Overview

`@comity/acl` defines the authorization contracts shared by Comity packages.

It answers one question, and nothing more:

```text
Can <subject> perform <action> on <resource> [under <context>]?
```

## Contracts

| Contract                | Role                                                            |
| ----------------------- | --------------------------------------------------------------- |
| `AuthorizationContext`  | The question: subject, action, resource, optional context       |
| `AuthorizationDecision` | The answer: `allowed`, plus an optional human-readable `reason` |
| `Authorizer`            | The capability that evaluates a context                         |
| `AuthorizationError`    | Infrastructure failure (`internal_error`)                       |

## Denial is not an error

A denial is a successful `Result` with `allowed: false`. Only infrastructure or
provider failures produce an `AuthorizationError`. Consumers branch on
`result.success` first and on `result.value.allowed` second.

## `context` is the only extension point

The contract prescribes three identifying dimensions — `subject`, `action`,
`resource` — plus one opaque record:

```ts
export interface AuthorizationContext {
  readonly subject: string;
  readonly action: string;
  readonly resource: string;
  readonly context?: Readonly<Record<string, unknown>>;
}
```

`context` carries whatever the policy needs and the caller can supply: tenant,
owner, organizational scope, feature flags, the attributes an action targets,
and so on. Its structure and interpretation belong to the authorizer
implementation and the Application Layer.

What the core guarantees, and what it does not:

- ✅ the record is passed through untouched and never validated;
- ✅ an implementation may read any key it documents;
- ❌ no shared schema, no reserved keys, no required keys;
- ❌ no prescribed authorization dimensions beyond subject, action, resource.

The core does not prescribe field-level authorization, ownership checks, tenant
isolation, or role models. Those are capabilities of individual implementations:
an adapter can offer field-level checks by reading a documented key from
`context`, while an RBAC or ABAC implementation can ignore `context` entirely.

## Example

```ts
import type { Authorizer } from "@comity/acl";

async function assertCanUpdate(acl: Authorizer, uid: string, tenant: string) {
  const result = await acl.authorize({
    subject: uid,
    action: "update",
    resource: "Task",
    context: { tenant },
  });

  if (!result.success) {
    throw result.error; // infrastructure failure, not a policy denial
  }

  if (!result.value.allowed) {
    throw new Error(result.value.reason ?? "Not allowed");
  }
}
```

Which keys an implementation honours — including any key that narrows the
question to a single attribute — is documented by that implementation, not by
this contract.
