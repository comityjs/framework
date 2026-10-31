/**
 * Context required to evaluate an authorization decision.
 *
 * The ACL module is intentionally generic: it does not interpret the
 * meaning of subject, action, resource, or context. It only provides
 * the semantic structure for the authorization question:
 *
 *   "Can <subject> perform <action> on <resource> [under <context>]?"
 *
 * All commercial, organizational, and policy-specific interpretation
 * belongs to the Application Layer.
 */
export interface AuthorizationContext {
  /** The subject requesting authorization. */
  readonly subject: string;

  /** The action being requested. */
  readonly action: string;

  /** The resource being accessed. */
  readonly resource: string;

  /**
   * Optional opaque contextual data for policy evaluation.
   *
   * @remarks
   * Its structure and interpretation belong to the authorizer implementation and
   * the Application Layer. The ACL module neither reads it nor imposes a schema
   * on it, and it guarantees nothing about which keys an implementation honours:
   * API-level authorization dimensions such as field-level permissions are
   * capabilities of individual implementations, not concepts of this contract.
   *
   * An implementation that ignores contextual data MUST keep the question it
   * answers unchanged and SHOULD document that it does so, because ignoring a
   * restriction narrows what the caller asked for.
   */
  readonly context?: Readonly<Record<string, unknown>>;
}
