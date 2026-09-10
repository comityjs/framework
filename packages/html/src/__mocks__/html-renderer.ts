import type { HtmlRenderResult } from "../contracts/render-result.js";
import type { HtmlRenderer } from "../contracts/renderer.js";

import { HtmlError } from "../errors/html.js";

/**
 * Mock HTML renderer for testing purposes
 */
export class MockRenderer implements HtmlRenderer<unknown> {
  constructor(private shouldSucceed: boolean = true) {}

  /**
   * @param view - The view to render
   * @param collector - The layout collector (ignored in this mock)
   * @param options - Render options (ignored in this mock)
   *
   * @returns A successful render result if `shouldSucceed` is true, otherwise an error
   */
  async render(view: unknown, collector: unknown, options?: undefined): Promise<HtmlRenderResult> {
    if (this.shouldSucceed) {
      const payload = new TextEncoder().encode(`<div>${view}</div>`);
      const body = new ReadableStream<Uint8Array>({
        /** @inheritdoc */
        start(controller) {
          controller.enqueue(payload);
          controller.close();
        },
      });

      return {
        ok: true,
        value: {
          body,
          contentType: "text/html; charset=utf-8",
        },
      };
    } else {
      return {
        ok: false,
        error: new HtmlError("render_error"),
      };
    }
  }
}
