import { describe, expect, it } from "vitest";
import { encodePath } from "../encode-path.js";

describe("encodePath", () => {
  it("leaves plain ASCII and % untouched", () => {
    expect(encodePath("/users/abc-1_2.~|%20")).toBe("/users/abc-1_2.~|%20");
  });

  it("encodes non-ASCII as UTF-8", () => {
    expect(encodePath("/café/€/😀")).toBe("/caf%C3%A9/%E2%82%AC/%F0%9F%98%80");
  });

  it("encodes space and the WHATWG path set", () => {
    expect(encodePath(' "#<>?`{}^')).toBe("%20%22%23%3C%3E%3F%60%7B%7D%5E");
  });

  it("encodes control characters and DEL", () => {
    expect(encodePath("\u0001\u007f")).toBe("%01%7F");
  });

  it("matches the WHATWG URL parser for every BMP-and-below code point", () => {
    for (let code = 0x20; code < 0x3000; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue; // lone surrogates
      const ch = String.fromCodePoint(code);
      // `/`, `\`, `?`, `#`, `%`, `.` change URL structure rather than encode
      if ("/\\?#%.".includes(ch)) continue;
      const expected = new URL("http://x/a" + ch + "b").pathname.slice(2, -1);
      expect(encodePath(ch), `U+${code.toString(16)}`).toBe(expected);
    }
  });

  it("matches the WHATWG URL parser for astral code points", () => {
    for (const ch of ["😀", "𠀀", "\u{10FFFF}"]) {
      expect(encodePath(ch)).toBe(new URL("http://x/" + ch).pathname.slice(1));
    }
  });
});
