const encoder = new TextEncoder();

/**
 * ASCII characters (besides C0 controls and DEL) that the WHATWG URL parser
 * percent-encodes in a path. `%` is deliberately absent: the parser leaves it
 * untouched, so a literal `%` in a route stays a literal `%`.
 */
const ASCII_ENCODED = new Set([" ", '"', "#", "<", ">", "?", "`", "{", "}", "^"]);

/**
 * Percent-encodes a literal route segment the same way the WHATWG URL parser
 * encodes a path, so it can be compared with `URL.pathname`.
 *
 * @param text - A literal (non-parameter) fragment of a route path.
 *
 * @returns The fragment with the same percent-encoding `URL.pathname` applies.
 *
 * @remarks
 * `encodeURI` is not equivalent: it encodes `|` (which the parser leaves as is)
 * and diverges on other reserved characters.
 */
export function encodePath(text: string): string {
  let out = "";

  for (const ch of text) {
    const code = ch.codePointAt(0)!;

    if (code > 0x1f && code < 0x7f && !ASCII_ENCODED.has(ch)) {
      out += ch;
      continue;
    }

    for (const byte of encoder.encode(ch)) {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }

  return out;
}
