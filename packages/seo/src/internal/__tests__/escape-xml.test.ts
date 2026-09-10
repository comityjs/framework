import { describe, expect, it } from "vitest";
import { escapeXml } from "../escape-xml.js";

describe("escapeXml", () => {
  it("returns empty string for empty input", () => {
    expect(escapeXml("")).toBe("");
  });

  it("returns unchanged string when no special characters present", () => {
    expect(escapeXml("plain text 123 ABC xyz")).toBe("plain text 123 ABC xyz");
  });

  it("escapes ampersands to &amp;", () => {
    expect(escapeXml("a & b")).toBe("a &amp; b");
  });

  it("escapes less-than and greater-than to &lt; and &gt;", () => {
    expect(escapeXml("<tag>")).toBe("&lt;tag&gt;");
  });

  it("escapes double quotes to &quot;", () => {
    expect(escapeXml('She said "hello"')).toBe("She said &quot;hello&quot;");
  });

  it("escapes single quotes to &apos;", () => {
    expect(escapeXml("it's OK")).toBe("it&apos;s OK");
  });

  it("escapes consecutive special characters correctly", () => {
    expect(escapeXml("&&&&")).toBe("&amp;&amp;&amp;&amp;");
  });

  it("escapes a mixed string with multiple different special characters", () => {
    const input = `5 > 3 & 2 < 4 "quote" 'apos'`;
    const expected = `5 &gt; 3 &amp; 2 &lt; 4 &quot;quote&quot; &apos;apos&apos;`;

    expect(escapeXml(input)).toBe(expected);
  });

  it("preserves unicode and non-ASCII characters while escaping specials", () => {
    const input = "© α < & ' \"";
    const expected = "© α &lt; &amp; &apos; &quot;";

    expect(escapeXml(input)).toBe(expected);
  });
});
