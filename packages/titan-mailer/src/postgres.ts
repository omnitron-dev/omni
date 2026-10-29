import { mailFailure, type MailFailureKind } from './errors.js';
import type { MailMessage, MailReceipt } from './types.js';
import type { MailOutbox } from './notifications.js';
/** Existing transaction executor: compatible with a pg pool/client or a Titan database adapter.
 * The adapter never owns, reconnects, or closes the application's database.
 */
export interface MailSqlExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: Row[] }>;
}
export interface MailSqlDatabase {
  pool: MailSqlExecutor;
  transaction<T>(work: (client: MailSqlExecutor) => Promise<T>): Promise<T>;
}
export interface PostgresMailOutboxOptions {
  messageIdDomain: string;
  maxAttempts?: number;
  retrySeconds?: number;
  maxRetrySeconds?: number;
  /** Best-effort telemetry after the transaction commits. Cannot change delivery outcome. */
  onDelivery?: (event: MailDeliveryEvent) => void | Promise<void>;
}
export type MailDeliveryState = 'queued' | 'retrying' | 'accepted' | 'failed' | 'expired';
/** Safe for structured logs: no address, body, credential or SMTP response text. */
export interface MailDeliveryEvent {
  deliveryId: string;
  state: Exclude<MailDeliveryState, 'queued'>;
  /** Attempts in the current retry cycle. Manual retry starts a new cycle. */
  attempts: number;
  errorKind: MailFailureKind | null;
}
export interface MailDeliveryStatus extends Record<string, unknown> {
  id: string;
  state: MailDeliveryState;
  attempts: number;
  error_kind: string | null;
  next_attempt_at: string | null;
  updated_at: string;
}
interface OutboxRow extends Record<string, unknown> {
  recipient: string;
  subject: string;
  body: string;
  html: string | null;
  expired: boolean | null;
  attempts: number;
}
/** Run with the application's schema migrations, never in a delivery transaction. */
export const POSTGRES_MAIL_OUTBOX_SCHEMA = `
CREATE TABLE IF NOT EXISTS mail_outbox (
 id bigserial PRIMARY KEY, delivery_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 recipient text NOT NULL, subject text NOT NULL, body text NOT NULL, html text,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), next_attempt_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz, last_error_kind text, failed_at timestamptz
);
CREATE INDEX IF NOT EXISTS mail_outbox_due ON mail_outbox(next_attempt_at,id) WHERE failed_at IS NULL;
CREATE TABLE IF NOT EXISTS mail_delivery_events (
 delivery_id uuid PRIMARY KEY, state text NOT NULL CHECK(state IN ('accepted','retrying','failed','expired')),
 attempts integer NOT NULL CHECK(attempts>=0), error_kind text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mail_delivery_events_age ON mail_delivery_events(updated_at);
`;
/** SQL owns state/attempts; Titan Notifications owns wake-ups and Mailer owns SMTP. */
export class PostgresMailOutbox implements MailOutbox {
  private readonly maxAttempts: number;
  private readonly retrySeconds: number;
  private readonly maxRetrySeconds: number;
  constructor(
    private readonly db: MailSqlDatabase,
    private readonly options: PostgresMailOutboxOptions
  ) {
    this.maxAttempts = options.maxAttempts ?? 6;
    this.retrySeconds = options.retrySeconds ?? 30;
    this.maxRetrySeconds = options.maxRetrySeconds ?? 3600;
    if (
      !/^(?=.{1,253}$)[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?$/i.test(options.messageIdDomain) ||
      !Number.isSafeInteger(this.maxAttempts) ||
      this.maxAttempts < 1 ||
      this.maxAttempts > 100 ||
      !Number.isSafeInteger(this.retrySeconds) ||
      this.retrySeconds < 1 ||
      !Number.isSafeInteger(this.maxRetrySeconds) ||
      this.maxRetrySeconds < this.retrySeconds ||
      this.maxRetrySeconds > 86400
    )
      throw new Error('Invalid durable mail configuration');
  }
  async pending(limit: number): Promise<string[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid mail batch size');
    const result = await this.db.pool.query<{ delivery_id: string }>(
      `SELECT delivery_id FROM mail_outbox
      WHERE next_attempt_at<=now() AND attempts<$2 AND failed_at IS NULL ORDER BY next_attempt_at,id LIMIT $1`,
      [limit, this.maxAttempts]
    );
    return result.rows.map((row) => row.delivery_id);
  }
  async deliver(id: string, send: (mail: MailMessage) => Promise<MailReceipt>): Promise<void> {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) return;
    const event = await this.db.transaction(async (c): Promise<MailDeliveryEvent | undefined> => {
      const row = (
        await c.query<OutboxRow>(
          `SELECT *,expires_at<=now() AS expired FROM mail_outbox
        WHERE delivery_id=$1 AND next_attempt_at<=now() AND attempts<$2 AND failed_at IS NULL FOR UPDATE SKIP LOCKED`,
          [id, this.maxAttempts]
        )
      ).rows[0];
      if (!row) return undefined;
      let state: MailDeliveryState = 'accepted',
        kind: MailFailureKind | null = null;
      if (row.expired) state = 'expired';
      else {
        try {
          await send({
            to: row.recipient,
            subject: row.subject,
            text: row.body,
            ...(row.html ? { html: row.html } : {}),
            messageId: `<${id}@${this.options.messageIdDomain}>`,
            headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
          });
        } catch (error) {
          const failure = mailFailure(error);
          kind = failure.kind;
          const attempts = row.attempts + 1;
          state = !failure.retryable || attempts >= this.maxAttempts ? 'failed' : 'retrying';
          await c.query(
            `UPDATE mail_outbox SET attempts=$2,last_error_kind=$3,failed_at=CASE WHEN $4 THEN now() ELSE NULL END,
            next_attempt_at=now()+make_interval(secs => $5)
            WHERE delivery_id=$1`,
            [
              id,
              attempts,
              kind,
              state === 'failed',
              Math.min(this.maxRetrySeconds, this.retrySeconds * 2 ** Math.min(row.attempts, 30)),
            ]
          );
        }
      }
      // This is SMTP acceptance, never a claim of inbox delivery. The stable ID survives ambiguity.
      await c.query(
        `INSERT INTO mail_delivery_events(delivery_id,state,attempts,error_kind)
        VALUES($1,$2,$3,$4) ON CONFLICT(delivery_id) DO UPDATE SET state=EXCLUDED.state,
        attempts=mail_delivery_events.attempts+EXCLUDED.attempts,error_kind=EXCLUDED.error_kind,updated_at=now()`,
        [id, state, row.expired ? 0 : 1, kind]
      );
      if (state === 'accepted' || state === 'expired')
        await c.query('DELETE FROM mail_outbox WHERE delivery_id=$1', [id]);
      return { deliveryId: id, state, attempts: row.attempts + (row.expired ? 0 : 1), errorKind: kind };
    });
    if (event) {
      try {
        await this.options.onDelivery?.(event);
      } catch {
        // A broken log sink must not turn committed SMTP acceptance into a retry.
        // The durable receipt remains the authority for operational recovery.
      }
    }
  }
  /** No recipient, message, token or SMTP transcript is exposed to operators. */
  async status(id: string): Promise<MailDeliveryStatus | null> {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) return null;
    const { rows } = await this.db.pool.query<MailDeliveryStatus>(
      `
      SELECT coalesce(o.delivery_id,e.delivery_id)::text AS id,
      CASE WHEN o.delivery_id IS NULL THEN e.state
           WHEN o.failed_at IS NOT NULL OR o.attempts >= $2 THEN 'failed'
           WHEN o.attempts>0 THEN 'retrying' ELSE 'queued' END AS state,
      coalesce(e.attempts,0)::integer AS attempts,
      coalesce(o.last_error_kind,e.error_kind) AS error_kind,
      o.next_attempt_at::text AS next_attempt_at,
      coalesce(e.updated_at,o.created_at)::text AS updated_at
      FROM mail_outbox o FULL JOIN mail_delivery_events e USING(delivery_id)
      WHERE coalesce(o.delivery_id,e.delivery_id)=$1`,
      [id, this.maxAttempts]
    );
    return rows[0] ?? null;
  }
  async failed(limit = 50): Promise<MailDeliveryStatus[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid mail batch size');
    const { rows } = await this.db.pool.query<MailDeliveryStatus>(
      `SELECT o.delivery_id::text AS id,'failed' AS state,
      coalesce(e.attempts,o.attempts)::integer AS attempts,o.last_error_kind AS error_kind,
      o.next_attempt_at::text AS next_attempt_at,coalesce(e.updated_at,o.created_at)::text AS updated_at
      FROM mail_outbox o LEFT JOIN mail_delivery_events e USING(delivery_id)
      WHERE o.failed_at IS NOT NULL OR o.attempts >= $1 ORDER BY o.next_attempt_at,o.id LIMIT $2`,
      [this.maxAttempts, limit]
    );
    return rows;
  }
  /** Retry a retained terminal failure after the cause is repaired. The delivery ID stays stable. */
  async retry(id: string): Promise<boolean> {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) return false;
    return this.db.transaction(async (c) => {
      const { rows } = await c.query(
        `UPDATE mail_outbox SET attempts=0,failed_at=NULL,
        last_error_kind=NULL,next_attempt_at=now() WHERE delivery_id=$1
        AND (failed_at IS NOT NULL OR attempts >= $2)
        AND (expires_at IS NULL OR expires_at>now()) RETURNING delivery_id`,
        [id, this.maxAttempts]
      );
      if (!rows.length) return false;
      await c.query(
        `UPDATE mail_delivery_events SET state='retrying',error_kind=NULL,updated_at=now()
        WHERE delivery_id=$1`,
        [id]
      );
      return true;
    });
  }
  /** Prune only terminal receipts; retained messages and their receipts are never discarded. */
  async pruneReceipts(retainDays = 30): Promise<number> {
    if (!Number.isSafeInteger(retainDays) || retainDays < 1 || retainDays > 3650)
      throw new Error('Invalid receipt retention');
    const result = await this.db.pool.query(
      `DELETE FROM mail_delivery_events e WHERE updated_at<now()-make_interval(days => $1)
      AND NOT EXISTS(SELECT 1 FROM mail_outbox o WHERE o.delivery_id=e.delivery_id) RETURNING delivery_id`,
      [retainDays]
    );
    return result.rows.length;
  }
  async health() {
    const row = (
      await this.db.pool.query<{ pending: number; failed: number; retrying: number; oldest_due_seconds: number }>(
        `SELECT count(*) FILTER (WHERE attempts<$1 AND failed_at IS NULL)::integer AS pending,
      count(*) FILTER (WHERE attempts>=$1 OR failed_at IS NOT NULL)::integer AS failed,
      count(*) FILTER (WHERE attempts>0 AND attempts<$1 AND failed_at IS NULL)::integer AS retrying,
      coalesce(greatest(0,extract(epoch from now()-min(next_attempt_at) FILTER (WHERE attempts<$1 AND failed_at IS NULL))),0)::integer AS oldest_due_seconds
      FROM mail_outbox`,
        [this.maxAttempts]
      )
    ).rows[0];
    if (!row) throw new Error('Mail outbox health query returned no result');
    return {
      pending: Number(row.pending),
      failed: Number(row.failed),
      retrying: Number(row.retrying),
      oldestDueSeconds: Number(row.oldest_due_seconds),
    };
  }
}
