import type { HtmlLayoutCollector, HtmlRenderer, HtmlRenderResult } from "@comity/html";
import type { VNode } from "preact";
import type { HtmlPreactRendererOptions } from "../../types.js";

import { createDefaultHtmlDocumentWriter } from "@comity/html";
import { HtmlError } from "@comity/html/errors";
import { Readable } from "node:stream";
import { render } from "preact-render-to-string";
import { LayoutProvider } from "../../layout.js";

/**
 * Preact streaming HTML renderer (Node)
 */
export class PreactStreamingHtmlRenderer implements HtmlRenderer<VNode> {
  /** @inheritdoc */
  async render(
    view: VNode,
    collector: HtmlLayoutCollector,
    options?: HtmlPreactRendererOptions
  ): Promise<HtmlRenderResult> {
    const tree = <LayoutProvider collector={collector}>{view}</LayoutProvider>;
    const abort = () => {};

    try {
      const body = render(tree);
      const writer = createDefaultHtmlDocumentWriter(
        {
          headTags: collector.headTags,
          htmlAttrs: collector.htmlAttrs,
          bodyAttrs: collector.bodyAttrs,
        },
        options
      );
      const html = writer.writeLayoutOpen() + body + writer.writeLayoutClose();
      const nodeStream = Readable.from([html]);

      return {
        ok: true,
        value: {
          body: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
          contentType: "text/html; charset=utf-8",
          abort,
        },
      };
    } catch (cause) {
      return {
        ok: false,
        error: new HtmlError("render_error", {
          cause,
          context: {
            renderer: "preact",
            mode: "node-streaming",
            layout: String(view.type || "unknown"),
          },
        }),
      };
    }
  }
}
