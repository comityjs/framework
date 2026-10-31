import type { AuthorizationContext } from "../authorization-context.js";
import type { Authorizer } from "../authorizer.js";

import { isSuccess, success } from "@comity/primitives/result";
import { describe, expect, expectTypeOf, it } from "vitest";

/**
 * Authorizer that supports no authorization dimension beyond the contract.
 *
 * @remarks
 * It declares nothing but subject, action, resource, and the opaque context, and
 * it reads none of it: the point of this double is to prove that an
 * implementation without field-level (or any other) extension keeps compiling
 * and keeps behaving as before.
 */
class ResourceWideAuthorizer implements Authorizer {
  /**
   * Evaluate a resource-wide question.
   *
   * @param context - Subject, action, resource, and opaque contextual data
   *
   * @returns Allowed for `read`, denied otherwise
   */
  async authorize(context: {
    readonly subject: string;
    readonly action: string;
    readonly resource: string;
    readonly context?: Readonly<Record<string, unknown>>;
  }) {
    return success({ allowed: context.action === "read" });
  }
}

describe("AuthorizationContext", () => {
  it("requires only subject, action, and resource", () => {
    const context: AuthorizationContext = {
      subject: "user:123",
      action: "update",
      resource: "Task",
    };

    expect(Object.keys(context)).toEqual(["subject", "action", "resource"]);
    expect(context.context).toBeUndefined();
  });

  it("accepts arbitrary opaque contextual data", () => {
    const context: AuthorizationContext = {
      subject: "user:123",
      action: "update",
      resource: "Task",
      context: {
        tenant: "Project:123",
        ownerId: "user:123",
        attributes: ["title"],
        nested: { region: "eu" },
      },
    };

    // The core neither validates nor interprets the record.
    expect(context.context).toEqual({
      tenant: "Project:123",
      ownerId: "user:123",
      attributes: ["title"],
      nested: { region: "eu" },
    });
  });

  it("prescribes no field-level property", () => {
    expectTypeOf<AuthorizationContext>().not.toHaveProperty("field");
    expectTypeOf<AuthorizationContext>().not.toHaveProperty("fields");
    expectTypeOf<AuthorizationContext>().toHaveProperty("context");
    expectTypeOf<AuthorizationContext["context"]>().toEqualTypeOf<
      Readonly<Record<string, unknown>> | undefined
    >();
  });

  it("lets a caller pass contextual data the implementation ignores", async () => {
    const authorizer: Authorizer = new ResourceWideAuthorizer();

    const result = await authorizer.authorize({
      subject: "user:123",
      action: "read",
      resource: "Task",
      context: { "acl:field": "sprintUid", tenant: "Project:123" },
    });

    expect(isSuccess(result)).toBe(true);

    if (isSuccess(result)) {
      // The implementation documents that it ignores contextual data and answers
      // the resource-wide question; the core contract does not promise more.
      expect(result.value).toEqual({ allowed: true });
    }
  });

  it("keeps subject, action, and resource semantics", async () => {
    const authorizer: Authorizer = new ResourceWideAuthorizer();

    const allowed = await authorizer.authorize({
      subject: "user:123",
      action: "read",
      resource: "Task",
    });
    const denied = await authorizer.authorize({
      subject: "user:123",
      action: "update",
      resource: "Task",
    });

    expect(isSuccess(allowed) && allowed.value.allowed).toBe(true);
    expect(isSuccess(denied) && denied.value.allowed).toBe(false);
  });
});
