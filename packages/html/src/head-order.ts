import type { HtmlHeadLink, HtmlHeadMeta, HtmlHeadScript, HtmlHeadTag } from "./contracts/head.js";

/**
 * Rank constants used by the `orderHeadTags` policy.
 *
 * Lower values are rendered first in the HTML head.
 */
const HEAD_ORDER_RANK = {
  META_CHARSET: 0,
  META_VIEWPORT: 1,
  TITLE: 2,
  META_DESCRIPTION: 3,
  META_ROBOTS: 4,
  META_OG: 5,
  META_TWITTER: 6,
  LINK_CANONICAL: 7,
  LINK_HREFLANG: 8,
  LINK_PRELOAD: 9,
  LINK_MODULEPRELOAD: 10,
  LINK_PRECONNECT: 11,
  LINK_STYLESHEET: 12,
  STYLE: 13,
  SCRIPT_JSONLD: 14,
  LINK_ICON: 15,
  META_OTHER: 16,
  LINK_OTHER: 17,
  SCRIPT_MODULE: 18,
  SCRIPT_DEFER: 19,
  SCRIPT_ASYNC: 20,
  SCRIPT_SYNC: 21,
  NOSCRIPT: 30,
} as const;

/** Rank for `<base>` tags: right after the title, before meta descriptions. */
const BASE_RANK = 2.5;

/** Rank for unrecognized head tags; they sort last and are never dropped. */
const UNKNOWN_RANK = 100;

/**
 * Checks whether a meta tag declares a document charset.
 *
 * @param meta - The meta tag value to inspect.
 *
 * @returns Whether the meta tag declares a `charset`.
 */
function isCharset(meta: HtmlHeadMeta): boolean {
  return meta["charset"] !== undefined;
}

/**
 * Checks whether a meta tag declares a viewport.
 *
 * @param meta - The meta tag value to inspect.
 *
 * @returns Whether the meta tag name is `viewport`.
 */
function isViewport(meta: HtmlHeadMeta): boolean {
  return meta.name === "viewport";
}

/**
 * Checks whether a meta tag declares a page description.
 *
 * @param meta - The meta tag value to inspect.
 *
 * @returns Whether the meta tag name is `description`.
 */
function isDescription(meta: HtmlHeadMeta): boolean {
  return meta.name === "description";
}

/**
 * Checks whether a meta tag declares a robots policy.
 *
 * @param meta - The meta tag value to inspect.
 *
 * @returns Whether the meta tag name is `robots`.
 */
function isRobots(meta: HtmlHeadMeta): boolean {
  return meta.name === "robots";
}

/**
 * Checks whether a meta tag declares an Open Graph property.
 *
 * @param meta - The meta tag value to inspect.
 *
 * @returns Whether the meta tag property starts with `og:`.
 */
function isOg(meta: HtmlHeadMeta): boolean {
  return typeof meta.property === "string" && meta.property.startsWith("og:");
}

/**
 * Checks whether a meta tag declares a Twitter card property.
 *
 * @param meta - The meta tag value to inspect.
 *
 * @returns Whether the meta tag name starts with `twitter:`.
 */
function isTwitter(meta: HtmlHeadMeta): boolean {
  return typeof meta.name === "string" && meta.name.startsWith("twitter:");
}

/**
 * Checks whether a link tag declares a canonical URL.
 *
 * @param link - The link tag value to inspect.
 *
 * @returns Whether the link relation is `canonical`.
 */
function isCanonical(link: HtmlHeadLink): boolean {
  return link.rel === "canonical";
}

/**
 * Checks whether a link tag declares a language alternative.
 *
 * @param link - The link tag value to inspect.
 *
 * @returns Whether the link relation is `alternate` with an `hreflang`.
 */
function isHrefLang(link: HtmlHeadLink): boolean {
  return link.rel === "alternate" && link["hreflang"] !== undefined;
}

/**
 * Checks whether a link tag declares a preload hint.
 *
 * @param link - The link tag value to inspect.
 *
 * @returns Whether the link relation is `preload`.
 */
function isPreload(link: HtmlHeadLink): boolean {
  return link.rel === "preload";
}

/**
 * Checks whether a link tag declares a module preload hint.
 *
 * @param link - The link tag value to inspect.
 *
 * @returns Whether the link relation is `modulepreload`.
 */
function isModulePreload(link: HtmlHeadLink): boolean {
  return link.rel === "modulepreload";
}

/**
 * Checks whether a link tag declares a connection hint.
 *
 * @param link - The link tag value to inspect.
 *
 * @returns Whether the link relation is `preconnect` or `dns-prefetch`.
 */
function isPreconnect(link: HtmlHeadLink): boolean {
  return link.rel === "preconnect" || link.rel === "dns-prefetch";
}

/**
 * Checks whether a link tag declares a stylesheet.
 *
 * @param link - The link tag value to inspect.
 *
 * @returns Whether the link relation is `stylesheet`.
 */
function isStylesheet(link: HtmlHeadLink): boolean {
  return link.rel === "stylesheet";
}

/**
 * Checks whether a link tag declares a site icon.
 *
 * @param link - The link tag value to inspect.
 *
 * @returns Whether the link relation is `icon` or `apple-touch-icon`.
 */
function isIcon(link: HtmlHeadLink): boolean {
  return link.rel === "icon" || link.rel === "apple-touch-icon";
}

/**
 * Checks whether a script tag declares JSON-LD structured data.
 *
 * @param script - The script tag value to inspect.
 *
 * @returns Whether the script type is `application/ld+json`.
 */
function isJsonLd(script: HtmlHeadScript): boolean {
  return script["type"] === "application/ld+json";
}

/**
 * Checks whether a script tag is an ES module.
 *
 * @param script - The script tag value to inspect.
 *
 * @returns Whether the script type is `module`.
 */
function isModule(script: HtmlHeadScript): boolean {
  return script["type"] === "module";
}

/**
 * Checks whether a script tag defers execution.
 *
 * @param script - The script tag value to inspect.
 *
 * @returns Whether the script is marked as deferred.
 */
function isDefer(script: HtmlHeadScript): boolean {
  return script["defer"] === true;
}

/**
 * Checks whether a script tag loads asynchronously.
 *
 * @param script - The script tag value to inspect.
 *
 * @returns Whether the script is marked as async.
 */
function isAsync(script: HtmlHeadScript): boolean {
  return script["async"] === true;
}

/**
 * Gets the order rank for a head tag.
 *
 * @param tag - The head tag to rank
 *
 * @returns Numeric rank (lower = rendered first)
 */
function getHeadOrderRank(tag: HtmlHeadTag): number {
  switch (tag.type) {
    case "meta": {
      const meta = tag.value;

      if (isCharset(meta)) return HEAD_ORDER_RANK.META_CHARSET;
      if (isViewport(meta)) return HEAD_ORDER_RANK.META_VIEWPORT;
      if (isDescription(meta)) return HEAD_ORDER_RANK.META_DESCRIPTION;
      if (isRobots(meta)) return HEAD_ORDER_RANK.META_ROBOTS;
      if (isOg(meta)) return HEAD_ORDER_RANK.META_OG;
      if (isTwitter(meta)) return HEAD_ORDER_RANK.META_TWITTER;

      return HEAD_ORDER_RANK.META_OTHER;
    }
    case "title":
      return HEAD_ORDER_RANK.TITLE;
    case "link": {
      const link = tag.value;

      if (isCanonical(link)) return HEAD_ORDER_RANK.LINK_CANONICAL;
      if (isHrefLang(link)) return HEAD_ORDER_RANK.LINK_HREFLANG;
      if (isPreload(link)) return HEAD_ORDER_RANK.LINK_PRELOAD;
      if (isModulePreload(link)) return HEAD_ORDER_RANK.LINK_MODULEPRELOAD;
      if (isPreconnect(link)) return HEAD_ORDER_RANK.LINK_PRECONNECT;
      if (isStylesheet(link)) return HEAD_ORDER_RANK.LINK_STYLESHEET;
      if (isIcon(link)) return HEAD_ORDER_RANK.LINK_ICON;

      return HEAD_ORDER_RANK.LINK_OTHER;
    }
    case "style":
      return HEAD_ORDER_RANK.STYLE;
    case "script": {
      const script = tag.value;

      if (isJsonLd(script)) return HEAD_ORDER_RANK.SCRIPT_JSONLD;
      if (isModule(script)) return HEAD_ORDER_RANK.SCRIPT_MODULE;
      if (isDefer(script)) return HEAD_ORDER_RANK.SCRIPT_DEFER;
      if (isAsync(script)) return HEAD_ORDER_RANK.SCRIPT_ASYNC;

      return HEAD_ORDER_RANK.SCRIPT_SYNC;
    }
    case "noscript":
      return HEAD_ORDER_RANK.NOSCRIPT;
    case "base":
      return BASE_RANK;
    default:
      return UNKNOWN_RANK;
  }
}

/**
 * Compares two head tags according to the ordering policy.
 *
 * Tags are ordered by their order rank first. Tags with the same rank are
 * then ordered by tag type name; tags with the same rank and type compare
 * equal, leaving their original relative order untouched.
 *
 * @param a - First tag to compare
 * @param b - Second tag to compare
 *
 * @returns Negative if `a` should come before `b`, positive if after, 0 if equal
 */
function compareHeadTags(a: HtmlHeadTag, b: HtmlHeadTag): number {
  const rankA = getHeadOrderRank(a);
  const rankB = getHeadOrderRank(b);

  if (rankA !== rankB) {
    return rankA - rankB;
  }

  if (a.type !== b.type) {
    return a.type < b.type ? -1 : 1;
  }

  return 0;
}

/**
 * Orders an array of HTML head tags according to the recommended head-tag
 * ordering policy.
 *
 * The policy is opt-in: it is NOT applied automatically by the HTML document
 * writer. Pass it explicitly as `HtmlWriterOptions.orderTags` to use it.
 *
 * The policy is pure and non-mutating: the input array is never modified and
 * a new array is returned. Tags the policy does not recognize are preserved
 * unchanged and sorted after all recognized tags.
 *
 * @param tags - Head tags to order
 *
 * @returns A new array with the head tags ordered; the input is left untouched
 */
export function orderHeadTags(tags: HtmlHeadTag[]): HtmlHeadTag[] {
  return [...tags].sort(compareHeadTags);
}
