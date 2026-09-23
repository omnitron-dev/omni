/**
 * A secret printed by the command that masked.
 *
 * `omnitron env main` printed all twelve values in clear — JWT_SECRET and
 * DATABASE_URL with its password among them — and `inspect` masked by KEY
 * NAME only, so `DATABASE_URL=postgres://postgres:<password>@…` was printed
 * by the very command that claimed to mask. The daemon handed the raw values
 * to anyone with the operator role.
 *
 * Now the daemon replaces secrets before they leave (`getEnv` → `redactEnv`),
 * by key and inside URL-shaped values, and the clear values are a separate
 * admin-only call that the audit trail records.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'reflect-metadata';

import { redactEnv, redactValue, REDACTED } from '../../src/shared/redact-env.js';
import { DaemonRpcService } from '../../src/daemon/daemon.rpc-service.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Synthetic values of the shapes measured on the live stand.
const ENV = {
  APP_NAME: 'main',
  DATABASE_URL: 'postgres://postgres:hunter2-db@127.0.0.1:5432/main',
  REDIS_URL: 'redis://:hunter2-redis@127.0.0.1:6379/0',
  JWT_SECRET: 'a'.repeat(64),
  AUTH_ALLOWED_ORIGINS: 'http://localhost:7080,http://example.onion,https://*.onion',
  WEBHOOK_URL: 'https://hooks.example/in?token=hunter2-token&channel=ops',
};

describe('what may be shown of an environment', () => {
  it('replaces secrets by name, and the password inside a URL', () => {
    const shown = redactEnv(ENV);
    expect(shown['JWT_SECRET']).toBe(REDACTED);
    expect(shown['DATABASE_URL']).toBe(`postgres://postgres:${REDACTED}@127.0.0.1:5432/main`);
    expect(shown['REDIS_URL']).toBe(`redis://:${REDACTED}@127.0.0.1:6379/0`);
    expect(shown['WEBHOOK_URL']).toBe(`https://hooks.example/in?token=${REDACTED}&channel=ops`);
    expect(JSON.stringify(shown)).not.toMatch(/hunter2/);
  });

  it('leaves what carries no credential exactly as it is', () => {
    const shown = redactEnv(ENV);
    expect(shown['APP_NAME']).toBe('main');
    expect(shown['AUTH_ALLOWED_ORIGINS']).toBe(ENV.AUTH_ALLOWED_ORIGINS);
    expect(redactValue('http://user@host:80/path')).toBe('http://user@host:80/path');
  });
});

describe('the daemon', () => {
  const rpcWith = (records: unknown[]) => {
    const rpc = new DaemonRpcService(
      { getHandle: (name: string) => (name === 'daos/dev/main' ? { name, entry: { env: ENV } } : undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    rpc.setAudit({ record: async (e: unknown) => void records.push(e) } as never);
    return rpc;
  };

  it('answers getEnv with the secrets already replaced', async () => {
    const out = await rpcWith([]).getEnv({ name: 'daos/dev/main' });
    expect(JSON.stringify(out)).not.toMatch(/hunter2|aaaaaaaa/);
  });

  it('reveals the clear values only through a separate call, and records who asked', async () => {
    const records: Array<{ action: string; resourceId: string }> = [];
    const out = await rpcWith(records).revealEnv({ name: 'daos/dev/main' });
    expect(out['DATABASE_URL']).toBe(ENV.DATABASE_URL);
    expect(records).toMatchObject([{ action: 'app.env.reveal', resourceId: 'daos/dev/main' }]);
  });

  it('keeps the reveal to admins', () => {
    const source = fs.readFileSync(path.join(here, '../../src/daemon/daemon.rpc-service.ts'), 'utf8');
    expect(source).toMatch(/@Public\(\{ auth: \{ roles: ADMIN_ROLES \} \}\)\s*\n\s*async revealEnv\(/);
  });
});

describe('the commands print what the daemon answered', () => {
  it('inspect no longer masks on its own, by key name alone', () => {
    const inspect = fs.readFileSync(path.join(here, '../../src/commands/inspect.ts'), 'utf8');
    expect(inspect).not.toMatch(/secret\|password\|token\|key/);
  });
});
