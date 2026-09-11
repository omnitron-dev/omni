/**
 * What `omnitron init` writes, and what a daemon started in this package boots
 * with, must not be one particular private project's app list.
 *
 * The scaffold was a verbatim copy of a five-backend stack — `main`, `storage`,
 * `pricing`, `payments`, `messaging`, each at `./apps/<name>/src/main.ts`.
 * Those paths exist in exactly one repository. Every other user who ran
 * `omnitron init` got a config in which every entry was wrong, and `omnitron
 * up` answered with five failures before they had written anything.
 *
 * The same file sat in this package's own directory, so a daemon started here
 * registered five apps that could never run — five errors per boot about watch
 * directories that do not resolve — and put five bare names into the same
 * namespace as the downstream stack's five identically-named apps. That is the
 * collision `restart-keeps-the-project-prefix.test.ts` documents from the
 * resolver's side.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, afterEach } from 'vitest';

import { loadEcosystemConfig } from '../../src/config/loader.js';
import { initCommand } from '../../src/commands/init.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOMEBODY_ELSES_APPS = ['pricing', 'payments', 'messaging', 'storage'];

let scratch: string | null = null;
const cwdBefore = process.cwd();

afterEach(() => {
  process.chdir(cwdBefore);
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

describe('the config this package ships', () => {
  it('declares no apps', async () => {
    const config = await loadEcosystemConfig(packageRoot);
    // The daemon is the control plane. Its processes belong to registered
    // projects and arrive through `omnitron stack start`.
    expect(config.apps).toEqual([]);
  });
});

describe('the config `omnitron init` scaffolds', () => {
  it('loads, and names one example app rather than a stack', async () => {
    // Inside the package so the scaffold's `@omnitron-dev/omnitron` import
    // resolves the way it would in a real project with omnitron installed.
    scratch = fs.mkdtempSync(path.join(packageRoot, '.scaffold-test-'));
    process.chdir(scratch);

    await initCommand();

    const config = await loadEcosystemConfig(scratch);
    expect(config.apps).toHaveLength(1);

    const source = fs.readFileSync(path.join(scratch, 'omnitron.config.ts'), 'utf-8');
    for (const name of SOMEBODY_ELSES_APPS) {
      expect(source, `the scaffold must not ship '${name}'`).not.toContain(`'${name}'`);
    }
    expect(source).not.toContain('./apps/');
  });
});
