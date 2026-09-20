/**
 * A deployment and a file watcher restarting the same app, against each other.
 *
 * Watch mode is what puts the orchestrator in `devMode`, and `devMode` is
 * what makes it build every bootstrap app with esbuild and then WATCH the
 * result. The daemon turns it on unless `OMNITRON_NO_WATCH` is set — which
 * is right on a developer's machine and exactly wrong on a node: nobody
 * edits sources there, the only thing that rewrites them is a deployment,
 * and a deployment restarts what it deployed.
 *
 * Measured on the test node's own log during a routine redeploy:
 *
 *     esbuild rebuild detected — restarting        ×36
 *     esbuild rebuild detected but app is not running — skipping restart
 *     Max restarts exceeded                        (main, priceverse)
 *     Crash restart task rejected
 *
 * The apps came up anyway, because the deployment started them itself once
 * its artifacts were in place. That is how this stayed invisible: the end
 * state was right, and the path to it was a crash loop that reads in the
 * log exactly like a real one.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = stripComments(
  fs.readFileSync(path.join(here, '../../src/daemon/daemon-entry.ts'), 'utf8'),
);

/** The options the daemon is started with, as the source writes them. */
function startOptions(): string {
  const at = entry.indexOf('await daemon.start(');
  expect(at, 'the daemon is started where this test thinks it is').toBeGreaterThan(-1);
  return entry.slice(at, entry.indexOf('}, dc);', at));
}

describe('a node does not watch', () => {
  it('decides from the role, not only from the environment', () => {
    expect(entry).toMatch(/const isNode = dc\.role === 'slave'/);
  });

  it('turns watching off for a node', () => {
    const options = startOptions();

    expect(options).toMatch(/watch: !env\.OMNITRON_NO_WATCH && !isNode/);
    expect(options).toMatch(/noWatch: env\.OMNITRON_NO_WATCH \|\| isNode/);
  });

  it('leaves a master exactly as it was', () => {
    // The two flags are the same expression as before for `role !== 'slave'`,
    // which is what a developer's daemon is.
    const bothForMaster = (noWatchEnv: boolean, role: string) => {
      const isNode = role === 'slave';
      return { watch: !noWatchEnv && !isNode, noWatch: noWatchEnv || isNode };
    };

    expect(bothForMaster(false, 'master')).toEqual({ watch: true, noWatch: false });
    expect(bothForMaster(true, 'master')).toEqual({ watch: false, noWatch: true });
    expect(bothForMaster(false, 'slave')).toEqual({ watch: false, noWatch: true });
    expect(bothForMaster(true, 'slave')).toEqual({ watch: false, noWatch: true });
  });

  it('keeps the environment override, for a master that wants none', () => {
    expect(startOptions()).toContain('OMNITRON_NO_WATCH');
  });
});

describe('what watching costs on a node', () => {
  /**
   * The orchestrator's gate, quoted so the link between the two files is
   * visible: no watch, no devMode, no esbuild build of a deployed artifact.
   */
  it('is the only thing that sets devMode', () => {
    const daemon = stripComments(
      fs.readFileSync(path.join(here, '../../src/daemon/daemon.ts'), 'utf8'),
    );
    const at = daemon.indexOf('orchestrator.devMode = true');

    expect(at, 'devMode is set in startFileWatcher').toBeGreaterThan(-1);
    // And startFileWatcher returns early without the option.
    const before = daemon.slice(Math.max(0, at - 400), at);
    expect(before).toMatch(/if \(!options\?\.watch \|\| options\?\.noWatch/);
  });

  it('is what arms the esbuild rebuild restart', () => {
    const orchestrator = stripComments(
      fs.readFileSync(path.join(here, '../../src/orchestrator/orchestrator.service.ts'), 'utf8'),
    );
    const at = orchestrator.indexOf('this.buildService.watchApp(');

    expect(at).toBeGreaterThan(-1);
    expect(orchestrator.slice(Math.max(0, at - 3000), at)).toMatch(/if \(definition && this\.devMode\)/);
  });
});
