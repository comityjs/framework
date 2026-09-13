# Errors and Results

Comity models fallible operations through explicit typed outcomes rather than implicit thrown exceptions. Every operation that can fail returns a `Result<T, E>` representing either success or failure as a first-class value.

```text
operation
   ↓
Result<T, E>
   ├── success → T
   └── failure → E
```

This approach makes failure paths visible in the type signature, enforceable at boundaries, and predictable across layers.

---

## Result

`Result<T, E>` is a discriminated union representing the outcome of a fallible operation. It is defined in `@comity/primitives/result`:

```ts
import type { Result } from "@comity/primitives/result";
```

The type has two branches:

- **Success**: contains a `value` of type `T`
- **Failure**: contains an `error` of type `E` (constrained to `BaseError`)

The discriminator is the `success` property: `true` for success, `false` for failure.

---

## Success and Failure

### Creating Results

Use the factory functions to create results:

```ts
import { success, failure } from "@comity/primitives/result";

// Success: returns a Result with the value
const result = success(order);

// Failure: returns a Result with a BaseError
const result = failure(new OrderError("inconsistent_state"));
```

### Checking Results

Use the type guards to narrow the result:

```ts
import { isSuccess, isFailure } from "@comity/primitives/result";

if (isSuccess(result)) {
  // TypeScript knows result.value exists
  console.log(result.value);
} else {
  // TypeScript knows result.error exists
  console.error(result.error.code, result.error.message);
}
```

### Metadata

Success results can carry optional metadata:

```ts
const result = success(user, { cached: true, source: "redis" });
```

Metadata is preserved alongside the value for diagnostic or routing purposes without polluting the domain type.

---

## Errors as Domain Objects

In Comity, errors are structured domain objects rather than arbitrary thrown exceptions. This means:

- Errors carry stable, machine-readable codes
- Errors are typed and predictable at boundaries
- Errors can be inspected programmatically
- Errors are transport-agnostic by default

A domain error represents a known failure condition: `order:not_found`, `product:out_of_stock`, `payment:declined`. Each error type carries semantic meaning that downstream code can act upon.

---

## BaseError

`BaseError` is the foundation for all Comity errors. It is defined in `@comity/primitives/errors`:

```ts
import { BaseError } from "@comity/primitives/errors";
```

### Properties

- `code`: A stable `ErrorCode` following the `namespace:failure_kind` pattern (e.g., `user:not_found`)
- `message`: A human-readable error message
- `meta`: Frozen metadata object containing structured context

### Creating Custom Errors

Extend `BaseError` for domain-specific errors:

```ts
import type { ErrorMeta } from "@comity/primitives/errors";
import { BaseError } from "@comity/primitives/errors";

interface NotFoundErrorMeta extends ErrorMeta {
  resource?: string;
  id?: string;
}

class NotFoundError extends BaseError<NotFoundErrorMeta> {
  readonly code = "domain:not_found" as const;

  constructor(resource: string, id: string) {
    super(`${resource} not found`, {
      reason: "not_found",
      details: { resource, id },
    });
  }
}
```

### Error Metadata

`ErrorMeta` provides standard optional fields:

```ts
type ErrorMeta = Readonly<{
  httpStatus?: number;      // Associated HTTP status code
  reason?: string;          // Machine-readable reason
  cause?: unknown;          // Underlying cause for error chaining
  details?: Readonly<Record<string, unknown>>;  // Domain-specific context
  context?: Readonly<Record<string, unknown>>;  // Diagnostic runtime context
}>;
```

The `meta` object is frozen at construction time, preventing accidental mutation.

---

## Safe Error Payloads

When errors cross external boundaries (HTTP responses, message queues, logs), internal details must be stripped. Comity provides `toSafePayload` for this purpose:

```ts
import { toSafePayload } from "@comity/primitives/errors";

const safePayload = toSafePayload(error);
```

`toSafePayload` converts any error into a `SafeErrorPayload`:

```ts
type SafeErrorPayload = Readonly<{
  code: ErrorCode | "unknown";
  message: string;
  httpStatus?: number;
  timestamp?: string;
  reason?: string;
  details?: Readonly<Record<string, unknown>>;
  context?: Readonly<Record<string, unknown>>;
}>;
```

Key behaviors:

- **Stack traces are removed**: Internal stack information never crosses the boundary
- **Causes are removed**: Error chains are internal implementation details
- **Non-serializable values are stripped**: Only JSON-safe values survive
- **Unknown errors become `code: "unknown"`**: Non-BaseError values get a safe representation
- **Timestamps are added**: Each safe payload carries an ISO timestamp

This is an explicit boundary capability. Calling `toSafePayload` at the transport edge ensures internal errors never leak implementation details to external consumers.

---

## HTTP Errors

HTTP-specific errors live in `@comity/http/errors`, separate from domain errors:

```ts
import { HttpError, HttpBodyError } from "@comity/http/errors";
```

### Architectural Boundary

The separation is intentional:

```text
Domain errors (order:not_found)
        ↓
HTTP errors (http:invalid_lifecycle_state)
        ↓
Transport representation (404 Not Found)
```

- **Domain errors** express business logic failures
- **HttpError** expresses HTTP pipeline violations (contract violations, lifecycle errors)
- **HttpBodyError** expresses request body problems (empty body, invalid JSON, body too large)

### HttpError

```ts
class HttpError extends BaseError<HttpErrorMeta> {
  readonly code: `http:${HttpErrorReason}`;

  constructor(
    reason: HttpErrorReason,
    meta?: Omit<HttpErrorMeta, "reason">
  );
}
```

HTTP errors carry an `httpStatus` derived from the reason, and are used by the HTTP infrastructure—not by domain code.

---

## Result vs Exceptions

Comity favors explicit `Result` semantics for expected operation outcomes. This does not mean exceptions cannot exist in the runtime, but rather that:

| Scenario | Mechanism |
|----------|----------|
| Expected domain failure (validation, not found, conflict) | `Result` with domain error |
| Infrastructure/contract violation | Domain error or `HttpError` |
| Truly exceptional runtime condition (unrecoverable) | Exception at appropriate boundary |

The key distinction: **expected failures are part of the operation's contract and should be typed**.

---

## Recommended Practices

- **Return meaningful failures explicitly**: A `Result` with a domain error is clearer than a thrown exception or null
- **Use structured error codes**: Follow the `namespace:failure_kind` pattern for programmatic handling
- **Preserve error identity across layers**: Wrap or convert errors at boundaries; don't discard the original cause
- **Convert to safe payloads at transport edges**: Use `toSafePayload` before serializing errors externally
- **Keep HTTP concerns out of domain code**: Domain errors should not reference HTTP status codes directly; let the transport layer map them
- **Type error branches**: Let `isSuccess`/`isFailure` narrow the type; avoid manual discriminator checks

---

## Anti-Patterns

### Throwing arbitrary errors for expected domain failures

```ts
// Avoid
throw new Error("User not found");

// Prefer
return failure(new NotFoundError("user", id));
```

Arbitrary errors lose typed failure semantics and force callers to catch unknown exceptions.

### Returning unstructured strings as failures

```ts
// Avoid
return failure("Something went wrong");

// Prefer
class PaymentDeclinedError extends BaseError {
  readonly code = "payment:declined";
  constructor() { super("Payment declined", {}); }
}
return failure(new PaymentDeclinedError());
```

Structured errors preserve identity and enable programmatic handling downstream.

### Leaking internal errors directly to clients

```text
// Framework sketch (not executable Comity code): transport-edge error mapping.
// Avoid — leaking internal details
res.status(500).json({ error: internalError.stack });

// Prefer — convert to a safe payload before serializing
res.status(500).json(toSafePayload(internalError));
```

Safe payload conversion prevents implementation details from reaching external consumers.

### Making domain code depend on HTTP error types

```ts
// Avoid
import { HttpError } from "@comity/http/errors";

class OrderService {
  fail() { throw new HttpError("internal_error"); }
}

// Prefer
class OrderProcessingError extends BaseError {
  readonly code = "order:processing_failed";
  constructor() { super("Order processing failed", {}); }
}

class OrderService {
  fail() { return failure(new OrderProcessingError()); }
}
```

Domain code should express domain failures. HTTP mapping belongs at the transport boundary.

---

> **Pre-1.0 note**: The `Result` and error semantics described here reflect the current architectural intent. Public API signatures are subject to refinement as Comity matures toward 1.0.
