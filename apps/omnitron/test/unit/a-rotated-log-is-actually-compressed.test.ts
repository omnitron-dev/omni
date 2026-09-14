/**
 * Every rotated log on disk was plain JSON wearing a `.gz` name.
 *
 * Measured on a running deployment: `file app.log.1.gz` → "JSON data",
 * `gunzip -t` → "not in gzip format", and nine such files per stream at
 * exactly 50 MiB each. 2.4 GB of logs where the configuration
 * (`maxSize: 50mb`, `maxFiles: 10`, `compress: true`) asked for roughly 250 MB,
 * because JSON logs gzip about ten to one.
 *
 * The cause was one index. The shift loop ran `i` from `maxFiles - 1` down to
 * 1, and its `i === 1` case took `from = basePath` — the LIVE file — and
 * `to = <base>.1.gz`. So the live log was renamed straight to a compressed
 * name, and the two steps meant to do that job found nothing left to do: the
 * rename below had no `basePath`, and the compressor looked for `<base>.1`,
 * which never existed.
 *
 * It only broke with compression ON, which is the default. With it off `ext`
 * is empty, the i=1 case duplicated the rename that follows, and the second
 * rename failed silently — correct by coincidence, which is why the
 * uncompressed path never showed it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import { LogManager } from '../../src/monitoring/log-manager.js';

const made: string[] = [];
function tmpBase(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-logrot-'));
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Wait for the asynchronous `compressFile` to land. */
async function until(check: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

function manager(baseDir: string, compress: boolean): LogManager {
  const mgr = new LogManager(
    { baseDir, defaults: { maxSize: '1kb', maxFiles: 4, compress } },
    // The orchestrator is only consulted by the ring-buffer query helpers,
    // which these tests do not touch.
    undefined as never,
  );
  return mgr;
}

describe('rotating a log with compression on', () => {
  it('produces a file that is actually gzip', async () => {
    const base = tmpBase();
    const mgr = manager(base, true);
    const live = mgr.getLogFilePath('demo', 'app');

    fs.writeFileSync(live, '{"msg":"one"}\n'.repeat(200));
    mgr.rotateLog('demo', 'app');
    await until(() => fs.existsSync(`${live}.1.gz`));

    expect(fs.existsSync(`${live}.1.gz`), 'no rotated file appeared').toBe(true);
    const raw = fs.readFileSync(`${live}.1.gz`);
    // The whole point: gunzip must succeed, and give back what was written.
    const text = gunzipSync(raw).toString('utf8');
    expect(text).toContain('{"msg":"one"}');
    expect(text.split('\n').filter(Boolean)).toHaveLength(200);
  });

  it('leaves no uncompressed leftover beside it', async () => {
    const base = tmpBase();
    const mgr = manager(base, true);
    const live = mgr.getLogFilePath('demo', 'app');

    fs.writeFileSync(live, 'x\n'.repeat(100));
    mgr.rotateLog('demo', 'app');
    await until(() => fs.existsSync(`${live}.1.gz`));

    expect(fs.existsSync(`${live}.1`), 'the pre-compression file was not removed').toBe(false);
  });

  it('shifts older files without clobbering the live one', async () => {
    const base = tmpBase();
    const mgr = manager(base, true);
    const live = mgr.getLogFilePath('demo', 'app');

    fs.writeFileSync(live, 'first\n');
    mgr.rotateLog('demo', 'app');
    await until(() => fs.existsSync(`${live}.1.gz`));

    fs.writeFileSync(live, 'second\n');
    mgr.rotateLog('demo', 'app');
    // `.2.gz` appears during the synchronous shift; `.1.gz` only once the
    // asynchronous compression of the newly rotated file lands. Waiting on the
    // wrong one is a race, not a failure.
    await until(() => fs.existsSync(`${live}.1.gz`) && fs.existsSync(`${live}.2.gz`));

    expect(gunzipSync(fs.readFileSync(`${live}.1.gz`)).toString()).toContain('second');
    expect(gunzipSync(fs.readFileSync(`${live}.2.gz`)).toString()).toContain('first');
  });

  it('keeps at most maxFiles - 1 rotations', async () => {
    const base = tmpBase();
    const mgr = manager(base, true);
    const live = mgr.getLogFilePath('demo', 'app');

    for (let i = 0; i < 6; i++) {
      fs.writeFileSync(live, `round-${i}\n`);
      mgr.rotateLog('demo', 'app');
      await until(() => fs.existsSync(`${live}.1.gz`));
    }

    const rotations = fs.readdirSync(path.dirname(live)).filter((f) => /\.\d+(\.gz)?$/.test(f));
    expect(rotations.length).toBeLessThanOrEqual(3);
  });
});

describe('rotating with compression off', () => {
  it('still rotates, with no .gz name anywhere', () => {
    // This path was correct by coincidence before the fix; it must stay
    // correct now that the coincidence is gone.
    const base = tmpBase();
    const mgr = manager(base, false);
    const live = mgr.getLogFilePath('demo', 'app');

    fs.writeFileSync(live, 'plain\n');
    mgr.rotateLog('demo', 'app');

    expect(fs.readFileSync(`${live}.1`, 'utf8')).toContain('plain');
    expect(fs.existsSync(`${live}.1.gz`)).toBe(false);
  });
});

// =============================================================================
// The `.gz` name must never name a partial file
// =============================================================================

describe('a rotated .gz is complete the moment it has that name', () => {
  it('never appears as a truncated gzip member', async () => {
    // `createWriteStream` creates its target when it opens, so compressing
    // straight to `<log>.1.gz` published the name over an empty file and
    // filled it in afterwards. Everything that reads rotated logs — this
    // suite, `omnitron logs`, an operator with `gunzip` — sees that window,
    // and what it sees is "unexpected end of file".
    //
    // The suite above waits for the file to EXIST, which is the natural thing
    // to write and was true before the file was valid; it failed about one
    // run in three on a loaded host and passed alone every time, which is how
    // a race gets filed as flakiness.
    //
    // Polled hard rather than once: the window is however long the pipeline
    // takes, and the assertion is that there is no window at all.
    const base = tmpBase();
    const mgr = manager(base, true);
    const live = path.join(base, 'logs', 'demo', 'app.log');
    fs.mkdirSync(path.dirname(live), { recursive: true });
    // Big enough that compression is not instantaneous.
    fs.writeFileSync(live, JSON.stringify({ msg: 'x'.repeat(64) }) + '\n'.repeat(1) .repeat(1) + Array.from(
      { length: 40_000 },
      (_, i) => JSON.stringify({ i, msg: 'the quick brown fox jumps over the lazy dog' }),
    ).join('\n'));

    mgr.rotateLog('demo', 'app');

    const gz = `${live}.1.gz`;
    const deadline = Date.now() + 5_000;
    let sawIt = false;
    while (Date.now() < deadline) {
      if (fs.existsSync(gz)) {
        const raw = fs.readFileSync(gz);
        // If the name exists, the bytes under it must be a whole member.
        expect(() => gunzipSync(raw), 'the .gz name appeared over an incomplete file').not.toThrow();
        sawIt = true;
        break;
      }
      await new Promise((r) => setImmediate(r));
    }

    expect(sawIt, 'compression never produced a .gz').toBe(true);
  });

  it('leaves no scratch file behind', async () => {
    // The shift loop reads the directory by name. A `.partial` left over
    // would sit in a rotation slot's way.
    const base = tmpBase();
    const mgr = manager(base, true);
    const live = path.join(base, 'logs', 'demo', 'app.log');
    fs.mkdirSync(path.dirname(live), { recursive: true });
    fs.writeFileSync(live, JSON.stringify({ msg: 'only line' }) + '\n');

    mgr.rotateLog('demo', 'app');
    await until(() => fs.existsSync(`${live}.1.gz`));

    const leftovers = fs.readdirSync(path.dirname(live)).filter((f) => f.includes('.partial'));
    expect(leftovers).toEqual([]);
  });
});
