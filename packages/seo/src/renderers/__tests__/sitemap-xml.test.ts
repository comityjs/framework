import type { SitemapUrl } from "../../contracts/sitemap.js";

import { describe, expect, it } from "vitest";
import { createSitemapStream, generateSitemapLines } from "../sitemap-xml.js";

async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();

    if (done) break;

    result += decoder.decode(value, { stream: true });
  }

  return result;
}

/** Joins the generator output into a single sitemap XML string. */
function renderLines(urls: readonly SitemapUrl[]): string {
  return Array.from(generateSitemapLines(urls)).join("");
}

describe("generateSitemapLines", () => {
  it("returns valid empty urlset for empty array", () => {
    const result = renderLines([]);

    expect(result).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        "</urlset>"
    );
  });

  it("renders single URL with only required loc", () => {
    const urls: readonly SitemapUrl[] = [{ loc: "https://example.com/page" }];
    const result = renderLines(urls);

    expect(result).toContain("<loc>https://example.com/page</loc>");
    expect(result).not.toContain("<lastmod>");
    expect(result).not.toContain("<changefreq>");
    expect(result).not.toContain("<priority>");
  });

  it("renders multiple URLs preserving input order", () => {
    const urls: readonly SitemapUrl[] = [
      { loc: "https://example.com/a" },
      { loc: "https://example.com/b" },
      { loc: "https://example.com/c" },
    ];
    const result = renderLines(urls);
    const locA = result.indexOf("https://example.com/a");
    const locB = result.indexOf("https://example.com/b");
    const locC = result.indexOf("https://example.com/c");

    expect(locA).toBeLessThan(locB);
    expect(locB).toBeLessThan(locC);
  });

  it("renders lastmod with Date object as YYYY-MM-DD", () => {
    const urls: readonly SitemapUrl[] = [
      { loc: "https://example.com/page", lastmod: new Date("2024-03-15T10:30:00Z") },
    ];
    const result = renderLines(urls);

    expect(result).toContain("<lastmod>2024-03-15</lastmod>");
  });

  it("renders lastmod with string value as-is", () => {
    const urls: readonly SitemapUrl[] = [
      { loc: "https://example.com/page", lastmod: "2024-01-01" },
    ];
    const result = renderLines(urls);

    expect(result).toContain("<lastmod>2024-01-01</lastmod>");
  });

  it("renders changefreq when provided", () => {
    const urls: readonly SitemapUrl[] = [{ loc: "https://example.com/page", changefreq: "weekly" }];
    const result = renderLines(urls);

    expect(result).toContain("<changefreq>weekly</changefreq>");
  });

  it("renders numeric priority", () => {
    const urls: readonly SitemapUrl[] = [{ loc: "https://example.com/page", priority: 0.8 }];
    const result = renderLines(urls);

    expect(result).toContain("<priority>0.8</priority>");
  });

  it("renders string priority", () => {
    const urls: readonly SitemapUrl[] = [{ loc: "https://example.com/page", priority: "0.5" }];
    const result = renderLines(urls);

    expect(result).toContain("<priority>0.5</priority>");
  });

  it("omits undefined optional fields", () => {
    const urls: readonly SitemapUrl[] = [
      { loc: "https://example.com/a", lastmod: "2024-01-01" },
      { loc: "https://example.com/b", changefreq: "daily" },
      { loc: "https://example.com/c", priority: 0.9 },
    ];
    const result = renderLines(urls);

    expect(result.split("<lastmod>").length).toBe(2);
    expect(result.split("<changefreq>").length).toBe(2);
    expect(result.split("<priority>").length).toBe(2);
  });

  it("escapes XML-special characters in loc", () => {
    const urls: readonly SitemapUrl[] = [{ loc: "https://example.com/page?a=1&b=2" }];
    const result = renderLines(urls);

    expect(result).toContain("<loc>https://example.com/page?a=1&amp;b=2</loc>");
  });

  it("escapes XML-special characters in lastmod", () => {
    const urls: readonly SitemapUrl[] = [
      { loc: "https://example.com/page", lastmod: "2024-01-01<script>" },
    ];
    const result = renderLines(urls);

    expect(result).toContain("<lastmod>2024-01-01&lt;script&gt;</lastmod>");
  });

  it("escapes XML-special characters in changefreq", () => {
    const urls: readonly SitemapUrl[] = [
      // @ts-expect-error
      { loc: "https://example.com/page", changefreq: "hourly<test>" },
    ];
    const result = renderLines(urls);

    expect(result).toContain("<changefreq>hourly&lt;test&gt;</changefreq>");
  });

  it("escapes XML-special characters in priority", () => {
    const urls: readonly SitemapUrl[] = [{ loc: "https://example.com/page", priority: "1.0&0.5" }];
    const result = renderLines(urls);

    expect(result).toContain("<priority>1.0&amp;0.5</priority>");
  });

  it("escapes less-than sign in loc", () => {
    const urls: readonly SitemapUrl[] = [{ loc: "https://example.com/page<script>" }];
    const result = renderLines(urls);

    expect(result).toContain("<loc>https://example.com/page&lt;script&gt;</loc>");
  });

  it("escapes greater-than sign in loc", () => {
    const urls: readonly SitemapUrl[] = [{ loc: "https://example.com/page>test" }];
    const result = renderLines(urls);

    expect(result).toContain("<loc>https://example.com/page&gt;test</loc>");
  });

  it("escapes double quote in loc", () => {
    const urls: readonly SitemapUrl[] = [{ loc: 'https://example.com/page"test' }];
    const result = renderLines(urls);

    expect(result).toContain('<loc>https://example.com/page&quot;test</loc>');
  });

  it("escapes single quote in loc", () => {
    const urls: readonly SitemapUrl[] = [{ loc: "https://example.com/page'test" }];
    const result = renderLines(urls);

    expect(result).toContain("<loc>https://example.com/page&apos;test</loc>");
  });

  it("produces deterministic output for same input", () => {
    const urls: readonly SitemapUrl[] = [
      { loc: "https://example.com/b" },
      { loc: "https://example.com/a" },
    ];
    const result1 = renderLines(urls);
    const result2 = renderLines(urls);

    expect(result1).toBe(result2);
  });

  it("uses explicit LF line endings", () => {
    const urls: readonly SitemapUrl[] = [
      { loc: "https://example.com/a" },
      { loc: "https://example.com/b" },
    ];
    const result = renderLines(urls);

    expect(result).not.toContain("\r");
    expect(result.split("\n").length).toBeGreaterThan(5);
  });

  it("includes XML declaration and namespace", () => {
    const urls: readonly SitemapUrl[] = [{ loc: "https://example.com/page" }];
    const result = renderLines(urls);

    expect(result.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(result).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
  });

  it("renders complete example with all fields", () => {
    const urls: readonly SitemapUrl[] = [
      {
        loc: "https://example.com/page",
        lastmod: new Date("2024-06-15T12:00:00Z"),
        changefreq: "weekly",
        priority: 0.8,
      },
    ];
    const result = renderLines(urls);

    expect(result).toContain("<loc>https://example.com/page</loc>");
    expect(result).toContain("<lastmod>2024-06-15</lastmod>");
    expect(result).toContain("<changefreq>weekly</changefreq>");
    expect(result).toContain("<priority>0.8</priority>");
  });
});

describe("createSitemapStream", () => {
  it("produces the same output as generateSitemapLines", async () => {
    const urls: readonly SitemapUrl[] = [
      { loc: "https://example.com/stream", lastmod: "2024-01-01", priority: 0.4 },
    ];

    const stream = createSitemapStream(urls);
    const result = await streamToString(stream);

    expect(result).toBe(renderLines(urls));
  });

  it("handles empty urls array efficiently", async () => {
    const stream = createSitemapStream([]);
    const result = await streamToString(stream);

    expect(result).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        "</urlset>"
    );
  });
});
