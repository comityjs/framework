import type { HtmlLayoutCollector } from "./layout.js";
import type { HtmlRenderResult } from "./render-result.js";

/**
 * HTML render options
 */
export interface HtmlRendererOptions {
  /** Time in milliseconds before rendering is considered timed out. */
  readonly timeout?: number;
}

/**
 * HTML renderer contract
 */
export interface HtmlRenderer<T> {
  /**
   * Attempts to render the given view.
   *
   * @param view - HTML view to render
   * @param collector - HTML layout collector
   * @param options - Render options
   *
   * @returns Render result
   *
   * @typeparam T - Type of HTML view
   */
  render(
    view: T,
    collector: HtmlLayoutCollector,
    options?: HtmlRendererOptions
  ): Promise<HtmlRenderResult>;
}
