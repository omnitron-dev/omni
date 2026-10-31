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
function fixture(identity: string | null = 'old-boot:start') {
  let now = 10000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  probe.mockReturnValue({ state: 'alive', identity: 'this-boot:start' });
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
    const { journal, advance } = fixture('this-boot:start'); advance();
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
});
