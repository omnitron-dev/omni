import { afterEach, describe, expect, it, vi } from 'vitest';
const { connect, query, end, construct } = vi.hoisted(() => ({
  connect: vi.fn(), query: vi.fn(), end: vi.fn(async () => {}), construct: vi.fn(),
}));
vi.mock('pg', () => ({ Client: class {
  constructor(options: unknown) { construct(options); }
  connect = connect;
  query = query;
  end = end;
} }));
import { waitForPostgres } from '../../src/services/wait-for-postgres.js';
afterEach(() => { vi.clearAllMocks(); });

describe('migration database readiness', () => {
  it.each(['28P01', '28000', '3D000', '42501'])('refuses permanent PostgreSQL failure %s without retries', async code => {
    connect.mockRejectedValueOnce(Object.assign(new Error('Permanent connection refusal'), { code }));
    await expect(waitForPostgres('127.0.0.1', 5544, 'app', 'password', 30_000))
      .rejects.toThrow('rejected the migration connection');
    expect(construct).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('passes the complete application connection, including database and TLS options, to pg', async () => {
    connect.mockResolvedValueOnce(undefined); query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    const connectionString = 'postgresql://app:password@127.0.0.1:5544/ledger?sslmode=require';
    await waitForPostgres('127.0.0.1', 5544, 'app', 'password', 1000, connectionString);
    expect(construct).toHaveBeenCalledWith(expect.objectContaining({ connectionString }));
    expect(query).toHaveBeenCalledExactlyOnceWith('SELECT 1');
  });
});
