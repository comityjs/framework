/**
 * Escapes XML-special characters in a string.
 *
 * @param str - The string to escape
 *
 * @returns The XML-escaped string
 */
export function escapeXml(str: string): string {
  let result = "";

  for (let i = 0; i < str.length; i++) {
    const char = str[i];

    switch (char) {
      case "&":
        result += "&amp;";
        break;

      case "<":
        result += "&lt;";
        break;

      case ">":
        result += "&gt;";
        break;

      case '"':
        result += "&quot;";
        break;

      case "'":
        result += "&apos;";
        break;

      default:
        result += char;
    }
  }
  return result;
}
