import type { SafeErrorPayload } from "@comity/primitives/errors";

/**
 * Events emitted by the HTML runtime during the rendering process.
 */
export interface HtmlRendererObserver {
  /** Emitted when the rendering process starts. */
  onRenderStarted?(payload: {
    /** The name of the renderer that started rendering. */
    renderer: string;
  }): void;

  /**
   * Emitted when the rendering process completes successfully.
   */
  onRenderCompleted?(payload: {
    /** The name of the renderer that completed rendering. */
    renderer: string;

    /** The duration of the rendering process in milliseconds. */
    duration: number;
  }): void;

  /**
   * Emitted when the rendering process fails.
   */
  onRenderFailed?(payload: {
    /** The name of the renderer that failed rendering. */
    renderer: string;

    /** The duration of the rendering process in milliseconds. */
    duration: number;

    /** The reason for the rendering failure. */
    error: SafeErrorPayload;
  }): void;
}
