import type { SitemapUrl } from "../contracts/sitemap.js";

import { escapeXml } from "../internal/escape-xml.js";

/**
 * Formats a Date or string as YYYY-MM-DD.
 *
 * @param date - Date or string to format
 *
 * @returns Formatted date string
 */
function formatLastmod(date: Date | string): string {
  if (date instanceof Date) {
    const parts = date.toISOString().split("T");

    return parts[0] ?? "";
  }

  return date;
}

/**
 * Generates sitemap XML lines one by one.
 * Yields already-formatted lines including line breaks where appropriate.
 */
export function* generateSitemapLines(urls: readonly SitemapUrl[]): Generator<string> {
  yield `<?xml version="1.0" encoding="UTF-8"?>\n`;
  yield `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

  if (urls.length === 0) {
    yield `</urlset>`;
    return;
  }

  for (const url of urls) {
    yield `  <url>\n`;
    yield `    <loc>${escapeXml(url.loc)}</loc>\n`;

    const lastmodValue = url.lastmod;
    if (lastmodValue !== undefined) {
      yield `    <lastmod>${escapeXml(formatLastmod(lastmodValue))}</lastmod>\n`;
    }

    if (url.changefreq) {
      yield `    <changefreq>${escapeXml(url.changefreq)}</changefreq>\n`;
    }

    if (url.priority !== undefined) {
      yield `    <priority>${escapeXml(String(url.priority))}</priority>\n`;
    }

    yield `  </url>\n`;
  }

  yield `</urlset>`;
}

/**
 * Creates a ReadableStream that emits the sitemap XML using a TextEncoder.
 * Works in Node.js, Bun, Cloudflare Workers and Deno (Web Streams API).
 */
export function createSitemapStream(urls: readonly SitemapUrl[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      // Use the generator to stream lines without building large arrays
      for (const line of generateSitemapLines(urls)) {
        controller.enqueue(encoder.encode(line));
      }

      controller.close();
    },
  });
}
