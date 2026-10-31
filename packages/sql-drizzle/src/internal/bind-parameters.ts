/** @internal */

import type { SqlOperationResult } from "@comity/sql";
import type { SQL, SQLChunk } from "drizzle-orm";
import type { SqlOperation } from "./map-sql-error.js";

import { SqlError } from "@comity/sql/errors";
import { Param, SQL as SqlStatement, StringChunk } from "drizzle-orm";

/** Characters that open a quoted region. */
const QUOTES = new Set(["'", '"', "`"]);

/**
 * Index just past a quoted literal or quoted identifier.
 *
 * @param text - Statement being scanned
 * @param start - Index of the opening quote
 * @param quote - Quote character that closes the region
 *
 * @returns The index after the closing quote, or the end of the statement
 *
 * @remarks
 * A doubled quote is the standard escape and does not close the region. The
 * region is left open when no closing quote exists: the statement is invalid,
 * but binding must not invent placeholders out of it.
 */
function skipQuoted(text: string, start: number, quote: string): number {
  let index = start + 1;

  while (index < text.length) {
    if (text.charAt(index) === quote) {
      if (text.charAt(index + 1) === quote) {
        index += 2;
        continue;
      }

      return index + 1;
    }

    index += 1;
  }

  return text.length;
}

/**
 * Index just past a line comment.
 *
 * @param text - Statement being scanned
 * @param from - Index of the first character after the comment marker
 *
 * @returns The index after the newline, or the end of the statement
 */
function skipLine(text: string, from: number): number {
  const end = text.indexOf("\n", from);

  return end === -1 ? text.length : end + 1;
}

/**
 * Index just past a block comment.
 *
 * @param text - Statement being scanned
 * @param from - Index of the first character after the comment marker
 *
 * @returns The index after the closing marker, or the end of the statement
 */
function skipBlock(text: string, from: number): number {
  const end = text.indexOf("*/", from);

  return end === -1 ? text.length : end + 2;
}

/**
 * Read a PostgreSQL dollar-quote delimiter at an index.
 *
 * @param text - Statement being scanned
 * @param start - Index of the leading `$`
 *
 * @returns The delimiter (`$$` or `$tag$`), or `null` when there is none
 *
 * @remarks
 * Tags cannot start with a digit, which is what separates `$tag$` from the
 * `$1` positional placeholder.
 */
function dollarDelimiter(text: string, start: number): string | null {
  const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(start));

  return match === null ? null : match[0];
}

/**
 * Index just past a dollar-quoted string.
 *
 * @param text - Statement being scanned
 * @param start - Index of the opening delimiter
 * @param delimiter - Opening delimiter, which also closes the string
 *
 * @returns The index after the closing delimiter, or the end of the statement
 */
function skipDollarQuoted(text: string, start: number, delimiter: string): number {
  const end = text.indexOf(delimiter, start + delimiter.length);

  return end === -1 ? text.length : end + delimiter.length;
}

/**
 * Build an invalid-query result for a binding violation.
 *
 * @param violation - Machine-readable violation identifier
 * @param operation - Operation that failed
 * @param adapter - Adapter name for diagnostics
 *
 * @returns A failed operation result carrying an `invalid_query` SqlError
 */
function violation(
  violation: string,
  operation: SqlOperation,
  adapter: string
): SqlOperationResult<SQL> {
  return {
    success: false,
    error: new SqlError("invalid_query", {
      details: { retriable: false, adapter, operation },
      context: { violation },
    }),
  };
}

/**
 * Bind positional parameters to a statement and return the Drizzle SQL value.
 *
 * @param statement - SQL text with positional placeholders
 * @param params - Positional parameters, in binding order
 * @param operation - Operation that triggered the binding
 * @param adapter - Adapter name for diagnostics
 *
 * @returns The SQL value to hand to Drizzle, or an `invalid_query` failure
 *
 * @remarks
 * Drizzle has no API for passing a statement plus a parameter array directly:
 * values are bound through `Param` chunks so the dialect can emit its own
 * placeholder syntax (`$1` for PostgreSQL, `?` for MySQL and SQLite).
 *
 * Both placeholder conventions are understood:
 *
 * - `?` binds the next unused parameter
 * - `$n` binds parameter `n` (one-based, repeatable)
 *
 * Placeholders inside quoted strings, quoted identifiers, dollar-quoted
 * strings, and comments are text, not bind markers. A count mismatch, an index
 * outside the parameter list, or `$0` is reported as `invalid_query`; the
 * statement is not executed.
 *
 * Only `--` and slash-star comments are recognised: MySQL `#` comments are not
 * skipped, because `#>` and `#>>` are PostgreSQL operators and skipping to the
 * end of the line would silently drop the rest of a valid statement.
 */
export function bindParameters(
  statement: string,
  params: readonly unknown[],
  operation: SqlOperation,
  adapter: string
): SqlOperationResult<SQL> {
  const chunks: SQLChunk[] = [];
  const used = new Set<number>();
  let literal = "";
  let cursor = 0;

  /** Append buffered literal text as one chunk. */
  const flush = (): void => {
    if (literal.length > 0) {
      chunks.push(new StringChunk(literal));
      literal = "";
    }
  };

  /**
   * Bind the next unused parameter to a `?` placeholder.
   *
   * @returns A failure when no parameter is left, otherwise `null`
   */
  const bindNext = (): SqlOperationResult<SQL> | null => {
    while (cursor < params.length && used.has(cursor)) {
      cursor += 1;
    }

    if (cursor >= params.length) {
      return violation("parameter_count_mismatch", operation, adapter);
    }

    flush();
    chunks.push(new Param(params[cursor]));
    used.add(cursor);
    cursor += 1;

    return null;
  };

  let index = 0;

  while (index < statement.length) {
    const char = statement.charAt(index);

    if (QUOTES.has(char)) {
      const end = skipQuoted(statement, index, char);

      literal += statement.slice(index, end);
      index = end;
      continue;
    }

    if (char === "-" && statement.charAt(index + 1) === "-") {
      const end = skipLine(statement, index + 2);

      literal += statement.slice(index, end);
      index = end;
      continue;
    }

    if (char === "/" && statement.charAt(index + 1) === "*") {
      const end = skipBlock(statement, index + 2);

      literal += statement.slice(index, end);
      index = end;
      continue;
    }

    if (char === "$") {
      const delimiter = dollarDelimiter(statement, index);

      if (delimiter !== null) {
        const end = skipDollarQuoted(statement, index, delimiter);

        literal += statement.slice(index, end);
        index = end;
        continue;
      }

      const digits = /^\d+/.exec(statement.slice(index + 1));

      if (digits !== null) {
        const parameterIndex = Number(digits[0]) - 1;

        if (parameterIndex < 0 || parameterIndex >= params.length) {
          return violation("invalid_parameter_index", operation, adapter);
        }

        flush();
        chunks.push(new Param(params[parameterIndex]));
        used.add(parameterIndex);
        index += 1 + digits[0].length;
        continue;
      }
    }

    if (char === "?") {
      const bound = bindNext();

      if (bound !== null) {
        return bound;
      }

      index += 1;
      continue;
    }

    literal += char;
    index += 1;
  }

  flush();

  if (used.size !== params.length) {
    return violation("parameter_count_mismatch", operation, adapter);
  }

  return { success: true, value: new SqlStatement(chunks) };
}
