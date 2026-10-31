import type { SQL } from "drizzle-orm";

/** Placeholder syntax the fake dialect emits when a statement is compiled. */
export type PlaceholderStyle = "dollar" | "question";

/** Statement text and parameters produced by the fake dialect. */
export interface CompiledStatement {
  /** SQL text with dialect placeholders */
  readonly sql: string;

  /** Parameters bound to the statement */
  readonly params: unknown[];
}

/** Minimal build configuration accepted by `SQL.toQuery`. */
type BuildQueryConfig = Parameters<SQL["toQuery"]>[0];

/**
 * Compile a Drizzle SQL value with a deterministic fake dialect.
 *
 * @param statement - SQL value produced by the adapter
 * @param style - Placeholder syntax to emit
 *
 * @returns The compiled statement text and its parameters
 *
 * @remarks
 * Drizzle hands SQL values to the dialect in use, and the dialect decides how
 * params are written. Compiling with both styles is what proves the adapter
 * binds values instead of inlining them. Only the text and the parameters are
 * returned; the dialect also emits parameter typings, which are irrelevant here.
 */
export function compileStatement(
  statement: SQL,
  style: PlaceholderStyle = "dollar"
): CompiledStatement {
  const config = {
    casing: {
      getColumnCasing: (column: { name: string }) => column.name,
      shouldCache: false,
    },
    escapeName: (name: string) => `"${name}"`,
    escapeParam: (index: number) => (style === "dollar" ? `$${index + 1}` : "?"),
    escapeString: (value: string) => `'${value.replace(/'/g, "''")}'`,
  };

  const compiled = statement.toQuery(config as unknown as BuildQueryConfig);

  return { sql: compiled.sql, params: compiled.params };
}
