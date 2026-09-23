/**
 * A log line read four ways, all of them wrong about the same lines.
 *
 * `LogManager.parseLine` (the daemon's buffer), `LogManager.isErrorOrFatal`
 * (what reaches `error.log`), `LogCollectorService.ingestPinoLine` (the
 * `logs` table) and the CLI's file fallback each read a line that is not
 * JSON as level `info`, dated "now". Measured 2026-09-23: paysys wrote
 * pino-pretty; its `app.log` held 95 «Monero chain has not advanced» records
 * at ERROR and `error.log` none; the table kept 3 `error` rows beside
 * 1 264 995 `info` from the test node in a day, 1 216 292 of them the
 * indented lines of dumps, each a row of its own; and `omnitron logs paysys
 * -f` printed 26 lines 304 times in 7 s, every poll re-dating them.
 *
 * And `omnitron logs daos/test/paysys` answered «No log entries found» beside
 * thousands of that app's rows the node had synced to this master under its
 * own name, `daos/deployed/paysys`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BackwardAssembler,
  LineAssembler,
  classifyLine,
  levelOf,
  type LogRecord,
} from '../../src/monitoring/log-line.js';
import { LogCollectorService, timestampWithSequence } from '../../src/services/log-collector.service.js';
import { DaemonRpcService } from '../../src/daemon/daemon.rpc-service.js';

const REF = Date.parse('2026-09-23T13:30:00.000Z');

describe('one reading of a line', () => {
  it('takes a JSON record\'s own level and time', () => {
    expect(classifyLine('{"level":50,"time":1790000000000,"msg":"boom"}', REF)).toMatchObject({
      kind: 'json',
      level: 'error',
      time: 1790000000000,
      message: 'boom',
    });
    expect(levelOf(35)).toBe('warn');
    expect(levelOf('WARN')).toBe('warn');
    expect(levelOf(undefined)).toBe('unknown');
  });

  it('reads a pino-pretty header\'s level — ERROR is an error, not info', () => {
    const line = '[2026-09-23 08:49:07.229] ERROR (paysys/41 on host): Monero chain has not advanced';
    expect(classifyLine(line, REF)).toMatchObject({
      kind: 'pretty',
      level: 'error',
      time: Date.parse('2026-09-23T08:49:07.229Z'),
      message: 'Monero chain has not advanced',
    });
  });

  it('dates a time-of-day header from what it was read beside, never later', () => {
    const local = new Date(REF);
    const hh = String(local.getHours()).padStart(2, '0');
    const mm = String(local.getMinutes()).padStart(2, '0');
    const klass = classifyLine(`[${hh}:${mm}:00.000] INFO (main/1 on h): up`, REF);
    expect(klass).toMatchObject({ kind: 'pretty', level: 'info' });
    expect((klass as { time: number }).time).toBe(REF);
    // An hour AFTER the reference is yesterday's, not the future.
    const later = new Date(REF + 3_600_000);
    const lateHeader = `[${String(later.getHours()).padStart(2, '0')}:${String(later.getMinutes()).padStart(2, '0')}:00.000] INFO (x): y`;
    expect((classifyLine(lateHeader, REF) as { time: number }).time).toBeLessThanOrEqual(REF);
  });

  it('reads through a terminal\'s colours', () => {
    expect(classifyLine('\u001b[90m[2026-09-23 08:49:07.229]\u001b[39m \u001b[31mERROR\u001b[39m (x): y', REF)).toMatchObject({
      kind: 'pretty',
      level: 'error',
    });
  });

  it('calls an indented line a continuation and a plain one text of unknown level', () => {
    expect(classifyLine('    at Object.<anonymous> (/app/x.js:1:1)', REF)).toEqual({ kind: 'continuation' });
    expect(classifyLine('Error: connect ECONNREFUSED', REF)).toEqual({ kind: 'text' });
  });
});

describe('lines become records once, at capture', () => {
  afterEach(() => vi.useRealTimers());

  it('joins a dump to its header and delivers it when the next record starts', () => {
    const got: LogRecord[] = [];
    const assembler = new LineAssembler((_key, r) => got.push(r), { now: () => REF, idleMs: 10_000 });
    assembler.push('paysys', '[2026-09-23 08:49:07.229] ERROR (paysys): failed');
    assembler.push('paysys', '    at a (x.js:1:1)');
    assembler.push('paysys', '    at b (x.js:2:1)');
    expect(got).toEqual([]);
    assembler.push('paysys', '{"level":30,"msg":"next"}');

    expect(got.map((r) => `${r.level}:${r.lines}`)).toEqual(['error:3', 'info:1']);
    expect(got[0]!.message).toBe('failed\n    at a (x.js:1:1)\n    at b (x.js:2:1)');
    assembler.dispose();
  });

  it('delivers a held record once the pipe is idle', async () => {
    const got: LogRecord[] = [];
    const assembler = new LineAssembler((_key, r) => got.push(r), { idleMs: 20 });
    assembler.push('main', 'plain text');
    await new Promise((r) => setTimeout(r, 80));
    expect(got.map((r) => r.message)).toEqual(['plain text']);
    expect(got[0]!.level).toBe('unknown');
  });

  it('keeps apps apart', () => {
    const got: Array<[string, LogRecord]> = [];
    const assembler = new LineAssembler((key, r) => got.push([key, r]), { now: () => REF, idleMs: 10_000 });
    assembler.push('a', 'Error: one');
    assembler.push('b', 'Error: two');
    assembler.push('a', '    at a');
    assembler.dispose();
    expect(got.map(([k, r]) => `${k}=${r.message.replace(/\n/g, '|')}`).sort()).toEqual(['a=Error: one|    at a', 'b=Error: two']);
  });
});

describe('a file read backwards gives the same records', () => {
  it('joins indented lines met before their header, and dates by the record after', () => {
    const got: LogRecord[] = [];
    const back = new BackwardAssembler(REF, (r) => got.push(r));
    // The file, top to bottom: header, two frames, a JSON record.
    back.pushEarlier('{"level":30,"time":1790000000000,"msg":"after"}');
    back.pushEarlier('    at b');
    back.pushEarlier('    at a');
    back.pushEarlier('Error: boom');
    back.finish();

    expect(got.map((r) => r.message)).toEqual(['after', 'Error: boom\n    at a\n    at b']);
    // A plain line carries no time: it is dated by the record after it, never by the read.
    expect(got[1]!.time).toBe(1790000000000);
    expect(got[1]!.timeFromLine).toBe(false);
  });

  it('dates frames whose header lies before the window by the record after them, not by the read', () => {
    const got: LogRecord[] = [];
    const back = new BackwardAssembler(REF, (r) => got.push(r));
    back.pushEarlier('{"level":30,"time":1790000000000,"msg":"after"}');
    back.pushEarlier('    at b');
    back.pushEarlier('    at a');
    // The window starts here: their header is further up the file.
    back.finish();

    expect(got.map((r) => r.message)).toEqual(['after', '    at a\n    at b']);
    expect(got[1]!.time).toBe(1790000000000);
  });
});

describe('the table keeps a record as one row, at its level, in capture order', () => {
  const collector = () => {
    const c = new LogCollectorService({} as never);
    return { c, rows: () => (c as unknown as { buffer: Array<Record<string, unknown>> }).buffer };
  };

  it('stores a dump as one row and a plain line as unknown, not info', async () => {
    const { c, rows } = collector();
    c.ingestPinoLine('daos/deployed/paysys', 'Error: getaddrinfo ENOTFOUND bitcoin');
    c.ingestPinoLine('daos/deployed/paysys', '    at GetAddrInfoReqWrap.onlookup');
    c.ingestPinoLine('daos/deployed/paysys', '{"level":40,"msg":"retrying"}');

    expect(rows().map((r) => `${r['level']}:${String(r['message']).split('\n').length}`)).toEqual(['unknown:2', 'warn:1']);
    await c.dispose();
  });

  it('writes the capture order into the microseconds of one millisecond', () => {
    expect(timestampWithSequence(Date.parse('2026-09-23T13:30:00.123Z'), 0)).toBe('2026-09-23T13:30:00.123000Z');
    expect(timestampWithSequence(Date.parse('2026-09-23T13:30:00.123Z'), 7)).toBe('2026-09-23T13:30:00.123007Z');
    expect(timestampWithSequence(Date.parse('2026-09-23T13:30:00.123Z'), 5000)).toBe('2026-09-23T13:30:00.123999Z');
  });
});

describe('the daemon answers for an app it does not run from the stored rows', () => {
  const rpc = (opts: { local: unknown[]; handle: boolean }) => {
    const svc = new DaemonRpcService(
      { getHandle: () => (opts.handle ? {} : undefined) } as never,
      {} as never,
      { getLogs: () => opts.local } as never,
      {} as never,
      {} as never,
    );
    const asked: string[] = [];
    svc.setLogStore({
      storedEntries: async (app: string) => {
        asked.push(app);
        return [{ timestamp: 1, app, level: 'info', message: 'from the node', data: { sourceNode: 'n1' } }];
      },
    });
    return { svc, asked };
  };

  it('reads the table for a name this machine does not run', async () => {
    const { svc, asked } = rpc({ local: [], handle: false });
    const out = await svc.getLogs({ name: 'daos/deployed/paysys', lines: 5 });
    expect(asked).toEqual(['daos/deployed/paysys']);
    expect(out[0]!.message).toBe('from the node');
  });

  it('answers from its own capture for an app it runs', async () => {
    const { svc, asked } = rpc({ local: [], handle: true });
    expect(await svc.getLogs({ name: 'daos/dev/main', lines: 5 })).toEqual([]);
    expect(asked).toEqual([]);
  });
});
