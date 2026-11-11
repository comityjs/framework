import type {
  OrderRepository,
  OrderRepositoryContext,
  OrderSearchCriteria,
  OrderSearchResult,
  OrderState,
} from "@comity/order";
import type { SqlClient, SqlOperationResult, SqlTransaction } from "@comity/sql";
import type { SqlError } from "@comity/sql/errors";
import type { Result } from "@comity/primitives/result";
import type { OrderRow } from "./codec.js";

import { Order, OrderId } from "@comity/order";
import { RepositoryError } from "@comity/primitives/errors";
import { failure, success } from "@comity/primitives/result";
import {
  OrderCodecError,
  decodeOrderRow,
  decodeVersion,
  encodeAddresses,
  encodeCustomer,
  encodeLine,
  encodeMeta,
  encodePrice,
  encodePayment,
  rowId,
} from "./codec.js";

const ORDER_COLUMNS = `o.id, o.version::text AS version, o.status, o.channel_id, o.currency, o.price, o.customer,
  o.addresses, o.meta, o.has_payments, o.created_at, o.updated_at,
  COALESCE((SELECT jsonb_agg(l.line ORDER BY l.position) FROM comity_order_lines l
    WHERE l.tenant = o.tenant AND l.order_id = o.id), '[]'::jsonb) AS lines,
  COALESCE((SELECT jsonb_agg(p.payment ORDER BY p.position) FROM comity_order_payments p
    WHERE p.tenant = o.tenant AND p.order_id = o.id), '[]'::jsonb) AS payments`;

/** Repository operation reported in error details. */
type Operation = "save" | "getById" | "search";

/** Row returned by `RETURNING version` and the diagnostic version read. */
interface VersionRow {
  /** Persisted version (`bigint`; decoded with `decodeVersion`). */
  readonly version: unknown;
}

/** Row returned by the search count query. */
interface TotalRow {
  /** Number of matching orders (`bigint` columns may arrive as strings). */
  readonly total: string | number;
}

/** A parameterised statement built for the save transaction. */
interface BuiltStatement {
  /** SQL text. */
  readonly statement: string;
  /** Positional parameters. */
  readonly params: unknown[];
}

/**
 * Maps a SQL error to a repository error without ever producing `conflict`.
 *
 * @param error - The SQL error.
 * @param operation - Repository operation that failed.
 *
 * @returns The repository error preserving the SQL error as `cause`.
 */
function mapSqlError(error: SqlError, operation: Operation): RepositoryError {
  const reason =
    error.meta.reason === "connection_failed" ||
    error.meta.reason === "timeout" ||
    error.meta.reason === "cancelled"
      ? "service_unavailable"
      : error.meta.reason === "invalid_query" || error.meta.reason === "invalid_configuration"
        ? "protocol_error"
        : "unknown";

  return new RepositoryError(reason, {
    cause: error,
    details: { repository: "order", operation },
  });
}

/**
 * Maps any thrown value to a repository error.
 *
 * @param cause - The thrown value.
 * @param operation - Repository operation that failed.
 *
 * @returns `invalid_data` for undecodable persisted data, otherwise `unknown`.
 */
function mapThrown(cause: unknown, operation: Operation): RepositoryError {
  return new RepositoryError(cause instanceof OrderCodecError ? "invalid_data" : "unknown", {
    cause,
    details: { repository: "order", operation },
  });
}

/**
 * Builds the error for a supplied version that cannot take part in a save at all.
 *
 * @param suppliedVersion - Version supplied by the caller.
 *
 * @returns A `repository:invalid_data` error.
 *
 * @remarks
 * Not a concurrency conflict: the value is not a non-negative safe integer, or it is the largest
 * safe integer and a successful save could not increment it into a representable version.
 *
 */
function invalidVersion(suppliedVersion: number): RepositoryError {
  return new RepositoryError("invalid_data", {
    details: { repository: "order", operation: "save", suppliedVersion },
  });
}

/**
 * Builds a version conflict error.
 *
 * @param suppliedVersion - Version supplied by the caller.
 * @param storedVersion - Persisted version when a record exists.
 *
 * @returns A `repository:conflict` error carrying the ADR-029 details.
 */
function conflict(suppliedVersion: number, storedVersion: number | undefined): RepositoryError {
  return new RepositoryError("conflict", {
    details: {
      repository: "order",
      operation: "save",
      suppliedVersion,
      ...(storedVersion !== undefined ? { storedVersion } : {}),
    },
  });
}

/**
 * Extracts the persistent state of an order (without the capture timestamp).
 *
 * @param order - The order.
 *
 * @returns The state.
 */
function stateOf(order: Order): OrderState {
  const { capturedAt, ...state } = order.snapshot();

  void capturedAt;

  return state;
}

/**
 * PostgreSQL implementation of `OrderRepository` implementing ADR-029.
 *
 * @remarks
 * `save` runs in one transaction. The root write is a single atomic statement: an
 * `INSERT … ON CONFLICT DO NOTHING RETURNING` for a first save (version `0`) or an
 * `UPDATE … SET version = version + 1 … WHERE tenant = … AND id = … AND version = <supplied>
 * RETURNING version` otherwise. The outcome is decided only from the returned rows: no row means
 * `repository:conflict` and the transaction is rolled back, so child rows are written only after
 * the root compare-and-set has succeeded. There is no preliminary read of the version and no
 * retry. SQL failures are mapped to `service_unavailable | protocol_error | unknown` and are
 * never reported as `conflict`.
 */
export class SqlOrderRepository implements OrderRepository {
  /** SQL client used for every operation. */
  readonly #client: SqlClient;

  /**
   * @param client - SQL client for a PostgreSQL database with the schema from `migrateOrderSql`.
   */
  constructor(client: SqlClient) {
    this.#client = client;
  }

  /**
   * @inheritdoc
   */
  async getById(
    id: OrderId,
    ctx: OrderRepositoryContext
  ): Promise<Result<Order | null, RepositoryError>> {
    try {
      const result = await this.#client.query<OrderRow>({
        statement: `SELECT ${ORDER_COLUMNS} FROM comity_order_orders o WHERE o.tenant = $1 AND o.id = $2`,
        params: [ctx.tenant.toString(), id.toString()],
      });

      if (!result.success) return failure(mapSqlError(result.error, "getById"));

      const row = result.value.rows[0];

      if (row === undefined) return success(null);

      return success(this.#hydrate(row));
    } catch (cause) {
      return failure(mapThrown(cause, "getById"));
    }
  }

  /**
   * @inheritdoc
   */
  async save(order: Order, ctx: OrderRepositoryContext): Promise<Result<void, RepositoryError>> {
    const supplied = order.version;

    if (!Number.isSafeInteger(supplied) || supplied < 0 || supplied >= Number.MAX_SAFE_INTEGER) {
      return failure(invalidVersion(supplied));
    }

    const begun = await this.#begin();

    if (!begun.success) return failure(mapSqlError(begun.error, "save"));

    const tx = begun.value;

    try {
      const tenant = ctx.tenant.toString();
      const id = order.id.toString();
      const root = await tx.query<VersionRow>(this.#rootStatement(order, tenant, supplied));

      if (!root.success) {
        await this.#rollback(tx);

        return failure(mapSqlError(root.error, "save"));
      }

      if (root.value.rows.length === 0) {
        await this.#rollback(tx);

        return failure(conflict(supplied, await this.#storedVersion(tenant, id)));
      }

      for (const statement of this.#childStatements(order, tenant, supplied)) {
        const child = await tx.query<unknown>(statement);

        if (!child.success) {
          await this.#rollback(tx);

          return failure(mapSqlError(child.error, "save"));
        }
      }

      const committed = await tx.commit();

      if (!committed.success) {
        await this.#rollback(tx);

        return failure(mapSqlError(committed.error, "save"));
      }

      return success(undefined);
    } catch (cause) {
      await this.#rollback(tx);

      return failure(mapThrown(cause, "save"));
    }
  }

  /**
   * @inheritdoc
   */
  async search(
    criteria: OrderSearchCriteria | undefined,
    ctx: OrderRepositoryContext
  ): Promise<Result<OrderSearchResult, RepositoryError>> {
    try {
      const tenant = ctx.tenant.toString();
      const status = criteria?.status;
      const filter = status !== undefined ? " AND o.status = $2" : "";
      const base: unknown[] = status !== undefined ? [tenant, status] : [tenant];
      const counted = await this.#client.query<TotalRow>({
        statement: `SELECT count(*) AS total FROM comity_order_orders o WHERE o.tenant = $1${filter}`,
        params: base,
      });

      if (!counted.success) return failure(mapSqlError(counted.error, "search"));

      const page = await this.#client.query<OrderRow>({
        statement: `SELECT ${ORDER_COLUMNS} FROM comity_order_orders o WHERE o.tenant = $1${filter}
  ORDER BY o.created_at, o.id LIMIT $${base.length + 1} OFFSET $${base.length + 2}`,
        params: [...base, criteria?.limit ?? null, criteria?.offset ?? 0],
      });

      if (!page.success) return failure(mapSqlError(page.error, "search"));

      const total = Number(counted.value.rows[0]?.total ?? 0);

      return success({
        items: page.value.rows.map((row) => stateOf(this.#hydrate(row))),
        total,
      });
    } catch (cause) {
      return failure(mapThrown(cause, "search"));
    }
  }

  /**
   * Opens the save transaction.
   *
   * @returns The transaction or the SQL error.
   */
  #begin(): Promise<SqlOperationResult<SqlTransaction>> {
    return this.#client.begin();
  }

  /**
   * Best-effort rollback; the original failure is what the caller reports.
   *
   * @param tx - Transaction to roll back.
   */
  async #rollback(tx: SqlTransaction): Promise<void> {
    try {
      await tx.rollback();
    } catch {
      // The connection is already unusable; the original failure is reported.
    }
  }

  /**
   * Hydrates an order from a read-query row.
   *
   * @param row - Row of the order read query.
   *
   * @returns The order.
   */
  #hydrate(row: OrderRow): Order {
    const id = OrderId.create(rowId(row));

    if (!id.success) throw new OrderCodecError("id is not valid");

    return new Order(decodeOrderRow(row), id.value);
  }

  /**
   * Diagnostic read of the persisted version after a rejected write (never used to decide it).
   *
   * @param tenant - Tenant key.
   * @param id - Order identifier.
   *
   * @returns The stored version, or `undefined` when absent or unreadable.
   */
  async #storedVersion(tenant: string, id: string): Promise<number | undefined> {
    try {
      const result = await this.#client.query<VersionRow>({
        statement:
          "SELECT version::text AS version FROM comity_order_orders WHERE tenant = $1 AND id = $2",
        params: [tenant, id],
      });

      const row = result.success ? result.value.rows[0] : undefined;

      return row === undefined ? undefined : decodeVersion(row.version);
    } catch {
      return undefined;
    }
  }

  /**
   * Builds the single atomic root statement (compare-and-set).
   *
   * @param order - Order being saved.
   * @param tenant - Tenant key.
   * @param supplied - Supplied version.
   *
   * @returns The SQL query.
   */
  #rootStatement(order: Order, tenant: string, supplied: number) {
    const snapshot = stateOf(order);
    const fields: unknown[] = [
      snapshot.status,
      order.channelId.toString(),
      JSON.stringify(snapshot.currency),
      JSON.stringify(encodePrice(order.price)),
      snapshot.customer !== undefined ? JSON.stringify(encodeCustomer(snapshot.customer)) : null,
      snapshot.addresses !== undefined ? JSON.stringify(encodeAddresses(snapshot.addresses)) : null,
      snapshot.meta !== undefined ? JSON.stringify(encodeMeta(snapshot.meta)) : null,
      snapshot.payments !== undefined,
      snapshot.createdAt.epochMilliseconds,
      snapshot.updatedAt.epochMilliseconds,
    ];

    if (supplied === 0) {
      return {
        statement: `INSERT INTO comity_order_orders
  (tenant, id, version, status, channel_id, currency, price, customer, addresses, meta, has_payments, created_at, updated_at)
VALUES ($1, $2, 1, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12)
ON CONFLICT (tenant, id) DO NOTHING
RETURNING version`,
        params: [tenant, order.id.toString(), ...fields],
      };
    }

    return {
      statement: `UPDATE comity_order_orders SET
  version = version + 1, status = $4, channel_id = $5, currency = $6::jsonb, price = $7::jsonb,
  customer = $8::jsonb, addresses = $9::jsonb, meta = $10::jsonb, has_payments = $11,
  created_at = $12, updated_at = $13
WHERE tenant = $1 AND id = $2 AND version = $3::bigint
RETURNING version`,
      params: [tenant, order.id.toString(), String(supplied), ...fields],
    };
  }

  /**
   * Builds the child-record statements, executed only after the root compare-and-set succeeded.
   *
   * @param order - Order being saved.
   * @param tenant - Tenant key.
   * @param supplied - Supplied version (`0` means the root was just inserted).
   *
   * @returns The statements, in execution order.
   */
  #childStatements(order: Order, tenant: string, supplied: number) {
    const id = order.id.toString();
    const statements: BuiltStatement[] = [];

    if (supplied !== 0) {
      statements.push(
        {
          statement: "DELETE FROM comity_order_lines WHERE tenant = $1 AND order_id = $2",
          params: [tenant, id],
        },
        {
          statement: "DELETE FROM comity_order_payments WHERE tenant = $1 AND order_id = $2",
          params: [tenant, id],
        }
      );
    }

    /**
     * Queues one multi-row INSERT of child records.
     *
     * @param table - Child table.
     * @param column - JSON column name.
     * @param items - Encoded child records.
     */
    const insertMany = (table: string, column: string, items: readonly unknown[]): void => {
      if (items.length === 0) return;

      const params: unknown[] = [];
      const tuples = items.map((item, index) => {
        const base = params.length;

        params.push(tenant, id, index, JSON.stringify(item));

        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb)`;
      });

      statements.push({
        statement: `INSERT INTO ${table} (tenant, order_id, position, ${column}) VALUES ${tuples.join(", ")}`,
        params,
      });
    };

    insertMany("comity_order_lines", "line", order.lines.map(encodeLine));
    insertMany("comity_order_payments", "payment", (order.payments ?? []).map(encodePayment));

    return statements;
  }
}
