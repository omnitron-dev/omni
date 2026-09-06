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
 * Tested through `loadEcosystemConfig` plus the discriminator rather than
 * through `daemon-entry`, whose module scope starts a daemon on import.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { loadEcosystemConfig, ECOSYSTEM_CONFIG_NOT_FOUND } from '../../src/config/loader.js';

/** The predicate `loadConfigSafe` applies, in the shape it applies it. */
function isAbsence(err: unknown): boolean {
  return (err as { code?: string })?.code === ECOSYSTEM_CONFIG_NOT_FOUND;
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-entry-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('the daemon entry point config fallback', () => {
  it('treats an empty directory as absence', async () => {
    const err = await loadEcosystemConfig(tmpDir).catch((e) => e);

    expect(isAbsence(err)).toBe(true);
  });

  it.each([
    ['a file that does not parse', 'module.exports = { apps: ['],
    ['an app with no name', "module.exports = { apps: [{ script: './a.js' }] };"],
  ])('does not treat %s as absence', async (_label, source) => {
    // If this were absence, the daemon would boot with `{ apps: [] }` and
    // supervise nothing — indistinguishable, from outside, from a project
    // that has no apps.
    fs.writeFileSync(path.join(tmpDir, 'omnitron.config.js'), source);

    const err = await loadEcosystemConfig(tmpDir).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(isAbsence(err)).toBe(false);
  });
});
