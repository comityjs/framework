import type { Result } from "@comity/primitives/result";
import type { HtmlError } from "../errors/html.js";

/**
 * Rendered HTML output.
 *
 * Contains rendering concerns only: the rendered document stream, its content
 * type, and renderer-owned cancellation.
 */
export interface HtmlOutput {
  /** Rendered document as a byte stream. */
  readonly body: ReadableStream<Uint8Array>;

  /** Content type of the rendered document (e.g. "text/html; charset=utf-8"). */
  readonly contentType: string;

  /** Cancels rendering. Renderer-owned lifecycle; not transport-specific. */
  readonly abort?: () => void;
}

/**
 * HTML render result type
 */
export type HtmlRenderResult = Result<HtmlOutput, HtmlError, "ok">;
