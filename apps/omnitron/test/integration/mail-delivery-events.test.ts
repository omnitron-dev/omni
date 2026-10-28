import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PostgresMailOutbox,
  POSTGRES_MAIL_OUTBOX_SCHEMA,
  type MailSqlExecutor,
  type MailDeliveryEvent,
} from '../../../../packages/titan-mailer/src/postgres.js';

// Only an explicitly supplied test database. Every object belongs to a unique schema.
const url = process.env.OMNITRON_TEST_DATABASE_URL;
const schema = `mail_events_${randomUUID().replaceAll('-', '')}`;
let pool: Pool;
const events: MailDeliveryEvent[] = [];
async function transaction<T>(work: (client: MailSqlExecutor) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
const receipt = { messageId: '<id@example.test>', accepted: ['reader@example.test'] };
async function queued(expired = false) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO mail_outbox(delivery_id,recipient,subject,body,expires_at)
    VALUES($1,'reader@example.test','private subject','private credential link',now()+make_interval(secs=>$2))`,
    [id, expired ? -1 : 3600]
  );
  return id;
}
describe.skipIf(!url)('committed mail outcomes on PostgreSQL', () => {
  beforeAll(async () => {
    const admin = new Pool({ connectionString: url });
    try {
      await admin.query(`CREATE SCHEMA ${schema}`);
    } finally {
      await admin.end();
    }
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 4 });
    await pool.query(POSTGRES_MAIL_OUTBOX_SCHEMA);
  });
  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    }
  });
  it('observes only committed acceptance and never repeats a completed message', async () => {
    const id = await queued();
    let sent = 0;
    const box = new PostgresMailOutbox(
      { pool, transaction },
      {
        messageIdDomain: 'example.test',
        onDelivery: async (event) => {
          expect((await box.status(event.deliveryId))?.state).toBe('accepted');
          events.push(event);
        },
      }
    );
    const send = async () => {
      sent++;
      return receipt;
    };
    await Promise.all([box.deliver(id, send), box.deliver(id, send)]);
    await box.deliver(id, send);
    expect(sent).toBe(1);
    expect(events.filter((e) => e.deliveryId === id)).toEqual([
      { deliveryId: id, state: 'accepted', attempts: 1, errorKind: null },
    ]);
  });
  it('distinguishes retryable, terminal and expired mail without leaking payloads', async () => {
    const box = new PostgresMailOutbox(
      { pool, transaction },
      {
        messageIdDomain: 'example.test',
        onDelivery: (event) => {
          events.push(event);
        },
      }
    );
    for (const [status, state] of [
      [451, 'retrying'],
      [550, 'failed'],
    ] as const) {
      const id = await queued();
      await box.deliver(id, async () => {
        throw Object.assign(Error('private SMTP response'), { responseCode: status });
      });
      expect((await box.status(id))?.state).toBe(state);
      expect(events.at(-1)).toMatchObject({ deliveryId: id, state, attempts: 1 });
    }
    const id = await queued(true);
    let sent = false;
    await box.deliver(id, async () => {
      sent = true;
      return receipt;
    });
    expect(sent).toBe(false);
    expect(events.at(-1)).toMatchObject({ deliveryId: id, state: 'expired', attempts: 0 });
    expect(JSON.stringify(events)).not.toMatch(/private|reader@/);
  });
  it('does not emit an uncommitted outcome or let a failed log sink trigger another send', async () => {
    const id = await queued();
    const box = new PostgresMailOutbox(
      {
        pool,
        transaction: (work) =>
          transaction(async (c) => {
            await work(c);
            throw Error('commit failed');
          }),
      },
      {
        messageIdDomain: 'example.test',
        onDelivery: (event) => {
          events.push(event);
        },
      }
    );
    await expect(box.deliver(id, async () => receipt)).rejects.toThrow('commit failed');
    expect(events.some((e) => e.deliveryId === id)).toBe(false);
    expect((await box.status(id))?.state).toBe('queued');
    const healthy = new PostgresMailOutbox(
      { pool, transaction },
      {
        messageIdDomain: 'example.test',
        onDelivery: async () => {
          throw Error('sink failed');
        },
      }
    );
    await expect(healthy.deliver(id, async () => receipt)).resolves.toBeUndefined();
    expect((await healthy.status(id))?.state).toBe('accepted');
  });
});
