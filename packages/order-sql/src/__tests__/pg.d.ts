// Minimal local declarations for the subset of `pg` used by the integration tests.
// `@types/pg` is not available offline; this shim declares only what the tests call, shaped so a
// `Pool` is assignable to Kysely's `PostgresPool` (hence `command` and a numeric `rowCount`).
declare module "pg" {
  export interface QueryResult<R> {
    rows: R[];
    rowCount: number;
    command: "UPDATE" | "DELETE" | "INSERT" | "SELECT" | "MERGE";
  }

  export interface Cursor<R> {
    read(rowsCount: number): Promise<R[]>;
    close(): Promise<void>;
  }

  export interface PoolClient {
    query<R = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[]
    ): Promise<QueryResult<R>>;
    query<R>(cursor: Cursor<R>): Cursor<R>;
    release(destroy?: boolean): void;
  }

  export class Pool {
    constructor(config: {
      connectionString: string;
      max?: number;
      idleTimeoutMillis?: number;
      options?: string;
    });
    connect(): Promise<PoolClient>;
    query<R = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[]
    ): Promise<QueryResult<R>>;
    end(): Promise<void>;
  }

  const pg: { Pool: typeof Pool };
  export default pg;
}
