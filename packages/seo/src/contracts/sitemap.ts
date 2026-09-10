/**
 * Sitemap change frequency values as defined by sitemaps.org.
 */
export type SitemapChangeFrequency =
  "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";

/**
 * A single URL entry in a sitemap.
 */
export interface SitemapUrl {
  /** Absolute URL of the page. */
  readonly loc: string;

  /** Last modification date (rendered as YYYY-MM-DD). */
  readonly lastmod?: Date | string;

  /** Change frequency hint for crawlers. */
  readonly changefreq?: SitemapChangeFrequency;

  /** Priority of this URL relative to other URLs on the site (0.0–1.0). */
  readonly priority?: string | number;
}
