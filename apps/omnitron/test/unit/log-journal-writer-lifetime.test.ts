import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LogJournal } from '../../src/monitoring/log-journal.js';
const probe = vi.hoisted(() => vi.fn());
vi.mock('../../src/monitoring/process-lifetime.js', () => ({ readProcessLifetime: probe }));
const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); vi.restoreAllMocks(); probe.mockReset(); });
function fixture(identity: string | null = '11111111-1111-4111-8111-111111111111:200') {
  let now = 10000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  probe.mockReturnValue({ state: 'alive', identity: '22222222-2222-4222-8222-222222222222:300' });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'log-lifetime-'));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = root + '/capture.sqlite', journal = new LogJournal(file);
  cleanups.push(() => journal.close());
  journal.put('record', { message: 'original bytes\n  stack', timestamp: '2026-10-31T10:00:00.123456Z' }, false);
  const db = new Database(file);
  db.prepare('UPDATE records SET writer = ?, writer_identity = ?').run(777, identity);
  db.close();
  return { journal, advance: () => { now += 5001; } };
}
describe('abandoned log assembly', () => {
  it('recovers the same bytes when the PID now belongs to another process', () => {
    const { journal, advance } = fixture(); advance();
    expect(journal.peek()).toMatchObject([{ id: 'record', value: { message: 'original bytes\n  stack', timestamp: '2026-10-31T10:00:00.123456Z' } }]);
    expect(journal.stats()).toMatchObject({ pending: 1, assembling: 0, error: null });
  });
  it('rechecks a writer that dies after the new backend has already opened its journal', () => {
    const { journal, advance } = fixture('22222222-2222-4222-8222-222222222222:300'); advance();
    expect(journal.peek()).toEqual([]);
    probe.mockReturnValue({ state: 'dead' }); advance();
    expect(journal.peek()).toHaveLength(1);
  });
  it('preserves records and exposes uncertainty when process identity cannot be read', () => {
    const { journal, advance } = fixture(); probe.mockReturnValue({ state: 'unknown' }); advance();
    expect(journal.peek()).toEqual([]);
    expect(journal.stats().error).toContain('cannot verify');
    probe.mockReturnValue({ state: 'dead' }); advance();
    expect(journal.peek()).toHaveLength(1);
    expect(journal.stats().error).toBeNull();
  });
  it('does not steal legacy pending records from a possibly live writer', () => {
    const { journal, advance } = fixture(null); advance();
    expect(journal.peek()).toEqual([]);
    expect(journal.stats().error).toContain('PID 777');
    probe.mockReturnValue({ state: 'dead' }); advance();
    expect(journal.peek()).toHaveLength(1);
  });
  it('does not mistake a previously unverified identity for proof of PID reuse', () => {
    const { journal, advance } = fixture('unverified:writer'); advance();
    expect(journal.peek()).toEqual([]);
    expect(journal.stats().error).toContain('cannot verify');
  });
  it('retains legacy Darwin assemblies across boot-time drift and identity format migration until the writer dies', () => {
    const { journal, advance } = fixture('{ sec = 1791430683, usec = 746863 } Thu Oct  8 06:38:03 2026:Mon Nov  2 01:00:00 2026');
    for (const identity of ['{ sec = 1791430683, usec = 728557 } Thu Oct  8 06:38:03 2026:Mon Nov  2 01:00:00 2026',
      'darwin:119bd1eb-252d-4be8-ad83-69e325fbd927:Mon Nov  2 01:00:00 2026']) {
      probe.mockReturnValue({ state: 'alive', identity }); advance();
      expect(journal.peek()).toEqual([]); expect(journal.stats().error).toContain('cannot verify');
    }
    probe.mockReturnValue({ state: 'dead' }); advance();
    expect(journal.peek()).toHaveLength(1); expect(journal.stats().error).toBeNull();
  });
});
