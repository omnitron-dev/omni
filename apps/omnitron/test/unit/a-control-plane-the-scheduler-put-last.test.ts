/**
 * A control plane the scheduler put last.
 *
 * The launchd job for the daemon had no `ProcessType`, and launchd.plist(5)
 * treats that as `Standard`: «light resource limits» on CPU and I/O, where a
 * process started from a terminal has none. On 2026-09-23 the dev master
 * shared the machine with another project's compilers and trainers at load
 * 120, and the event-loop watch logged 139 stalls in forty minutes, every one
 * `off-cpu` — up to 4.6 s at no more than 93 ms of CPU, no phase in progress:
 * not a daemon doing work, a daemon not being run. Its mesh connection to the
 * test node dropped under them. The node, under systemd, logged none.
 *
 * The plist is generated, so this reads what the generator writes — and on
 * macOS hands it to `plutil`, which is what launchd reads it with.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, expect, afterEach } from 'vitest';

import { renderLaunchdPlist, renderSystemdUnit, type UnitInputs } from '../../src/commands/service-units.js';

const inputs = (over: Partial<UnitInputs> = {}): UnitInputs => ({
  scope: 'user',
  execPath: '/Users/omni/.nvm/versions/node/v24.13.0/bin/node',
  entryPath: '/Users/omni/omni/apps/omnitron/dist/daemon/daemon-entry.js',
  workdir: '/Users/omni/omni/apps/omnitron',
  path: '/usr/local/bin:/usr/bin:/bin',
  stderrLog: '/Users/omni/.omnitron/logs/launchd.err.log',
  ...over,
});

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('a control plane the scheduler put last', () => {
  it('asks launchd for the resource limits of an app, which are none', () => {
    for (const scope of ['user', 'system'] as const) {
      const plist = renderLaunchdPlist(
        inputs(scope === 'system' ? { scope, identity: { user: 'omni', home: '/Users/omni' } } : { scope }),
      );
      expect(plist, scope).toMatch(/<key>ProcessType<\/key>\s*<string>Interactive<\/string>/);
    }
  });

  it.runIf(process.platform === 'darwin')('is read that way by the tool launchd reads it with', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-plist-'));
    cleanup.push(dir);
    const file = path.join(dir, 'dev.omnitron.daemon.plist');
    fs.writeFileSync(file, renderLaunchdPlist(inputs()));

    const r = spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' });

    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).ProcessType).toBe('Interactive');
  });

  it('leaves the systemd unit as it is — the node it runs was not starved', () => {
    // Measured, not assumed: the test node logged no stall over the same
    // hours. systemd gives a service the default CPU weight, the same as a
    // login session's; nothing here throttles it, and nothing is added.
    const unit = renderSystemdUnit(inputs({ scope: 'system', identity: { user: 'omni', home: '/home/omni' } }));
    expect(unit).not.toMatch(/^(Nice|CPUWeight|CPUQuota|IOSchedulingClass|CPUSchedulingPolicy)=/m);
  });
});
