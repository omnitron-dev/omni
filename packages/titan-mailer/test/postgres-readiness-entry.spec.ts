import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('pg', () => { throw Error('mail persistence must borrow its database'); });
vi.mock('kysely', () => { throw Error('mail persistence must not load the schema engine'); });
vi.mock('@omnitron-dev/titan-database', () => { throw Error('mail persistence must not load the database module'); });

it('exports component requirements as plain data without loading database dependencies', async () => {
  const entry = await import('../src/postgres.js');
  expect(entry.PostgresMailOutbox).toBeTypeOf('function');
  expect(entry.POSTGRES_MAIL_OUTBOX_REQUIREMENTS.name).toBe('titan-mailer.postgres-outbox');
  expect(JSON.parse(JSON.stringify(entry.POSTGRES_MAIL_OUTBOX_REQUIREMENTS))).toEqual(entry.POSTGRES_MAIL_OUTBOX_REQUIREMENTS);
  expect(readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')).not.toMatch(/from ['"].*postgres/);
});
