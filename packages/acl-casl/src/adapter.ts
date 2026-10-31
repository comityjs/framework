import type { MongoAbility } from "@casl/ability";
import type { AuthorizationContext, AuthorizationDecision, Authorizer } from "@comity/acl";
import type { AuthorizationError } from "@comity/acl/errors";
import type { Result } from "@comity/primitives/result";

import { AuthorizationError as AuthorizationErrorClass } from "@comity/acl/errors";
import { failure, success } from "@comity/primitives/result";

/**
 * Context key this adapter reads to narrow a check to a single attribute.
 *
 * @remarks
 * Adapter-local convention, not part of `@comity/acl`. The Core contract carries
 * only `context`, so a caller that wants a field-scoped question supplies the
 * target attribute under this key; the key is reserved and never becomes a
 * subject attribute for condition evaluation.
 *
 * A request without the key is the resource-wide question, which is what every
 * caller asked before field-level support existed.
 */
const FIELD_CONTEXT_KEY = "acl:field";

/**
 * Build the failure reported for a directive that cannot name an attribute.
 *
 * @returns An `internal_error` authorization error
 *
 * @remarks
 * A directive that is present but blank or non-textual is a caller defect. It is
 * reported instead of ignored, because ignoring it would answer the resource-wide
 * question that the caller asked to narrow.
 */
function invalidDirectiveError(): AuthorizationError {
  return new AuthorizationErrorClass("internal_error", {
    details: {
      wrappedReason: `Invalid "${FIELD_CONTEXT_KEY}" directive in authorization context`,
    },
  });
}

/**
 * Convert an unexpected exception into the adapter's failure result.
 *
 * @param cause - Value thrown while resolving the directive, building the
 *   subject, or evaluating the ability
 *
 * @returns An `internal_error` authorization error carrying the cause
 */
function internalError(cause: unknown): AuthorizationError {
  return new AuthorizationErrorClass("internal_error", {
    details: {
      wrappedReason: cause instanceof Error ? cause.message : "unknown",
    },
    cause,
  });
}

/**
 * CASL-backed implementation of the {@link Authorizer} interface.
 *
 * This adapter wraps a CASL {@link Ability} and translates
 * {@link AuthorizationContext} into CASL's `can` evaluation.
 *
 * When `context` carries this adapter's field directive, the question is
 * narrowed to that attribute and CASL field-level rules decide it. Without the
 * directive, the resource-wide check runs exactly as before.
 *
 * `authorize()` never throws: directive resolution, subject construction, and the
 * ability call share one boundary, and any unexpected exception becomes an
 * `internal_error` failure.
 *
 * CASL-specific types (Ability, conditions, MongoQuery, field-level
 * permissions, etc.) remain encapsulated in this adapter and do not
 * leak into the Core ACL contracts.
 */
export class CaslAuthorizer implements Authorizer {
  readonly #ability: MongoAbility;
  readonly #subjectClassCache: Map<string, new (data: object) => object> = new Map();

  /**
   * @param ability - The CASL Ability instance to use for authorization.
   */
  constructor(ability: MongoAbility) {
    this.#ability = ability;
  }

  /**
   * @inheritdoc
   */
  async authorize(
    context: AuthorizationContext
  ): Promise<Result<AuthorizationDecision, AuthorizationError>> {
    try {
      const { subject, action, resource, context: authContext } = context;

      const directive = authContext?.[FIELD_CONTEXT_KEY];

      // A malformed directive is rejected instead of ignored: dropping a
      // restriction would answer a wider question than the caller asked.
      if (
        directive !== undefined &&
        (typeof directive !== "string" || directive.trim().length === 0)
      ) {
        return failure(invalidDirectiveError());
      }

      const field = typeof directive === "string" ? directive : undefined;

      // Build the CASL subject from resource and context
      // CASL evaluates conditions against subject instances.
      // We create a class dynamically for the resource type and instantiate it
      // with the context fields for condition evaluation.
      const caslSubject = this.#buildCaslSubject(resource, authContext);

      // A field narrows the question to that attribute of the resource. Without
      // one, CASL answers for the resource as a whole, where any matching rule
      // counts — including a rule restricted to some fields.
      const allowed =
        field === undefined
          ? this.#ability.can(action, caslSubject)
          : this.#ability.can(action, caslSubject, field);

      if (allowed) {
        return success({ allowed: true });
      }

      return success({ allowed: false, reason: "Authorization denied by policy" });
    } catch (error) {
      return failure(internalError(error));
    }
  }

  /**
   * Builds a CASL subject instance from the resource and optional context.
   *
   * The resource string becomes the CASL subject type (via class name).
   * The context fields become properties on the subject for condition evaluation.
   *
   * The adapter's own directive is removed: it tells this adapter which
   * attribute the caller targets, it is not an attribute of the resource, and a
   * policy condition must never match on it.
   *
   * @param resource - The resource type identifier.
   * @param context - Optional context fields for condition evaluation.
   *
   * @returns A subject instance for CASL evaluation.
   */
  #buildCaslSubject(
    resource: string,
    context: Readonly<Record<string, unknown>> | undefined
  ): object {
    const SubjectClass = this.#getOrCreateSubjectClass(resource);
    const data: Record<string, unknown> = context ? { ...context } : {};

    delete data[FIELD_CONTEXT_KEY];

    return new SubjectClass(data);
  }

  /**
   * Gets or creates a subject class for the given resource type.
   *
   * @param resource - The resource type identifier.
   *
   * @returns A class constructor for CASL subject instances.
   */
  #getOrCreateSubjectClass(resource: string): new (data: object) => object {
    const cached = this.#subjectClassCache.get(resource);
    if (cached) {
      return cached;
    }

    // Create a dynamic class with the resource as its name
    // CASL matches subject types by constructor name
    const SubjectClass = class {
      constructor(data: object) {
        Object.assign(this, data);
      }
    } as new (data: object) => object;

    // Set the name property for CASL type matching
    Object.defineProperty(SubjectClass, "name", { value: resource });

    this.#subjectClassCache.set(resource, SubjectClass);
    return SubjectClass;
  }
}
