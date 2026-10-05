/**
 * SQL observability events.
 *
 * @remarks
 * Events provide diagnostics only. They must never affect control flow.
 * Payloads are minimal and non-sensitive.
 */
export interface SqlOperationObserver {
  /**
   * Emitted when a query starts execution.
   *
   * @param payload Query start payload.
   */
  onQueryStarted(payload: {
    /** Query identifier */
    id: string;
  }): void;

  /**
   * Emitted when a query completes successfully.
   *
   * @param payload Query completion payload.
   */
  onQueryCompleted(payload: {
    /** Query identifier */
    id: string;

    /** Query duration in milliseconds */
    duration: number;

    /** Number of rows affected or returned by the query. */
    rowCount?: number;
  }): void;

  /**
   * Emitted when a query fails.
   *
   * @param payload Query failure payload.
   */
  onQueryFailed(payload: {
    /** Query identifier */
    id: string;

    /** Reason for query failure */
    reason: string;

    /** Query duration in milliseconds */
    duration: number;
  }): void;

  /**
   * Emitted when a transaction is started.
   *
   * @param payload Transaction start payload.
   */
  onTransactionStarted(payload: {
    /** Transaction identifier */
    id: string;
  }): void;

  /**
   * Emitted when a transaction is committed.
   *
   * @param payload Transaction commit payload.
   */
  onTransactionCommitted(payload: {
    /** Transaction identifier */
    id: string;

    /** Transaction duration in milliseconds */
    duration: number;
  }): void;

  /**
   * Emitted when a transaction is rolled back.
   *
   * @param payload Transaction rollback payload.
   */
  onTransactionRolledBack(payload: {
    /** Transaction identifier */
    id: string;

    /** Transaction duration in milliseconds */
    duration: number;
  }): void;

  /**
   * Emitted when an atomic batch starts execution.
   *
   * @param payload Atomic batch start payload.
   */
  onAtomicBatchStarted(payload: {
    /** Batch identifier */
    id: string;
  }): void;

  /**
   * Emitted when an atomic batch completes successfully.
   *
   * @param payload Atomic batch completion payload.
   */
  onAtomicBatchCompleted(payload: {
    /** Batch identifier */
    id: string;

    /** Batch duration in milliseconds */
    duration: number;

    /** Number of statements submitted in the batch. */
    statementCount: number;
  }): void;

  /**
   * Emitted when an atomic batch fails.
   *
   * @param payload Atomic batch failure payload.
   */
  onAtomicBatchFailed(payload: {
    /** Batch identifier */
    id: string;

    /** Reason for batch failure */
    reason: string;

    /** Batch duration in milliseconds */
    duration: number;

    /** Number of statements submitted in the batch. */
    statementCount: number;
  }): void;
}
