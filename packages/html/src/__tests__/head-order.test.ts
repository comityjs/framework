import type { HtmlHeadTag } from "../contracts/head.js";

import { describe, expect, it } from "vitest";
import { orderHeadTags } from "../head-order.js";
import { createDefaultHtmlDocumentWriter } from "../writer.js";

describe("orderHeadTags", () => {
  it("orders a heterogeneous set of head tags deterministically", () => {
    const charset: HtmlHeadTag = { type: "meta", value: { charset: "utf-8" } };
    const viewport: HtmlHeadTag = {
      type: "meta",
      value: { name: "viewport", content: "width=device-width" },
    };
    const title: HtmlHeadTag = { type: "title", value: "My Page" };
    const base: HtmlHeadTag = { type: "base", value: { href: "/" } };
    const description: HtmlHeadTag = {
      type: "meta",
      value: { name: "description", content: "Desc" },
    };
    const robots: HtmlHeadTag = {
      type: "meta",
      value: { name: "robots", content: "index,follow" },
    };
    const og: HtmlHeadTag = { type: "meta", value: { property: "og:title", content: "OG title" } };
    const twitter: HtmlHeadTag = {
      type: "meta",
      value: { name: "twitter:card", content: "summary" },
    };
    const canonical: HtmlHeadTag = { type: "link", value: { rel: "canonical", href: "/en/" } };
    const hrefLang: HtmlHeadTag = {
      type: "link",
      value: { rel: "alternate", href: "/es/", hreflang: "es" },
    };
    const preload: HtmlHeadTag = {
      type: "link",
      value: { rel: "preload", href: "/font.woff2", as: "font" },
    };
    const modulePreload: HtmlHeadTag = {
      type: "link",
      value: { rel: "modulepreload", href: "/app.js" },
    };
    const preconnect: HtmlHeadTag = {
      type: "link",
      value: { rel: "preconnect", href: "https://cdn.example" },
    };
    const dnsPrefetch: HtmlHeadTag = {
      type: "link",
      value: { rel: "dns-prefetch", href: "https://dns.example" },
    };
    const stylesheet: HtmlHeadTag = { type: "link", value: { rel: "stylesheet", href: "/a.css" } };
    const style: HtmlHeadTag = { type: "style", value: { content: "body {}" } };
    const jsonLd: HtmlHeadTag = {
      type: "script",
      value: { type: "application/ld+json", content: "{}" },
    };
    const icon: HtmlHeadTag = { type: "link", value: { rel: "icon", href: "/favicon.ico" } };
    const metaOther: HtmlHeadTag = {
      type: "meta",
      value: { name: "theme-color", content: "#fff" },
    };
    const linkOther: HtmlHeadTag = {
      type: "link",
      value: { rel: "manifest", href: "/site.webmanifest" },
    };
    const moduleScript: HtmlHeadTag = {
      type: "script",
      value: { type: "module", src: "/module.js" },
    };
    const deferScript: HtmlHeadTag = { type: "script", value: { src: "/defer.js", defer: true } };
    const asyncScript: HtmlHeadTag = { type: "script", value: { src: "/async.js", async: true } };
    const syncScript: HtmlHeadTag = { type: "script", value: { src: "/sync.js" } };
    const noScript: HtmlHeadTag = { type: "noscript", value: { content: "JS required" } };

    const input = [
      noScript,
      syncScript,
      asyncScript,
      deferScript,
      moduleScript,
      linkOther,
      metaOther,
      icon,
      jsonLd,
      style,
      stylesheet,
      dnsPrefetch,
      preconnect,
      modulePreload,
      preload,
      hrefLang,
      canonical,
      twitter,
      og,
      robots,
      description,
      base,
      title,
      viewport,
      charset,
    ];

    expect(orderHeadTags(input)).toEqual([
      charset,
      viewport,
      title,
      base,
      description,
      robots,
      og,
      twitter,
      canonical,
      hrefLang,
      preload,
      modulePreload,
      dnsPrefetch,
      preconnect,
      stylesheet,
      style,
      jsonLd,
      icon,
      metaOther,
      linkOther,
      moduleScript,
      deferScript,
      asyncScript,
      syncScript,
      noScript,
    ]);
  });

  it("keeps the important relative ordering relationships", () => {
    const charset: HtmlHeadTag = { type: "meta", value: { charset: "utf-8" } };
    const viewport: HtmlHeadTag = {
      type: "meta",
      value: { name: "viewport", content: "width=device-width" },
    };
    const description: HtmlHeadTag = {
      type: "meta",
      value: { name: "description", content: "Desc" },
    };
    const canonical: HtmlHeadTag = { type: "link", value: { rel: "canonical", href: "/en/" } };
    const preload: HtmlHeadTag = {
      type: "link",
      value: { rel: "preload", href: "/font.woff2", as: "font" },
    };
    const stylesheet: HtmlHeadTag = { type: "link", value: { rel: "stylesheet", href: "/a.css" } };
    const jsonLd: HtmlHeadTag = {
      type: "script",
      value: { type: "application/ld+json", content: "{}" },
    };
    const syncScript: HtmlHeadTag = { type: "script", value: { src: "/sync.js" } };
    const noScript: HtmlHeadTag = { type: "noscript", value: { content: "JS required" } };

    const result = orderHeadTags([
      noScript,
      syncScript,
      jsonLd,
      stylesheet,
      preload,
      canonical,
      description,
      viewport,
      charset,
    ]);

    expect(result.indexOf(charset)).toBe(0);
    expect(result.indexOf(charset)).toBeLessThan(result.indexOf(viewport));
    expect(result.indexOf(viewport)).toBeLessThan(result.indexOf(description));
    expect(result.indexOf(description)).toBeLessThan(result.indexOf(canonical));
    expect(result.indexOf(canonical)).toBeLessThan(result.indexOf(preload));
    expect(result.indexOf(preload)).toBeLessThan(result.indexOf(stylesheet));
    expect(result.indexOf(stylesheet)).toBeLessThan(result.indexOf(jsonLd));
    expect(result.indexOf(jsonLd)).toBeLessThan(result.indexOf(syncScript));
    expect(result.indexOf(syncScript)).toBeLessThan(result.indexOf(noScript));
  });

  it("preserves the original relative order of tags with the same rank and type", () => {
    const themeA: HtmlHeadTag = { type: "meta", value: { name: "theme-color", content: "#111" } };
    const themeB: HtmlHeadTag = { type: "meta", value: { name: "theme-color", content: "#222" } };
    const manifestA: HtmlHeadTag = {
      type: "link",
      value: { rel: "manifest", href: "/a.webmanifest" },
    };
    const manifestB: HtmlHeadTag = {
      type: "link",
      value: { rel: "manifest", href: "/b.webmanifest" },
    };
    const appleTouch: HtmlHeadTag = {
      type: "link",
      value: { rel: "apple-touch-icon", href: "/touch.png" },
    };

    // themeA/B are META_OTHER and apple-touch-icon shares the LINK_ICON rank;
    // manifestA/B are LINK_OTHER. Same-rank tags keep their input order.
    const result = orderHeadTags([manifestB, themeA, appleTouch, manifestA, themeB]);

    expect(result).toEqual([appleTouch, themeA, themeB, manifestB, manifestA]);
  });

  it("keeps same-rank preconnect/dns-prefetch hints in their original order", () => {
    const preconnect: HtmlHeadTag = {
      type: "link",
      value: { rel: "preconnect", href: "https://cdn.example" },
    };
    const dnsPrefetch: HtmlHeadTag = {
      type: "link",
      value: { rel: "dns-prefetch", href: "https://dns.example" },
    };

    const result = orderHeadTags([dnsPrefetch, preconnect]);

    expect(result).toEqual([dnsPrefetch, preconnect]);
  });

  it("handles unrecognized head tags safely, sorting them after known tags", () => {
    const futureA = { type: "future-element", value: { id: "a" } } as unknown as HtmlHeadTag;
    const futureB = { type: "future-element", value: { id: "b" } } as unknown as HtmlHeadTag;
    const charset: HtmlHeadTag = { type: "meta", value: { charset: "utf-8" } };
    const noScript: HtmlHeadTag = { type: "noscript", value: { content: "JS required" } };

    const result = orderHeadTags([noScript, futureA, charset, futureB]);

    // Unknown tags survive unchanged, keep their relative order, and never throw.
    expect(result).toHaveLength(4);
    expect(result).toEqual([charset, noScript, futureA, futureB]);
  });

  it("orders unrecognized tags of different types by tag type name", () => {
    const alpha = { type: "alpha-element", value: { id: "a" } } as unknown as HtmlHeadTag;
    const zeta = { type: "zeta-element", value: { id: "z" } } as unknown as HtmlHeadTag;

    const result = orderHeadTags([zeta, alpha]);

    expect(result).toEqual([alpha, zeta]);
  });

  it("does not mutate the input array", () => {
    const input: HtmlHeadTag[] = [
      { type: "noscript", value: { content: "JS required" } },
      { type: "title", value: "My Page" },
      { type: "meta", value: { name: "description", content: "Desc" } },
    ];

    const result = orderHeadTags(input);

    expect(result).not.toBe(input);
    expect(input).toEqual([
      { type: "noscript", value: { content: "JS required" } },
      { type: "title", value: "My Page" },
      { type: "meta", value: { name: "description", content: "Desc" } },
    ]);
  });

  it("returns an empty array for empty input", () => {
    expect(orderHeadTags([])).toEqual([]);
  });
});

describe("createDefaultHtmlDocumentWriter", () => {
  it("keeps the insertion order unless the orderTags policy is opted in", () => {
    const state = {
      headTags: [
        { type: "meta", value: { name: "description", content: "Desc" } },
        { type: "title", value: "My Page" },
        { type: "link", value: { rel: "canonical", href: "/en/" } },
      ],
      htmlAttrs: undefined,
      bodyAttrs: undefined,
    };

    const defaultHtml = createDefaultHtmlDocumentWriter(state).writeLayoutOpen();

    expect(defaultHtml.indexOf("description")).toBeLessThan(defaultHtml.indexOf("<title>"));
    expect(defaultHtml.indexOf("<title>")).toBeLessThan(defaultHtml.indexOf("<link"));

    const orderedHtml = createDefaultHtmlDocumentWriter(state, {
      orderTags: orderHeadTags,
    }).writeLayoutOpen();

    expect(orderedHtml.indexOf("<title>")).toBeLessThan(orderedHtml.indexOf("description"));
    expect(orderedHtml.indexOf("description")).toBeLessThan(orderedHtml.indexOf("<link"));
  });
});
