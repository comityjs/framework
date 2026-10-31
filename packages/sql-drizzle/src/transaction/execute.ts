import type { SqlOperationResult, SqlTransaction } from "@comity/sql";
import type { DrizzleDatabase, DrizzleResultNormalizer } from "../client/types.js";

import { SqlError } from "@comity/sql/errors";
import { toSqlError } from "../internal/map-sql-error.js";
import { executeQuery } from "../query/execute.js";

/**
 * Whether a value can be awaited.
 *
 * @param value - Value returned by a transaction function
 *
 * @returns True for an object or function with a `then` method
 *
 * @remarks
 * Drizzle's transaction function is typed as asynchronous, but a driver — or a
 * composed double — can still return the callback result synchronously. That
 * value cannot keep a transaction open, so it is rejected instead of awaited.
 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

/**
 * Begin a transaction via Drizzle and return a transactional capability.
 *
 * @param db - Drizzle database port
 * @param adapter - Adapter name for diagnostics
 * @param normalize - Result normalizer for the driver in use
 *
 * @returns Operation result wrapping a SqlTransaction capability
 *
 * @throws Errors are not thrown; failures are returned via SqlOperationResult
 *
 * @remarks
 * Drizzle's transaction API is callback-scoped, so the callback is held open on
 * a barrier: `commit()` releases the barrier and `rollback()` rejects it.
 * Drizzle then issues `COMMIT` or `ROLLBACK` itself.
 *
 * `begin()` resolves only after Drizzle has started the transaction and handed
 * over the transactional handle. Drivers acquire a connection and run `BEGIN`
 * before invoking the callback, so returning earlier would expose a capability
 * whose `query()` cannot work yet.
 *
 * Because the callback is asynchronous, the driver must support an asynchronous
 * transaction function. Synchronous drivers — `better-sqlite3` and
 * `bun-sqlite` — reject it, and a transaction function that returns no promise
 * is reported as `invalid_configuration` rather than accepted as opened.
 *
 * The caller owns the outcome: until `commit()` or `rollback()` is called the
 * transaction stays open and its connection stays busy. A transaction that
 * fails while the capability is abandoned is contained here, so an unused
 * capability cannot surface as an unhandled rejection.
 */
export async function executeTransaction(
  db: DrizzleDatabase,
  adapter: string,
  normalize: DrizzleResultNormalizer
): Promise<SqlOperationResult<SqlTransaction>> {
  if (typeof db.transaction !== "function") {
    return {
      success: false,
      error: new SqlError("invalid_configuration", {
        details: {
          retriable: false,
          adapter,
          operation: "transaction",
          expected: "drizzle database with transaction()",
        },
      }),
    };
  }

  try {
    let trx!: DrizzleDatabase;
    let releaseBarrier!: () => void;
    let rejectBarrier!: (error: unknown) => void;
    let markStarted!: () => void;
    let rejectStart!: (error: unknown) => void;

    const barrier = new Promise<void>((resolve, reject) => {
      releaseBarrier = resolve;
      rejectBarrier = reject;
    });

    // Resolved once Drizzle invokes the transaction callback: from that point on
    // the transactional handle exists and the barrier has an observer.
    const started = new Promise<void>((resolve, reject) => {
      markStarted = resolve;
      rejectStart = reject;
    });

    const opened = db.transaction(async (t) => {
      trx = t;
      markStarted();
      await barrier;
    });

    // A transaction function that returns no promise cannot stay open across
    // begin()/commit(): the transaction has already finished by the time the
    // capability is returned.
    if (!isThenable(opened)) {
      return {
        success: false,
        error: new SqlError("invalid_configuration", {
          details: {
            retriable: false,
            adapter,
            operation: "transaction",
            expected: "drizzle database with an asynchronous transaction()",
          },
          context: { violation: "synchronous_transaction" },
        }),
      };
    }

    const pending = Promise.resolve(opened);

    // Route every outcome of the transaction promise into `started`:
    // - a transaction that fails before handing over a handle surfaces as a
    //   failure instead of leaving `begin()` pending;
    // - a transaction that settles without invoking the callback never yields a
    //   usable capability;
    // - an abandoned capability cannot reach the process as an unhandled
    //   rejection. `commit()` still awaits `pending` and reports the failure.
    void pending.then(
      () => {
        rejectStart(new Error("transaction settled without invoking its callback"));
      },
      (error: unknown) => {
        rejectStart(error);
      }
    );

    // Never expose a capability whose handle is not yet assigned, and surface a
    // transaction that cannot start as a canonical SqlError.
    await started;

    const transaction: SqlTransaction = {
      /** @inheritdoc */
      query: (q) => executeQuery(trx, q, adapter, normalize),

      /** @inheritdoc */
      commit: async () => {
        try {
          releaseBarrier();
          await pending;

          return { success: true, value: undefined };
        } catch (e) {
          return { success: false, error: toSqlError(e, "transaction", adapter) };
        }
      },

      /** @inheritdoc */
      rollback: async () => {
        try {
          rejectBarrier(new Error("rollback"));
          await pending.catch(() => undefined);

          return { success: true, value: undefined };
        } catch (e) {
          return { success: false, error: toSqlError(e, "transaction", adapter) };
        }
      },
    };

    return {
      success: true,
      value: transaction,
    };
  } catch (e) {
    return { success: false, error: toSqlError(e, "transaction", adapter) };
  }
}
