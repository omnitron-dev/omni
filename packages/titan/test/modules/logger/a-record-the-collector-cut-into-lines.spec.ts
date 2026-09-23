/**
 * A record the collector cut into lines.
 *
 * Under omnitron an app's stdout is a pipe to the daemon, and the daemon takes
 * every LINE as one pino record. A pretty record is dozens of lines. On the
 * test node, 2026-09-23, paysys's deposit worker — no `prettyPrint` of its
 * own, so the development default — wrote each failed poll as ~195 lines; the
 * master's `logs` table held 1 216 292 such fragments from paysys in one day,
 * every one stored as `info`, while the error records it could count were 3.
 * Four apps of six on that node wrote this way.
 *
 * `a-record-that-could-not-say-its-day` kept pretty under the supervisor and
 * made the file greppable. What reaches the collector is not the file: a
 * record it cannot parse loses its level, its fields and its order. So pretty
 * is for a terminal, and only a terminal: asked for or defaulted to, a stream
 * no terminal reads gets one JSON record per line — and when pretty was asked
 * for explicitly, the logger says once why it did not.
 */

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { prettyDecision } from '../../../src/modules/logger/logger.service.js';

const run = promisify(execFile);
const FIXTURE = fileURLToPath(new URL('./under-a-pipe.fixture.ts', import.meta.url));

/** Run the fixture the way a supervisor runs an app: stdout is a pipe. */
async function underAPipe(env: Record<string, string> = {}): Promise<string[]> {
  const { stdout } = await run(process.execPath, ['--import', 'tsx', FIXTURE], {
    env: { ...process.env, NODE_ENV: '', ...env },
    timeout: 30_000,
  });
  return stdout.split('\n').filter((line) => line.trim() !== '');
}

const parsed = (line: string): { level?: number; msg?: string } | null => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

describe('a record the collector cut into lines', () => {
  it('a worker that asked for nothing writes one JSON record per line to a pipe', async () => {
    const lines = await underAPipe();

    expect(lines.filter((line) => parsed(line) === null), 'lines the collector cannot parse').toEqual([]);
    expect(lines.map((line) => parsed(line)?.msg)).toEqual(['poll cycle started', 'Deposit poll cycle failed']);
    expect(parsed(lines[1]!)?.level, 'the failure keeps its level').toBe(50);
  }, 60_000);

  it('a worker that asked for pretty gets JSON on a pipe, and a line saying why', async () => {
    const lines = await underAPipe({ PRETTY: '1' });

    expect(lines.filter((line) => parsed(line) === null), 'lines the collector cannot parse').toEqual([]);
    const refusals = lines.map((line) => parsed(line)).filter((r) => r?.level === 40 && /prettyPrint/.test(r.msg ?? ''));
    expect(refusals, 'one warning that pretty was not used').toHaveLength(1);
    expect(lines).toHaveLength(3);
  }, 60_000);

  it('a terminal still gets pretty, asked for or by the development default', () => {
    expect(prettyDecision({ environment: 'development' }, true)).toEqual({ pretty: true, refused: false });
    expect(prettyDecision({ prettyPrint: true }, true)).toEqual({ pretty: true, refused: false });
    expect(prettyDecision({ environment: 'development', prettyPrint: false }, true)).toEqual({ pretty: false, refused: false });
    expect(prettyDecision({ environment: 'production' }, true)).toEqual({ pretty: false, refused: false });
  });

  it('a stream no terminal reads never does', () => {
    expect(prettyDecision({ environment: 'development' }, false)).toEqual({ pretty: false, refused: false });
    expect(prettyDecision({ prettyPrint: true }, false)).toEqual({ pretty: false, refused: true });
    expect(prettyDecision({ pretty: true }, false)).toEqual({ pretty: false, refused: true });
  });
});
