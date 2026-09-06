/**
 * What the daemon does when the config in its working directory is broken.
 *
 * `loadConfigSafe` caught everything and returned `{ apps: [] }`, so a typo in
 * `omnitron.config.ts` started a daemon that supervised nothing. It reported
 * healthy, `omnitron list` showed an empty list — which is what it shows for
 * a project with no apps — and every surface agreed that all was well.
 *
 * The function's own file already draws the line: the explicit `configPath`
 * branch calls `loadEcosystemConfigFile`, which throws. A directory with no
 * config is what the fallback is for; a config that exists and does not load
 * is not that.
 *
 * The first version of this file tested `loadEcosystemConfig` plus the
 * discriminator, because `daemon-entry` calls `main()` at import. That
 * verified the parts and not the function built out of them: restoring the
 * blanket catch in `loadConfigSafe` would have left every assertion green.
 * A mutation that puts the defect back is the only one that shows a test is
 * about the defect rather than about something near it — so the function
 * moved to the config module, where it can be called.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { loadDaemonBootConfig } from '../../src/config/loader.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-entry-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('the config the daemon boots with', () => {
  it('is an empty ecosystem when the directory has no config', async () => {
    const config = await loadDaemonBootConfig(null, tmpDir);

    expect(config.apps).toEqual([]);
  });

  it.each([
    ['a file that does not parse', 'module.exports = { apps: ['],
    ['an apps that is not an array', "module.exports = { apps: 'all' };"],
    ['an app with no name', "module.exports = { apps: [{ script: './a.js' }] };"],
    ['an app with neither bootstrap nor script', "module.exports = { apps: [{ name: 'a' }] };"],
  ])('refuses to boot on %s', async (_label, source) => {
    // The alternative is what this replaced: a daemon that comes up, reports
    // healthy and supervises nothing, which no check can tell from a daemon
    // with nothing to supervise.
    fs.writeFileSync(path.join(tmpDir, 'omnitron.config.js'), source);

    await expect(loadDaemonBootConfig(null, tmpDir)).rejects.toThrow();
  });

  it('loads a config that is there', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'omnitron.config.js'),
      "module.exports = { apps: [{ name: 'api', script: './api.js' }] };"
    );

    const config = await loadDaemonBootConfig(null, tmpDir);

    expect(config.apps.map((a) => a.name)).toEqual(['api']);
  });

  it('prefers an explicit path, and does not soften its failure either', async () => {
    const explicit = path.join(tmpDir, 'custom.config.js');
    fs.writeFileSync(explicit, 'module.exports = { apps: [');

    await expect(loadDaemonBootConfig(explicit, tmpDir)).rejects.toThrow();
  });
});
