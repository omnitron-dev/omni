/**
 * A driver must not be handed another dialect's options.
 *
 * `IParsedConnectionConfig` labels them itself — "Additional PostgreSQL
 * specific: searchPath", "Additional MySQL specific: charset, timezone" — and
 * the builder handed all three to every driver. mysql2 answers `searchPath`
 * with "Ignoring invalid configuration option passed to Connection: searchPath.
 * This is currently a warning, but in future versions of MySQL2, an error will
 * be thrown", five times per run of this package's suite. In the other
 * direction pg drops unknown keys without a word, so nothing ever pointed at it.
 */
import { describe, it, expect, vi } from 'vitest';

import { DatabaseManager } from '../src/database.manager.js';

const logger: any = {
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
};
logger.child = vi.fn(() => logger);

function parse(dialect: string) {
  const manager = new DatabaseManager({}, logger);
  return (manager as any).parseConnectionConfig({
    dialect,
    connection: {
      database: 'db',
      host: 'localhost',
      port: 1234,
      user: 'u',
      password: 'p',
      searchPath: 'tenant,public',
      charset: 'utf8mb4',
      timezone: 'Z',
    },
  });
}

describe('DatabaseManager connection config', () => {
  it('gives MySQL its own options and not PostgreSQL’s', () => {
    const cfg = parse('mysql');

    expect(cfg).toMatchObject({ charset: 'utf8mb4', timezone: 'Z' });
    expect(cfg).not.toHaveProperty('searchPath');
  });

  it('gives PostgreSQL its own options and not MySQL’s', () => {
    const cfg = parse('postgres');

    expect(cfg).toMatchObject({ searchPath: 'tenant,public' });
    expect(cfg).not.toHaveProperty('charset');
    expect(cfg).not.toHaveProperty('timezone');
  });

  it('gives SQLite neither', () => {
    const cfg = parse('sqlite');

    expect(cfg).not.toHaveProperty('searchPath');
    expect(cfg).not.toHaveProperty('charset');
    expect(cfg).not.toHaveProperty('timezone');
  });

  it('still carries the connection identity for every dialect', () => {
    for (const dialect of ['mysql', 'postgres', 'sqlite']) {
      expect(parse(dialect)).toMatchObject({
        database: 'db',
        host: 'localhost',
        port: 1234,
        user: 'u',
        password: 'p',
      });
    }
  });
});
