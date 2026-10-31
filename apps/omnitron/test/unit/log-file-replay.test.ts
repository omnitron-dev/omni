import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LogManager } from '../../src/monitoring/log-manager.js';
import { LineAssembler, fileLineOf, type LogRecord } from '../../src/monitoring/log-line.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function fixture() {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-mirror-'));
  const manager = new LogManager({ baseDir, journalPath: path.join(baseDir, 'journal.sqlite'), defaults: { maxSize: '1mb', maxFiles: 4, compress: true } }, {} as never);
  cleanups.push(async () => { await manager.dispose(); fs.rmSync(baseDir, { recursive: true, force: true }); });
  const records: LogRecord[] = [];
  new LineAssembler((_app, record) => records.push(record)).push('probe', '{"level":30,"time":"2026-10-31T01:02:03.004Z","msg":"one"}');
  return { manager, record: records[0]!, file: manager.getLogFilePath('probe') };
}

describe('crash-safe file projection', () => {
  for (const complete of [false, true]) it(`replays an ${complete ? 'already written' : 'interrupted'} append without losing legacy bytes or duplicating the record`, async () => {
    const { manager, record, file } = fixture();
    await (manager as any).flushMirror();
    const original = 'legacy unterminated bytes';
    fs.writeFileSync(file, original);
    const stat = fs.statSync(file);
    manager.journal!.put(record.id!, { app: 'probe', record });
    manager.journal!.prepareFile(record.id!, file, { offset: stat.size, inode: stat.ino, prefix: '\n' });
    const suffix = '\n' + fileLineOf(record) + '\n';
    fs.appendFileSync(file, complete ? suffix : suffix.slice(0, 55));
    await (manager as any).flushMirror();
    expect(fs.readFileSync(file, 'utf8')).toBe(original + suffix);
    expect(manager.journal!.peek(100, 1_000_000, 'file')).toEqual([]);
    expect(manager.journal!.peek()).toHaveLength(1); // The database has not acknowledged it.
    await (manager as any).flushMirror();
    expect(fs.readFileSync(file, 'utf8')).toBe(original + suffix);
  });

  it('retains evidence when bytes at the saved offset disagree', async () => {
    const { manager, record, file } = fixture();
    await (manager as any).flushMirror();
    fs.writeFileSync(file, 'original\n');
    const stat = fs.statSync(file);
    manager.journal!.put(record.id!, { app: 'probe', record });
    manager.journal!.prepareFile(record.id!, file, { offset: stat.size, inode: stat.ino, prefix: '' });
    fs.appendFileSync(file, 'unrelated bytes');
    await (manager as any).flushMirror();
    expect(fs.readFileSync(file, 'utf8')).toBe('original\nunrelated bytes');
    expect(manager.journal!.peek(100, 1_000_000, 'file')).toHaveLength(1);
    expect(manager.journalStats()!.error).toContain('differs at saved offset');
  });
});
