import type { ErrorMeta } from "@comity/primitives/errors";

import { BaseError } from "@comity/primitives/errors";

/**
 * HTTP body error reasons.
 */
export type HttpBodyErrorReason = "empty_body" | "body_too_large" | "invalid_json";

/**
 * HTTP body error metadata.
 */
export interface HttpBodyErrorMeta extends ErrorMeta {
  /** The reason for the HTTP body error */
  readonly reason: HttpBodyErrorReason;

  /** Additional details about the error, if applicable */
  readonly details?: Readonly<{
    /** The maximum allowed body size in bytes, if applicable */
    maxBytes?: number;

    /** The actual body size in bytes, if applicable */
    actualBytes?: number;
  }>;
}

/** Error messages for HTTP body errors */
const REASON_MESSAGES: Record<HttpBodyErrorReason, string> = {
  empty_body: "Request body is empty",
  body_too_large: "Request body exceeds maximum allowed size",
  invalid_json: "Request body contains invalid JSON",
};

/** Recommended HTTP status codes for HTTP body errors */
const REASON_HTTP_STATUS: Record<HttpBodyErrorReason, number> = {
  empty_body: 400,
  body_too_large: 413,
  invalid_json: 400,
};

/**
 * HTTP Body Error.
 */
export class HttpBodyError extends BaseError<HttpBodyErrorMeta> {
  /** Error code */
  readonly code: `http:${HttpBodyErrorReason}`;

  /**
   * @param reason - The reason for the HTTP body error.
   * @param meta - Additional metadata for the error.
   */
  constructor(reason: HttpBodyErrorReason, meta?: Omit<HttpBodyErrorMeta, "reason">) {
    super(REASON_MESSAGES[reason], {
      httpStatus: REASON_HTTP_STATUS[reason],
      ...meta,
      reason,
    });

    this.code = `http:${reason}`;
  }
}
