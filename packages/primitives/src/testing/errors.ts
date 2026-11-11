import type { ErrorMeta } from "../errors/types.js";

import { BaseError } from "../errors/base.js";

/**
 * Raised when the conformance kit cannot establish a test precondition (for example a setup save
 * that was expected to succeed did not). It signals a broken adapter or fixture, not a repository
 * contract violation, and always fails the running test.
 */
export class ConformanceError extends BaseError<ErrorMeta> {
  /** Namespaced error code. */
  readonly code = "testing:conformance_setup" as const;

  /**
   * @param message - What precondition failed.
   */
  constructor(message: string) {
    super(message, { reason: "conformance_setup" });
  }
}
