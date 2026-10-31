import { AbilityBuilder, createMongoAbility } from "@casl/ability";
import type { Ability, MongoAbility } from "@casl/ability";
import { isFailure, isSuccess } from "@comity/primitives/result";
import { describe, expect, it, vi } from "vitest";

import { AuthorizationError } from "@comity/acl/errors";
import { CaslAuthorizer } from "../adapter.js";

function makeAbility(rules?: Parameters<typeof Ability>[0]) {
  return createMongoAbility(rules ?? []);
}

/**
 * Build an ability through CASL's `AbilityBuilder`.
 *
 * @param define - Callback that declares `can` / `cannot` rules
 *
 * @returns A MongoAbility holding the declared rules
 */
function buildAbility(define: (builder: AbilityBuilder<MongoAbility>) => void): MongoAbility {
  const builder = new AbilityBuilder<MongoAbility>(createMongoAbility);
  define(builder);
  return builder.build();
}

describe("CaslAuthorizer", () => {
  it("allows when CASL can", async () => {
    const ability = makeAbility([
      { action: "read", subject: "Order", conditions: { tenant: "tenant-a" } },
    ]);
    const authorizer = new CaslAuthorizer(
      makeAbility([{ action: "read", subject: "Order", conditions: { tenant: "tenant-a" } }])
    );

    const result = await authorizer.authorize({
      subject: "user:123",
      action: "read",
      resource: "Order",
      context: { tenant: "tenant-a" },
    });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.value.allowed).toBe(true);
    }
  });

  it("denies when CASL cannot", async () => {
    const authorizer = new CaslAuthorizer(
      makeAbility([{ action: "read", subject: "Order", conditions: { tenant: "tenant-a" } }])
    );

    const result = await authorizer.authorize({
      subject: "user:123",
      action: "read",
      resource: "Order",
      context: { tenant: "tenant-b" },
    });

    expect(isSuccess(result)).toBe(true);
    if (isSuccess(result)) {
      expect(result.value.allowed).toBe(false);
      expect(result.value.reason).toBe("Authorization denied by policy");
    }
  });

  it("handles contextual conditions", async () => {
    const ability = makeAbility([
      { action: "manage", subject: "Order", conditions: { ownerId: "user:123" } },
    ]);
    const authorizer = new CaslAuthorizer(ability);

    const allowedResult = await authorizer.authorize({
      subject: "user:123",
      action: "manage",
      resource: "Order",
      context: { ownerId: "user:123" },
    });

    const deniedResult = await authorizer.authorize({
      subject: "user:456",
      action: "manage",
      resource: "Order",
      context: { ownerId: "user:789" },
    });

    expect(isSuccess(allowedResult)).toBe(true);
    if (isSuccess(allowedResult)) {
      expect(allowedResult.value.allowed).toBe(true);
    }

    expect(isSuccess(deniedResult)).toBe(true);
    if (isSuccess(deniedResult)) {
      expect(deniedResult.value.allowed).toBe(false);
    }
  });

  it("wraps CASL errors as internal_error", async () => {
    const failingAbility = {
      can: vi.fn().mockImplementation(() => {
        throw new Error("CASL internal error");
      }),
    } as any;

    const authorizer = new CaslAuthorizer(failingAbility);

    const result = await authorizer.authorize({
      subject: "user:123",
      action: "read",
      resource: "Order",
    });

    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error).toBeInstanceOf(AuthorizationError);
      expect(result.error.meta.reason).toBe("internal_error");
    }
  });

  describe("field-level authorization", () => {
    /**
     * Authorize one request against an ability.
     *
     * @param ability - Ability to evaluate against
     * @param field - Targeted attribute, passed through the adapter's context key
     * @param tenant - Tenant used as a condition attribute
     *
     * @returns Whether the request was allowed
     */
    async function allowed(
      ability: MongoAbility,
      field: string | undefined,
      tenant = "T1"
    ): Promise<boolean> {
      const authorizer = new CaslAuthorizer(ability);
      const result = await authorizer.authorize({
        subject: "user:123",
        action: "update",
        resource: "Task",
        context: { tenant, ...(field === undefined ? {} : { "acl:field": field }) },
      });

      expect(isSuccess(result)).toBe(true);

      return isSuccess(result) ? result.value.allowed : false;
    }

    it("allows any field when the rule is not field-restricted", async () => {
      const ability = buildAbility(({ can }) => {
        can("update", "Task", { tenant: "T1" });
      });

      expect(await allowed(ability, "title")).toBe(true);
      expect(await allowed(ability, "sprintUid")).toBe(true);
      expect(await allowed(ability, undefined)).toBe(true);
    });

    it("allows a permitted field and denies a restricted one", async () => {
      const ability = buildAbility(({ can }) => {
        can("update", "Task", ["title"], { tenant: "T1" });
      });

      expect(await allowed(ability, "title")).toBe(true);
      expect(await allowed(ability, "sprintUid")).toBe(false);
    });

    it("keeps the resource-wide answer when no field is given", async () => {
      // CASL semantics: without a field, any matching rule counts, including a
      // rule restricted to some fields. This preserves the pre-field behaviour.
      const ability = buildAbility(({ can }) => {
        can("update", "Task", ["title"], { tenant: "T1" });
      });

      expect(await allowed(ability, undefined)).toBe(true);
    });

    it("keeps conditions in force for a permitted field", async () => {
      const ability = buildAbility(({ can }) => {
        can("update", "Task", ["title"], { tenant: "T1" });
      });

      expect(await allowed(ability, "title", "T2")).toBe(false);
    });

    it("lets a cannot rule remove one field from a broader grant", async () => {
      const ability = buildAbility(({ can, cannot }) => {
        can("update", "Task", { tenant: "T1" });
        cannot("update", "Task", ["sprintUid"]);
      });

      expect(await allowed(ability, "title")).toBe(true);
      expect(await allowed(ability, "sprintUid")).toBe(false);
      expect(await allowed(ability, undefined)).toBe(true);
    });

    it("keeps a field restriction in force where the resource-wide answer allows", async () => {
      const ability = buildAbility(({ can }) => {
        can("update", "Task", ["title"], { tenant: "T1" });
      });

      // The resource-wide question is allowed (CASL counts any matching rule),
      // so the field-scoped denial is the only thing standing between a caller
      // and an unintended write.
      expect(await allowed(ability, undefined)).toBe(true);
      expect(await allowed(ability, "sprintUid")).toBe(false);
    });

    it("rejects a malformed directive instead of widening the question", async () => {
      const ability = buildAbility(({ can }) => {
        can("update", "Task", ["title"], { tenant: "T1" });
      });
      const authorizer = new CaslAuthorizer(ability);

      for (const directive of [42, null, { field: "title" }, ""]) {
        const result = await authorizer.authorize({
          subject: "user:123",
          action: "update",
          resource: "Task",
          context: { tenant: "T1", "acl:field": directive },
        });

        expect(isFailure(result)).toBe(true);

        if (isFailure(result)) {
          expect(result.error).toBeInstanceOf(AuthorizationError);
          expect(result.error.meta.reason).toBe("internal_error");
          expect(result.error.meta.details?.["wrappedReason"]).toContain("acl:field");
        }
      }
    });

    it("rejects a blank directive instead of answering the resource-wide question", async () => {
      const ability = buildAbility(({ can }) => {
        can("update", "Task", ["title"], { tenant: "T1" });
      });
      const authorizer = new CaslAuthorizer(ability);

      // Without the directive this ability allows the resource-wide question
      // (any matching rule counts), so a blank directive must not reach it.
      expect(await allowed(ability, undefined)).toBe(true);

      const result = await authorizer.authorize({
        subject: "user:123",
        action: "update",
        resource: "Task",
        context: { tenant: "T1", "acl:field": "   " },
      });

      expect(isSuccess(result)).toBe(false);

      if (isFailure(result)) {
        expect(result.error.meta.reason).toBe("internal_error");
        expect(result.error.meta.details?.["wrappedReason"]).toContain("acl:field");
      }
    });

    it("does not mutate the caller's context", async () => {
      const ability = buildAbility(({ can }) => {
        can("update", "Task", ["title"], { tenant: "T1" });
      });
      const authorizer = new CaslAuthorizer(ability);

      const context = { tenant: "T1", "acl:field": "title" };
      const snapshot = { ...context };

      const result = await authorizer.authorize({
        subject: "user:123",
        action: "update",
        resource: "Task",
        context,
      });

      expect(isSuccess(result) && result.value.allowed).toBe(true);
      // The adapter copies before stripping its own directive.
      expect(context).toEqual(snapshot);
      expect(context["acl:field"]).toBe("title");
    });

    it("wraps unexpected runtime failures raised outside the ability call", async () => {
      const ability = buildAbility(({ can }) => {
        can("update", "Task", ["title"], { tenant: "T1" });
      });
      const authorizer = new CaslAuthorizer(ability);

      // Reading the directive throws.
      const throwingDirective: Record<string, unknown> = { tenant: "T1" };
      Object.defineProperty(throwingDirective, "acl:field", {
        enumerable: true,
        get() {
          throw new Error("directive exploded");
        },
      });

      const directiveResult = await authorizer.authorize({
        subject: "user:123",
        action: "update",
        resource: "Task",
        context: throwingDirective,
      });

      // Copying the context into the subject throws.
      const throwingAttribute: Record<string, unknown> = {};
      Object.defineProperty(throwingAttribute, "tenant", {
        enumerable: true,
        get() {
          throw new Error("attribute exploded");
        },
      });

      const attributeResult = await authorizer.authorize({
        subject: "user:123",
        action: "update",
        resource: "Task",
        context: throwingAttribute,
      });

      expect(isFailure(directiveResult) && directiveResult.error.meta.reason).toBe(
        "internal_error"
      );
      expect(
        isFailure(directiveResult) && directiveResult.error.meta.details?.["wrappedReason"]
      ).toBe("directive exploded");
      expect(isFailure(attributeResult) && attributeResult.error.meta.reason).toBe(
        "internal_error"
      );
      expect(
        isFailure(attributeResult) && attributeResult.error.meta.details?.["wrappedReason"]
      ).toBe("attribute exploded");
    });

    it("keeps the directive out of the subject attributes", async () => {
      // A directive is metadata for the adapter, never a resource attribute: a
      // rule conditioned on it must not match.
      const ability = buildAbility(({ can }) => {
        can("update", "Task", { "acl:field": "title" });
      });

      expect(await allowed(ability, "title")).toBe(false);
    });

    it("wraps a failure raised while checking a field", async () => {
      const failingAbility = {
        can: vi.fn().mockImplementation(() => {
          throw new Error("CASL field error");
        }),
      } as any;

      const authorizer = new CaslAuthorizer(failingAbility);

      const result = await authorizer.authorize({
        subject: "user:123",
        action: "update",
        resource: "Task",
        context: { tenant: "T1", "acl:field": "sprintUid" },
      });

      expect(isFailure(result)).toBe(true);
      expect(failingAbility.can).toHaveBeenCalledTimes(1);
      expect(failingAbility.can.mock.calls[0]![2]).toBe("sprintUid");

      if (isFailure(result)) {
        expect(result.error).toBeInstanceOf(AuthorizationError);
        expect(result.error.meta.reason).toBe("internal_error");
        expect(result.error.meta.details?.["wrappedReason"]).toBe("CASL field error");
      }
    });
  });
});
