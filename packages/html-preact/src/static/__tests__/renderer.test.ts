import { DefaultHtmlLayoutCollector } from "@comity/html";
import { h } from "preact";
import { beforeEach, describe, expect, it } from "vitest";
import { PreactStaticHtmlRenderer } from "../renderer.js";

describe("PreactStaticHtmlRenderer", () => {
  let renderer: PreactStaticHtmlRenderer;

  /**
   * Decodes a rendered byte stream into a string.
   *
   * @param stream - The rendered body stream
   *
   * @returns The decoded document
   */
  async function readBody(stream: ReadableStream<Uint8Array>): Promise<string> {
    const decoder = new TextDecoder();
    let html = "";
    const reader = stream.getReader();

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      html += decoder.decode(value, { stream: true });
    }

    return html + decoder.decode();
  }

  beforeEach(() => {
    renderer = new PreactStaticHtmlRenderer();
  });

  describe("render", () => {
    it("should render a simple Preact element to HTML", async () => {
      const collector = new DefaultHtmlLayoutCollector();
      const element = h("div", { "data-testid": "test" }, "Hello World");
      const result = await renderer.render(element, collector);

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.value.contentType).toBe("text/html; charset=utf-8");
        expect(await readBody(result.value.body)).toContain(
          '<div data-testid="test">Hello World</div>'
        );
      }
    });

    it("should expose the document content type", async () => {
      const collector = new DefaultHtmlLayoutCollector();
      const element = h("div", null, "Test");
      const result = await renderer.render(element, collector);

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.value.contentType).toBe("text/html; charset=utf-8");
      }
    });

    it("should return a render_error result when rendering throws", async () => {
      const collector = new DefaultHtmlLayoutCollector();
      const Boom = () => {
        throw new Error("Rendering failed");
      };
      const element = h(Boom);
      const result = await renderer.render(element, collector);

      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.error.code).toBe("html:render_error");
        expect(result.error.meta.reason).toBe("render_error");
        expect(result.error.meta.context).toEqual({
          renderer: "preact",
          mode: "static",
          layout: expect.stringContaining("Rendering failed"),
        });
      }
    });
  });
});
