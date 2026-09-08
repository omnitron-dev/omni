/**
 * `omnitron logs <app>` after a crash must not say there are none.
 *
 * The daemon answers `getLogs` from a ring buffer that lives on the
 * `AppHandle`. Every start constructs a NEW handle — `startAppInternal` does
 * `new AppHandle(entry, mode)` and replaces the map entry — so the buffer of
 * the run that just died is discarded along with it. The command then reported
 * "No logs available".
 *
 * That is the worst possible answer at that moment: it is wrong, and it is
 * wrong exactly when someone is looking for a cause. Observed on
 * `daos/dev/main` after it exhausted five restarts — the reason it would not
 * boot was in the file on disk the whole time, and had to be dug out of the
 * raw daemon log by hand.
 *
 * `LogManager` writes every managed app's lines to disk, so the record exists.
 * The command now falls through to it whenever the daemon's buffer comes back
 * empty, and keeps using the daemon whenever it has something — the buffer is
 * a live cache, not the record.
 *
 * Reaching the file turned up a second fault in the same function. A
 * project-mode app's log lives under
 * `~/.omnitron/projects/<project>/<stack>/logs/<app>/`, nowhere near
 * `~/.omnitron/logs` — but `readLogsFromFile` checked the latter for existence
 * BEFORE resolving any candidate path, and returned "No log directory found"
 * while the file it wanted was on disk. A long-lived host has
 * `~/.omnitron/logs` and hides it; a fresh install does not.
 */

import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-logs-'));

vi.mock('../../src/config/defaults.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/defaults.js')>();
  return { ...actual, OMNITRON_HOME: TMP };
});

const daemonEntries: { value: unknown[] } = { value: [] };
const disconnected = { count: 0 };

vi.mock('../../src/daemon/daemon-client.js', () => ({
  createDaemonClient: () => ({
    isReachable: async () => true,
    getLogs: async () => daemonEntries.value,
    disconnect: async () => { disconnected.count++; },
  }),
}));

const printed: string[] = [];
vi.mock('@xec-sh/kit', () => ({
  log: { info: (m: string) => printed.push(String(m)) },
  prism: new Proxy({}, { get: () => (s: string) => s }),
}));

const { logsCommand } = await import('../../src/commands/logs.js');

/** Write one app.log in the project-mode layout the dev stand uses. */
function writeAppLog(app: string, lines: string[]) {
  const [project, stack, ...rest] = app.split('/');
  const dir = path.join(TMP, 'projects', project!, stack!, 'logs', rest.join('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.log'), lines.join('\n') + '\n');
}

const consoleLines: string[] = [];
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  printed.length = 0;
  consoleLines.length = 0;
  daemonEntries.value = [];
  disconnected.count = 0;
  spy = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    consoleLines.push(a.map(String).join(' '));
  });
});

afterEach(() => spy.mockRestore());

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe('omnitron logs, daemon up and buffer empty', () => {
  it('reads the file instead of reporting there are no logs', async () => {
    writeAppLog('daos/dev/main', [
      JSON.stringify({ level: 50, time: Date.now(), msg: 'module:importing http.js timed out' }),
    ]);

    await logsCommand('daos/dev/main', { lines: 20 });

    expect(
      printed.join('\n'),
      'the old answer was a flat denial that any logs exist',
    ).not.toMatch(/No logs available/);
    expect(
      consoleLines.join('\n'),
      'and the reason it would not boot is what the operator needs',
    ).toMatch(/timed out/);
  });

  it('finds a project-mode log without the standalone log directory', async () => {
    // The temp home deliberately has no `logs/` at all — only
    // `projects/<p>/<s>/logs/<app>/app.log`, which is where a stack app writes.
    expect(fs.existsSync(path.join(TMP, 'logs')), 'no standalone log dir exists').toBe(false);
    writeAppLog('daos/dev/paysys', [
      JSON.stringify({ level: 30, time: Date.now(), msg: 'deposit worker started' }),
    ]);

    await logsCommand('daos/dev/paysys', { lines: 20 });

    expect(printed.join('\n')).not.toMatch(/No log directory found/);
    expect(consoleLines.join('\n')).toMatch(/deposit worker started/);
  });

  it('still says so when the file genuinely has nothing either', async () => {
    // The control: falling through to disk must not turn "nothing anywhere"
    // into silence.
    await logsCommand('never-existed/dev/app', { lines: 20 });

    expect(printed.join('\n')).toMatch(/No log file found|No log entries found|No log directory/);
  });

  it('uses the daemon while its buffer still has the run', async () => {
    daemonEntries.value = [
      { app: 'daos/dev/main', level: 'info', timestamp: Date.now(), message: 'live from the buffer' },
    ];
    writeAppLog('daos/dev/main', [
      JSON.stringify({ level: 30, time: Date.now() - 60_000, msg: 'stale from the file' }),
    ]);

    await logsCommand('daos/dev/main', { lines: 20 });

    const out = consoleLines.join('\n');
    expect(out, 'a live buffer is still preferred').toMatch(/live from the buffer/);
    expect(out, 'and the file is not read on top of it').not.toMatch(/stale from the file/);
  });
});
