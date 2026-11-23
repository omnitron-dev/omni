import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it('replays a whole unacknowledged batch after both log destinations have been synced', async () => {
    const { manager, file } = fixture();
    await manager.flush();
    const records: LogRecord[] = [];
    const assembler = new LineAssembler((_app, record) => records.push(record));
    for (const level of [30, 50, 30, 60]) {
      assembler.push('probe', JSON.stringify({ level, msg: `line-${records.length}` }));
    }
    const journal = manager.journal!;
    for (const record of records) journal.put(record.id!, { app: 'probe', record });
    const attempts: number[] = [];
    const ack = vi.spyOn(journal, 'acknowledge').mockImplementation(items => {
      attempts.push(items.length);
      throw Error('Interrupted before acknowledgment');
    });
    try {
      await manager.flush();
      expect(attempts).toEqual([4]);
      expect(journal.peek(10, 100_000, 'file')).toHaveLength(4);
    } finally { ack.mockRestore(); }
    await manager.flush();
    expect(fs.readFileSync(file, 'utf8')).toBe(records.map(r => fileLineOf(r) + '\n').join(''));
    expect(fs.readFileSync(manager.getLogFilePath('probe', 'error'), 'utf8')).toBe(
      [records[1]!, records[3]!].map(r => fileLineOf(r) + '\n').join(''),
    );
    expect(journal.peek(10, 100_000, 'file')).toHaveLength(0);
    expect(journal.peek()).toHaveLength(4);
  });

  it('keeps an error pending when only the application log received it', async () => {
    const { manager, file } = fixture();
    await manager.flush();
    const errorFile = manager.getLogFilePath('probe', 'error');
    const records: LogRecord[] = [];
    const assembler = new LineAssembler((_app, record) => records.push(record));
    for (const [msg, level] of [['before', 30], ['error', 50], ['after', 30]]) {
      assembler.push('probe', JSON.stringify({ level, msg }));
    }
    const journal = manager.journal!;
    for (const record of records) journal.put(record.id!, { app: 'probe', record });
    const open = fs.promises.open.bind(fs.promises);
    const fault = vi.spyOn(fs.promises, 'open').mockImplementation((filename, ...args) => {
      if (filename === errorFile) return Promise.reject(new Error('Error log temporarily unavailable'));
      return open(filename, ...args);
    });
    try {
      await manager.flush();
      expect(journal.peek(10, 100_000, 'file').map(item => item.id)).toEqual(records.slice(1).map(r => r.id));
    } finally { fault.mockRestore(); }
    await manager.flush();
    expect(fs.readFileSync(file, 'utf8')).toBe(records.map(r => fileLineOf(r) + '\n').join(''));
    expect(fs.readFileSync(errorFile, 'utf8')).toBe(fileLineOf(records[1]!) + '\n');
  });

  it('commits the completed prefix before moving a log inode during rotation', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-batch-rotation-'));
    const manager = new LogManager({ baseDir, journalPath: path.join(baseDir, 'journal.sqlite'),
      defaults: { maxSize: '1b', maxFiles: 4, compress: false } }, {} as never);
    cleanups.push(async () => { await manager.dispose(); fs.rmSync(baseDir, { recursive: true, force: true }); });
    await manager.flush();
    const records: LogRecord[] = [];
    const assembler = new LineAssembler((_app, record) => records.push(record));
    for (const msg of ['one', 'two', 'three']) assembler.push('probe', JSON.stringify({ level: 50, msg }));
    const journal = manager.journal!;
    for (const record of records) journal.put(record.id!, { app: 'probe', record });
    const pendingAtRotation: boolean[] = [];
    manager.onRotate((_app, rotatedPath) => pendingAtRotation.push(journal.hasFileIntent(rotatedPath)));
    await manager.flush();
    for (const type of ['app', 'error'] as const) {
      const file = manager.getLogFilePath('probe', type);
      expect([file + '.2', file + '.1', file].map(f => fs.readFileSync(f, 'utf8'))).toEqual(
        records.map(r => fileLineOf(r) + '\n'),
      );
    }
    expect(pendingAtRotation).toEqual([false, false, false, false]);
    expect(journal.peek(10, 100_000, 'file')).toHaveLength(0);
  });

  it('settles an in-flight append on shutdown and replays the durable remainder without duplicates', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-shutdown-'));
    const config = { baseDir, journalPath: path.join(baseDir, 'journal.sqlite'), shutdownProjectionTimeoutMs: 0,
      defaults: { maxSize: '1mb', maxFiles: 4, compress: false } };
    const manager = new LogManager(config, {} as never);
    let reopened: LogManager | undefined;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    try {
      await manager.flush();
      const records: LogRecord[] = [];
      const assembler = new LineAssembler((_app, record) => records.push(record));
      for (let i = 0; i < 3; i++) assembler.push('probe', JSON.stringify({ level: 30, time: '2026-10-31T01:02:03.004Z', msg: `record-${i}` }));
      assembler.dispose();
      for (const record of records) manager.journal!.put(record.id!, { app: 'probe', record });
      const original = fs.promises.open.bind(fs.promises);
      const open = vi.spyOn(fs.promises, 'open').mockImplementationOnce(async (...args) => { await gate; return original(...args); });
      const projection = manager.flush();
      await vi.waitFor(() => expect(open).toHaveBeenCalled());
      const shutdown = manager.dispose();
      expect(manager.dispose()).toBe(shutdown);
      release();
      await Promise.all([projection, shutdown]);
      open.mockRestore();
      reopened = new LogManager({ ...config, shutdownProjectionTimeoutMs: 5000 }, {} as never);
      await reopened.flush();
      const contents = fs.readFileSync(reopened.getLogFilePath('probe'), 'utf8');
      expect(contents).toBe(records.map(r => fileLineOf(r) + '\n').join(''));
      expect(reopened.journal!.peek(100, 1_000_000, 'file')).toEqual([]);
      expect(reopened.journal!.peek()).toHaveLength(3);
    } finally {
      release();vi.restoreAllMocks();await manager.dispose();await reopened?.dispose();fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

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
