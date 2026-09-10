import type { Result } from "@comity/primitives/result";

import { failure, success } from "@comity/primitives/result";
import { HttpBodyError } from "./errors/body.js";

/**
 * Options for reading a JSON body.
 */
export type ReadJsonBodyOptions = {
  /** Maximum allowed body size in bytes (default: 1 MiB) */
  readonly maxBytes?: number;
};

/**
 * Reads and parses a JSON body from a raw stream.
 *
 * Consumes the stream exactly once, enforces a configurable size limit,
 * handles UTF-8 decoding across chunk boundaries, and returns a Result
 * distinguishing between empty body, oversized body, and malformed JSON.
 *
 * @param rawBody - The raw body stream from the HTTP request
 * @param options - Configuration options
 *
 * @returns Promise resolving to Result with parsed JSON or HttpBodyError
 */
export async function readJsonBody(
  rawBody: ReadableStream<Uint8Array> | null | undefined,
  options: ReadJsonBodyOptions = {}
): Promise<Result<unknown, HttpBodyError>> {
  const maxBytes = options.maxBytes ?? 1024 * 1024;

  if (!rawBody) {
    return failure(
      new HttpBodyError("empty_body", {
        details: { maxBytes },
      })
    );
  }

  let bytesRead = 0;
  let jsonString = "";
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  try {
    const decoder = new TextDecoder();
    reader = rawBody.getReader();

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      bytesRead += value.length;

      if (bytesRead > maxBytes) {
        reader.releaseLock();
        reader = null;

        return failure(
          new HttpBodyError("body_too_large", {
            details: { maxBytes, actualBytes: bytesRead },
          })
        );
      }

      jsonString += decoder.decode(value, { stream: true });
    }

    jsonString += decoder.decode();

    if (jsonString.trim() === "") {
      return failure(
        new HttpBodyError("empty_body", {
          details: { maxBytes },
        })
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(jsonString);
    } catch {
      return failure(
        new HttpBodyError("invalid_json", {
          details: { maxBytes },
        })
      );
    }

    return success(data);
  } catch (error) {
    if (reader) {
      reader.releaseLock();
    }

    if (error instanceof HttpBodyError) {
      return failure(error);
    }

    return failure(
      new HttpBodyError("invalid_json", {
        details: { maxBytes },
      })
    );
  }
}
