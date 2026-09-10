import { DefaultHtmlLayoutCollector } from "@comity/html";
import { createElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { ReactStreamingHtmlRenderer } from "../renderer.js";

describe("ReactStreamingHtmlRenderer (Node)", () => {
  let renderer: ReactStreamingHtmlRenderer;
  let collector: DefaultHtmlLayoutCollector;

  beforeEach(() => {
    renderer = new ReactStreamingHtmlRenderer();
    collector = new DefaultHtmlLayoutCollector();
  });

  describe("render", () => {
    it("should render a React element to a readable stream", async () => {
      const element = createElement("div", { "data-testid": "test" }, "Hello World");
      const result = await renderer.render(element, collector);

      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.value.body).toBeDefined();
        expect(result.value.contentType).toBe("text/html; charset=utf-8");
        expect(typeof result.value.abort).toBe("function");
      }
    });

    it("should stream the rendered document through the body", async () => {
      collector.setTitle("Node Stream");

      const element = createElement("div", null, "Hello Node");
      const result = await renderer.render(element, collector);

      expect(result.ok).toBe(true);

      if (result.ok) {
        const reader = result.value.body.getReader();
        const parts: string[] = [];

        while (true) {
          const { done, value } = await reader.read();

          if (done) break;

          parts.push(
            typeof value === "string"
              ? value
              : new TextDecoder().decode(value)
          );
        }

        const html = parts.join("");

        expect(html).toContain("<!DOCTYPE html>");
        expect(html).toContain("<title>Node Stream</title>");
        expect(html).toContain("<div>Hello Node</div>");
        expect(html).toContain("</body></html>");
      }
    });
  });
});
