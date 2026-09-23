/**
 * Where `omnitron logs <app>` reads when the daemon cannot answer.
 *
 * T#76 pinned a probe ORDER — project, standalone, legacy flat `<app>.log`,
 * then the daemon's own log — and the last two were the trouble: on this
 * host `~/.omnitron/logs/main/app.log` exists, last written Sep 7, while
 * `main` writes under `projects/daos/dev/logs/main/`. `logs main -l error`
 * printed May's errors as the answer; with no file for an app, it printed
 * the DAEMON's log under the app's name.
 *
 * The file is now derived the way `LogManager.getLogDir` writes it: a
 * qualified name under its project and stack only; a bare name under the one
 * project stack that has it — refused when several do — and only failing
 * that the standalone directory. Never the legacy flat file, never the
 * daemon's log.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { __test } from '../../src/commands/logs.js';

const made: string[] = [];
const home = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-home-'));
  made.push(dir);
  return { projects: path.join(dir, 'projects'), logs: path.join(dir, 'logs') };
};
const writeLog = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.log'), '{"msg":"x"}\n');
};

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('the file an app writes, derived from its name', () => {
  it('reads a qualified name under its project and stack', () => {
    const roots = home();
    writeLog(path.join(roots.projects, 'daos', 'dev', 'logs', 'main'));

    expect(__test.derivedLogFile('daos/dev/main', 'error', roots)).toEqual({
      file: path.join(roots.projects, 'daos', 'dev', 'logs', 'main', 'error.log'),
    });
  });

  it('prefers the project stack that has a bare name over a stale standalone file', () => {
    const roots = home();
    writeLog(path.join(roots.logs, 'main')); // the decoy: last written weeks ago
    writeLog(path.join(roots.projects, 'daos', 'dev', 'logs', 'main'));

    expect(__test.derivedLogFile('main', 'app', roots)).toEqual({
      file: path.join(roots.projects, 'daos', 'dev', 'logs', 'main', 'app.log'),
    });
  });

  it('refuses a bare name two stacks have, rather than picking one', () => {
    const roots = home();
    writeLog(path.join(roots.projects, 'daos', 'dev', 'logs', 'main'));
    writeLog(path.join(roots.projects, 'acme', 'dev', 'logs', 'main'));

    const answer = __test.derivedLogFile('main', 'app', roots);
    expect(answer && 'ambiguous' in answer ? answer.ambiguous.length : 0).toBe(2);
  });

  it('never answers with the legacy flat file or the daemon log', () => {
    const roots = home();
    fs.mkdirSync(roots.logs, { recursive: true });
    fs.writeFileSync(path.join(roots.logs, 'main.log'), 'legacy\n');
    fs.writeFileSync(path.join(roots.logs, 'omnitron.log'), 'daemon\n');

    expect(__test.derivedLogFile('main', 'app', roots)).toBeNull();
    expect(__test.derivedLogFile('daos/dev/main', 'app', roots)).toBeNull();
  });
});
